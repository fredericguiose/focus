// Paquet agent : logique de focus-agent (questions de session, ouverture d'une session),
// indépendante de la bibliothèque de dialogues.
package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/api"
	"github.com/fredericguiose/focus/clients/pc/internal/local"
	"github.com/fredericguiose/focus/clients/pc/internal/planning"
)

// ErrAnnule : l'utilisateur a fermé ou annulé le dialogue.
var ErrAnnule = errors.New("annulé")

// AttenteOuverture : friction avant l'ouverture d'une session.
const AttenteOuverture = 10 * time.Second

// Marge ajoutée à l'attente avant « continue » : l'heure de focusd peut différer de quelques
// centaines de millisecondes de celle de l'API, qui refuse un « continue » trop tôt.
const margeContinue = time.Second

type Dialogues interface {
	// Question renvoie true pour « Je continue », false pour « J'arrête ».
	Question(ctx context.Context, texte string) (bool, error)
	// Patienter affiche un compte à rebours ; ErrAnnule si l'utilisateur le ferme.
	Patienter(ctx context.Context, texte string, duree time.Duration, annulable bool) error
	Choisir(ctx context.Context, texte string, options []string) (string, error)
	Saisir(ctx context.Context, texte, defaut string) (string, error)
	Informer(texte string)
	// Prevenir : notification de bureau, sans fenêtre à fermer.
	Prevenir(texte string)
	Erreur(texte string)
}

type Canal interface {
	Etat(ctx context.Context) (local.Etat, error)
	Taches(ctx context.Context) ([]planning.Tache, error)
	OuvrirSession(ctx context.Context, d local.DemandeOuverture) error
	Repondre(ctx context.Context, sessionID string, d local.DemandeReponse) error
}

// QuestionDue : question posée, pas encore expirée, sans « continue » déjà accepté.
func QuestionDue(s local.SessionLocale, t time.Time) bool {
	q := s.Question
	return q != nil && !s.ContinueAccepte && !t.Before(q.PoseeA) && t.Before(q.ExpireA)
}

// AttenteRestante : temps avant que l'API accepte « continue » (posee_a + attente_s).
func AttenteRestante(q planning.Question, t time.Time) time.Duration {
	r := q.PoseeA.Add(time.Duration(q.AttenteS) * time.Second).Sub(t)
	return max(r, 0)
}

// LireApps découpe « chatgpt, claude_ai » en identifiants.
func LireApps(saisie string) []string {
	var apps []string
	for _, a := range strings.FieldsFunc(saisie, func(r rune) bool { return r == ',' || r == ' ' || r == ';' }) {
		if !slices.Contains(apps, a) {
			apps = append(apps, a)
		}
	}
	return apps
}

// AppsConnues : apps des sessions du planning, pour pré-remplir la saisie (l'API ne fournit
// pas encore le catalogue des apps au client PC).
func AppsConnues(e local.Etat) []string {
	var apps []string
	for _, s := range e.Sessions {
		for _, a := range s.Apps {
			if !slices.Contains(apps, a) {
				apps = append(apps, a)
			}
		}
	}
	return apps
}

func message(err error) string {
	var e *api.Erreur
	if errors.As(err, &e) && e.Message != "" {
		return e.Message
	}
	return err.Error()
}

type Agent struct {
	Canal     Canal
	Dialogues Dialogues
	Journal   *slog.Logger
	Horloge   func() time.Time

	mu       sync.Mutex
	ouvertes map[string]context.CancelFunc // question → fermeture du dialogue
	vues     map[string]bool
	fond     sync.WaitGroup
}

func (a *Agent) maintenant() time.Time {
	if a.Horloge != nil {
		return a.Horloge()
	}
	return time.Now()
}

// Surveiller interroge focusd à intervalle court (appel local, sans coût) et pose les questions
// à l'heure dite.
func (a *Agent) Surveiller(ctx context.Context, periode time.Duration) {
	tic := time.NewTicker(periode)
	defer tic.Stop()
	for {
		a.Tour(ctx)
		select {
		case <-ctx.Done():
			a.fond.Wait()
			return
		case <-tic.C:
		}
	}
}

// Tour : un passage de surveillance.
func (a *Agent) Tour(ctx context.Context) {
	c, annuler := context.WithTimeout(ctx, 5*time.Second)
	e, err := a.Canal.Etat(c)
	annuler()
	if err != nil {
		a.Journal.Debug("focusd injoignable", "erreur", err)
		return
	}
	h := planning.Caler(e.Maintenant, a.maintenant())
	t := e.Maintenant

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.ouvertes == nil {
		a.ouvertes = map[string]context.CancelFunc{}
		a.vues = map[string]bool{}
	}
	dues := map[string]bool{}
	for _, s := range e.Sessions {
		if !QuestionDue(s, t) {
			continue
		}
		q := s.Question.ID
		dues[q] = true
		if a.vues[q] {
			continue
		}
		a.vues[q] = true
		cq, fermer := context.WithDeadline(ctx, h.Local(s.Question.ExpireA))
		a.ouvertes[q] = fermer
		a.fond.Add(1)
		go func() {
			defer a.fond.Done()
			defer func() {
				fermer()
				a.mu.Lock()
				delete(a.ouvertes, q)
				a.mu.Unlock()
			}()
			a.poser(cq, s, h)
		}()
	}
	a.prevenirDuVerrou(e, t)
	// Question réglée ailleurs (autre session, interface web) : on ferme le dialogue.
	for q, fermer := range a.ouvertes {
		if !dues[q] {
			fermer()
		}
	}
}

