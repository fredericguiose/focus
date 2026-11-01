package agent

import (
	"context"
	"io"
	"log/slog"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/api"
	"github.com/fredericguiose/focus/clients/pc/internal/local"
	"github.com/fredericguiose/focus/clients/pc/internal/planning"
)

// Les échéances des dialogues sont des contextes sur l'horloge réelle : t0 doit en partir.
var t0 = time.Now().UTC().Truncate(time.Second)

func session(continueAccepte bool) local.SessionLocale {
	return local.SessionLocale{
		Session: planning.Session{
			ID: "s_01", Tache: planning.Tache{ID: "123", Nom: "DM de maths"}, Apps: []string{"chatgpt"},
			Question: &planning.Question{ID: "q_07", PoseeA: t0.Add(-time.Second), AttenteS: 3, ExpireA: t0.Add(62 * time.Second)},
		},
		ContinueAccepte: continueAccepte,
	}
}

type canalFactice struct {
	mu         sync.Mutex
	etat       local.Etat
	reponses   []local.DemandeReponse
	ouvertures []local.DemandeOuverture
	refus      error
}

func (c *canalFactice) Etat(context.Context) (local.Etat, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.etat, nil
}
func (c *canalFactice) Taches(context.Context) ([]planning.Tache, error) {
	return []planning.Tache{{ID: "123", Nom: "DM de maths"}, {ID: "124", Nom: "Exposé"}}, nil
}
func (c *canalFactice) OuvrirSession(_ context.Context, d local.DemandeOuverture) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.refus != nil {
		return c.refus
	}
	c.ouvertures = append(c.ouvertures, d)
	return nil
}
func (c *canalFactice) Repondre(_ context.Context, _ string, d local.DemandeReponse) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reponses = append(c.reponses, d)
	return nil
}

type dialoguesFactices struct {
	mu        sync.Mutex
	continuer bool
	bloquer   bool // Question attend l'annulation du contexte
	attentes  []time.Duration
	erreurs   []string
	infos     []string
	saisie    string
}

func (d *dialoguesFactices) Question(ctx context.Context, _ string) (bool, error) {
	if d.bloquer {
		<-ctx.Done()
		return false, ctx.Err()
	}
	return d.continuer, nil
}
func (d *dialoguesFactices) Patienter(_ context.Context, _ string, duree time.Duration, _ bool) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.attentes = append(d.attentes, duree)
	return nil
}
func (d *dialoguesFactices) Choisir(_ context.Context, _ string, options []string) (string, error) {
	return options[0], nil
}
func (d *dialoguesFactices) Saisir(_ context.Context, _, defaut string) (string, error) {
	if d.saisie == "" {
		return defaut, nil
	}
	return d.saisie, nil
}
func (d *dialoguesFactices) Informer(t string) {
	d.mu.Lock()
	d.infos = append(d.infos, t)
	d.mu.Unlock()
}
func (d *dialoguesFactices) Erreur(t string) {
	d.mu.Lock()
	d.erreurs = append(d.erreurs, t)
	d.mu.Unlock()
}

func nouvelAgent(c *canalFactice, d *dialoguesFactices) *Agent {
	return &Agent{Canal: c, Dialogues: d, Journal: slog.New(slog.NewTextHandler(io.Discard, nil)), Horloge: func() time.Time { return t0 }}
}

func TestQuestionDue(t *testing.T) {
	s := session(false)
	if !QuestionDue(s, t0) {
		t.Error("question posée : due")
	}
	if QuestionDue(s, t0.Add(-2*time.Second)) || QuestionDue(s, s.Question.ExpireA) || QuestionDue(session(true), t0) {
		t.Error("avant posee_a, à expire_a ou après continue : pas due")
	}
	if got := AttenteRestante(*s.Question, t0); got != 2*time.Second {
		t.Errorf("attente restante %v", got)
	}
	if AttenteRestante(*s.Question, t0.Add(time.Minute)) != 0 {
		t.Error("attente passée : 0")
	}
}

func TestContinueAttendAvantDEnvoyer(t *testing.T) {
	c := &canalFactice{etat: local.Etat{Maintenant: t0, Sessions: []local.SessionLocale{session(false)}}}
	d := &dialoguesFactices{continuer: true}
	a := nouvelAgent(c, d)
	a.Tour(context.Background())
	a.Tour(context.Background()) // même question : pas de second dialogue
	a.fond.Wait()
	if len(c.reponses) != 1 || c.reponses[0] != (local.DemandeReponse{QuestionID: "q_07", Reponse: "continue"}) {
		t.Fatalf("réponses %+v", c.reponses)
	}
	if len(d.attentes) != 1 || d.attentes[0] != 2*time.Second+margeContinue {
		t.Errorf("attente avant continue %v", d.attentes)
	}
}

func TestArret(t *testing.T) {
	c := &canalFactice{etat: local.Etat{Maintenant: t0, Sessions: []local.SessionLocale{session(false)}}}
	d := &dialoguesFactices{continuer: false}
	a := nouvelAgent(c, d)
	a.Tour(context.Background())
	a.fond.Wait()
	if len(c.reponses) != 1 || c.reponses[0].Reponse != "arrete" || len(d.attentes) != 0 {
		t.Fatalf("réponses %+v, attentes %v", c.reponses, d.attentes)
	}
}

func TestQuestionRegleeAilleurs(t *testing.T) {
	c := &canalFactice{etat: local.Etat{Maintenant: t0, Sessions: []local.SessionLocale{session(false)}}}
	d := &dialoguesFactices{bloquer: true}
	a := nouvelAgent(c, d)
	a.Tour(context.Background())
	c.mu.Lock()
	c.etat.Sessions = []local.SessionLocale{session(true)} // « continue » accepté depuis une autre session
	c.mu.Unlock()
	a.Tour(context.Background())
	a.fond.Wait()
	if len(c.reponses) != 0 || len(d.infos) != 0 {
		t.Errorf("dialogue fermé sans rien envoyer attendu : réponses %+v, infos %v", c.reponses, d.infos)
	}
}

func TestOuvrir(t *testing.T) {
	c := &canalFactice{etat: local.Etat{Maintenant: t0, Sessions: []local.SessionLocale{session(false)}}}
	d := &dialoguesFactices{saisie: "chatgpt, claude_ai chatgpt"}
	a := nouvelAgent(c, d)
	if err := a.Ouvrir(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if len(c.ouvertures) != 1 || c.ouvertures[0].TacheID != "123" || !slices.Equal(c.ouvertures[0].Apps, []string{"chatgpt", "claude_ai"}) {
		t.Fatalf("ouvertures %+v", c.ouvertures)
	}
	if len(d.attentes) != 1 || d.attentes[0] != AttenteOuverture {
		t.Errorf("attente avant ouverture %v", d.attentes)
	}
	// Apps pré-remplies depuis les sessions connues.
	d2 := &dialoguesFactices{}
	c.ouvertures = nil
	if err := nouvelAgent(c, d2).Ouvrir(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(c.ouvertures[0].Apps, []string{"chatgpt"}) {
		t.Errorf("apps pré-remplies %v", c.ouvertures[0].Apps)
	}
}

func TestOuvrirRefuse(t *testing.T) {
	c := &canalFactice{refus: &api.Erreur{Statut: 409, Code: "sessions_interdites", Message: "Sessions interdites en NIGHT_LOCK."}}
	d := &dialoguesFactices{}
	if err := nouvelAgent(c, d).Ouvrir(context.Background(), []string{"chatgpt"}); err == nil {
		t.Fatal("refus attendu")
	}
	if len(d.erreurs) != 1 || d.erreurs[0] != "Session refusée : Sessions interdites en NIGHT_LOCK." {
		t.Errorf("message affiché %v", d.erreurs)
	}
}