// Préavis du verrou (04/11) : rien ne prévenait avant la coupure de la nuit.
var Preavis = []time.Duration{15 * time.Minute, 5 * time.Minute}

// prevenirDuVerrou : une notification à chaque préavis, une seule fois par verrou et par préavis.
// Appelé sous a.mu.
func (a *Agent) prevenirDuVerrou(e local.Etat, t time.Time) {
	if e.ProchainVerrou == nil {
		return
	}
	reste := e.ProchainVerrou.Sub(t)
	if reste <= 0 {
		return
	}
	nouveau := false
	for _, p := range Preavis {
		cle := fmt.Sprintf("verrou|%s|%s", e.ProchainVerrou.UTC().Format(time.RFC3339), p)
		if reste <= p && !a.vues[cle] {
			a.vues[cle] = true // agent lancé à −4 min : un seul préavis, pas deux
			nouveau = true
		}
	}
	if !nouveau {
		return
	}
	minutes := int((reste + 59*time.Second) / time.Minute)
	a.Dialogues.Prevenir(fmt.Sprintf("Verrouillage de la session dans %d min (%s). Enregistrez votre travail.", minutes, e.ProchainMode))
	a.Journal.Info("préavis du verrou", "dans_min", minutes, "mode", e.ProchainMode)
}

func (a *Agent) poser(ctx context.Context, s local.SessionLocale, h planning.Horloge) {
	q := *s.Question
	continuer, err := a.Dialogues.Question(ctx, fmt.Sprintf("Toujours sur « %s » ?", s.Tache.Nom))
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			a.Dialogues.Informer(fmt.Sprintf("Pas de réponse : la session « %s » est fermée.", s.Tache.Nom))
		} else if ctx.Err() == nil {
			a.Journal.Error("dialogue de question", "erreur", err)
		}
		return
	}
	reponse := "arrete"
	if continuer {
		reponse = "continue"
		if reste := AttenteRestante(q, h.Maintenant(a.maintenant())); reste > 0 {
			reste += margeContinue
			err := a.Dialogues.Patienter(ctx, "Je continue dans", reste, false)
			if errors.Is(err, ErrAnnule) {
				// Fenêtre fermée : le choix « continuer » reste valable, on attend sans elle.
				err = attendre(ctx, AttenteRestante(q, h.Maintenant(a.maintenant()))+margeContinue)
			}
			if err != nil {
				return
			}
		}
	}
	if err := a.Canal.Repondre(ctx, s.ID, local.DemandeReponse{QuestionID: q.ID, Reponse: reponse}); err != nil {
		a.Dialogues.Erreur("Réponse non prise en compte : " + message(err))
		return
	}
	a.Journal.Info("réponse envoyée", "session", s.ID, "reponse", reponse)
}

func attendre(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Ouvrir : choix de la tâche, apps, attente, puis demande d'ouverture. Les refus de l'API
// (sessions interdites, plafond atteint…) sont affichés tels quels.
func (a *Agent) Ouvrir(ctx context.Context, apps []string) error {
	taches, err := a.Canal.Taches(ctx)
	if err != nil {
		a.Dialogues.Erreur("Tâches indisponibles : " + message(err))
		return err
	}
	if len(taches) == 0 {
		a.Dialogues.Informer("Aucune tâche éligible à une session.")
		return nil
	}
	options := make([]string, len(taches))
	parOption := map[string]planning.Tache{}
	for i, t := range taches {
		o := t.Nom
		if _, doublon := parOption[o]; doublon || o == "" {
			o = fmt.Sprintf("%s (%s)", t.Nom, t.ID)
		}
		options[i] = o
		parOption[o] = t
	}
	choix, err := a.Dialogues.Choisir(ctx, "Sur quelle tâche ?", options)
	if errors.Is(err, ErrAnnule) {
		return nil
	}
	if err != nil {
		return err
	}
	tache, ok := parOption[choix]
	if !ok {
		return fmt.Errorf("choix inconnu : %q", choix)
	}
	if len(apps) == 0 {
		var connues []string
		if e, err := a.Canal.Etat(ctx); err == nil {
			connues = AppsConnues(e)
		}
		saisie, err := a.Dialogues.Saisir(ctx, "Apps à débloquer (identifiants séparés par des virgules) :", strings.Join(connues, ", "))
		if errors.Is(err, ErrAnnule) {
			return nil
		}
		if err != nil {
			return err
		}
		if apps = LireApps(saisie); len(apps) == 0 {
			a.Dialogues.Erreur("Aucune app indiquée.")
			return nil
		}
	}
	if err := a.Dialogues.Patienter(ctx, fmt.Sprintf("Session « %s » dans", tache.Nom), AttenteOuverture, true); err != nil {
		if errors.Is(err, ErrAnnule) {
			return nil
		}
		return err
	}
	if err := a.Canal.OuvrirSession(ctx, local.DemandeOuverture{TacheID: tache.ID, Apps: apps}); err != nil {
		a.Dialogues.Erreur("Session refusée : " + message(err))
		return err
	}
	a.Dialogues.Informer(fmt.Sprintf("Session ouverte : « %s ».", tache.Nom))
	return nil
}
