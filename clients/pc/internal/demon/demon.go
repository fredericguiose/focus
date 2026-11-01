// Paquet demon : la boucle de focusd. Récupère le planning, le garde en cache, applique le
// segment en vigueur (hosts, verrou, comptes), envoie accusés et événements, et sert l'agent.
package demon

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/api"
	"github.com/fredericguiose/focus/clients/pc/internal/comptes"
	"github.com/fredericguiose/focus/clients/pc/internal/hosts"
	"github.com/fredericguiose/focus/clients/pc/internal/local"
	"github.com/fredericguiose/focus/clients/pc/internal/planning"
	"github.com/fredericguiose/focus/clients/pc/internal/verrou"
)

// File d'attente bornée : hors ligne pendant des jours, on garde les plus récents.
const attenteMax = 200

const (
	ActionDomaines = "bloquer_domaines"
	ActionVerrou   = "verrouiller_session"
	ActionComptes  = "fermer_comptes_hors_travail"
)

type Options struct {
	API         *api.Client
	Appareil    string
	HoteAPI     string
	CacheChemin string
	Hosts       hosts.Applicateur
	ViderDNS    func() error
	Verrou      verrou.Verrou
	Comptes     comptes.Gestionnaire
	// SansEffet : n'envoie pas d'accusés (aucun verrou n'est réellement posé).
	SansEffet   bool
	Journal     *slog.Logger
	Horloge     func() time.Time
	Rafraichir  time.Duration
	Application time.Duration
}

type Demon struct {
	o Options

	// applique sérialise les applicateurs (boucle, réponse de l'agent, rafraîchissement) :
	// ils ne sont pas prévus pour des appels concurrents.
	applique sync.Mutex

	mu        sync.Mutex
	plan      *planning.Planning
	horloge   planning.Horloge
	horsLigne bool
	erreurAPI string            // dernière erreur de GET /v1/planning journalisée
	continues map[string]string // session → question pour laquelle « continue » a été accepté
	fermees   map[string]bool   // sessions arrêtées ici, en attente du prochain planning
	accuses   map[string]bool   // actions déjà accusées pour le segment en cours
	// segment : mode et fin du segment en cours. Pas son début : l'API fait commencer le
	// premier segment à l'heure de la requête, il change à chaque rafraîchissement.
	segment   string
	enAttente struct {
		accuses    []api.Accuse
		evenements []api.Evenement
	}
	erreurs map[string]string

	reveilReseau chan struct{}
	fond         sync.WaitGroup // rafraîchissements lancés en arrière-plan
}

// RafraichirParDefaut : intervalle entre deux GET /v1/planning (option --rafraichir de focusd).
// 30 s : un changement fait ailleurs (Todoist, web app) arrive vite sur le PC ; l'API garde le
// planning au plus 60 s mais efface ce résultat à chaque écriture d'état.
const RafraichirParDefaut = 30 * time.Second

func Nouveau(o Options) *Demon {
	if o.Horloge == nil {
		o.Horloge = time.Now
	}
	if o.Rafraichir == 0 {
		o.Rafraichir = RafraichirParDefaut
	}
	if o.Application == 0 {
		o.Application = 2 * time.Second
	}
	return &Demon{
		o:            o,
		horsLigne:    true,
		continues:    map[string]string{},
		fermees:      map[string]bool{},
		accuses:      map[string]bool{},
		erreurs:      map[string]string{},
		reveilReseau: make(chan struct{}, 1),
	}
}

func (d *Demon) maintenant() time.Time {
	return d.horloge.Maintenant(d.o.Horloge())
}

// ChargerCache reprend le dernier planning connu (démarrage hors ligne, redémarrage).
func (d *Demon) ChargerCache() error {
	c, err := planning.LireCache(d.o.CacheChemin)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.plan = c.Planning
	d.horloge = c.Horloge()
	return nil
}

// Rafraichir récupère le planning ; en cas d'échec, le planning en mémoire (ou en cache) reste.
func (d *Demon) Rafraichir(ctx context.Context) error {
	p, recu, err := d.o.API.Planning(ctx)
	if err != nil {
		d.mu.Lock()
		// Au démarrage, horsLigne vaut déjà vrai : sans ce suivi, une API injoignable ou un
		// jeton refusé dès l'installation ne laissait aucune trace dans le journal.
		if !d.horsLigne || err.Error() != d.erreurAPI {
			if d.plan == nil {
				d.o.Journal.Warn("API injoignable et aucun planning connu : rien n'est appliqué", "erreur", err)
			} else {
				d.o.Journal.Warn("API injoignable : rejeu du dernier planning", "erreur", err)
			}
		}
		d.horsLigne, d.erreurAPI = true, err.Error()
		d.mu.Unlock()
		return err
	}
	if p.Appareil != "" && p.Appareil != d.o.Appareil {
		d.o.Journal.Warn("le jeton désigne un autre appareil que la config", "planning", p.Appareil, "config", d.o.Appareil)
	}
	h := planning.Caler(p.HeureServeur, recu)
	d.mu.Lock()
	if d.horsLigne {
		d.o.Journal.Info("planning reçu", "config_version", p.ConfigVersion, "decalage", h.Decalage.Round(time.Millisecond))
	}
	d.plan, d.horloge, d.horsLigne, d.erreurAPI = p, h, false, ""
	presentes := map[string]*planning.Session{}
	for i := range p.Sessions {
		presentes[p.Sessions[i].ID] = &p.Sessions[i]
	}
	for id, q := range d.continues {
		s := presentes[id]
		if s == nil || (s.Question != nil && s.Question.ID != q) {
			delete(d.continues, id) // question suivante connue : l'accord précédent ne sert plus
		}
	}
	for id := range d.fermees {
		if presentes[id] == nil {
			delete(d.fermees, id)
		}
	}
	d.mu.Unlock()

	if err := planning.EcrireCache(d.o.CacheChemin, planning.Cache{
		Planning: p, DecalageMs: h.Decalage.Milliseconds(), RecuLe: recu,
	}); err != nil {
		d.o.Journal.Error("écriture du cache", "erreur", err)
	}
	d.envoyerEnAttente(ctx)
	return nil
}

// evaluer calcule l'état à appliquer, sessions arrêtées localement exclues.
func (d *Demon) evaluer() (planning.Etat, time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	t := d.maintenant()
	p := d.plan
	if p != nil && len(d.fermees) > 0 {
		copie := *p
		copie.Sessions = slices.DeleteFunc(slices.Clone(p.Sessions), func(s planning.Session) bool { return d.fermees[s.ID] })
		p = &copie
	}
	return planning.Evaluer(p, t, d.continues), t
}

// Appliquer pose l'état du moment. Appelé toutes les 2 s : chaque applicateur est idempotent.
func (d *Demon) Appliquer() {
	d.applique.Lock()
	defer d.applique.Unlock()
	e, t := d.evaluer()
	// Bloquer l'API couperait le client de tout planning futur.
	domaines := slices.DeleteFunc(slices.Clone(e.Domaines), func(x string) bool { return x == d.o.HoteAPI })

	change, errH := d.o.Hosts.Appliquer(domaines)
	d.signaler("hosts", errH)
	if errH == nil && change {
		d.o.Journal.Info("fichier hosts mis à jour", "domaines", len(domaines))
		if d.o.ViderDNS != nil {
			d.signaler("dns", d.o.ViderDNS())
		}
	}
	errV := d.o.Verrou.Appliquer(e.Verrouiller)
	d.signaler("verrou", errV)
	errC := d.o.Comptes.Appliquer(e.FermerComptes, e.ComptesDeTravail)
	d.signaler("comptes", errC)

	if e.Segment == nil {
		return
	}
	d.mu.Lock()
	if cle := e.Segment.Mode + "|" + e.Segment.Fin.UTC().Format(time.RFC3339); cle != d.segment {
		d.segment = cle
		clear(d.accuses)
		d.o.Journal.Info("segment en vigueur", "mode", e.Segment.Mode, "jusqua", e.Segment.Fin)
	}
	d.mu.Unlock()
	if len(domaines) > 0 && errH == nil {
		d.accuser(ActionDomaines, t)
	}
	if e.Verrouiller && errV == nil {
		d.accuser(ActionVerrou, t)
	}
	if e.FermerComptes && errC == nil {
		d.accuser(ActionComptes, t)
	}
}

func (d *Demon) accuser(action string, t time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.accuses[action] {
		return
	}
	d.accuses[action] = true
	if d.o.SansEffet {
		d.o.Journal.Info("sans effet : accusé non envoyé", "action", action, "pose_le", t)
		return
	}
	d.enAttente.accuses = borner(append(d.enAttente.accuses, api.Accuse{Action: action, PoseLe: t}))
	d.reveiller()
}

// Reconnexion est appelée par le verrou quand une session est rouverte pendant un segment
// verrouillé.
func (d *Demon) Reconnexion(r verrou.Reconnexion) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.enAttente.evenements = borner(append(d.enAttente.evenements, api.Evenement{
		Type: "reconnexion", Le: d.horloge.Maintenant(r.Le), Compte: r.Compte, Session: r.Session,
	}))
	d.reveiller()
}

func (d *Demon) reveiller() {
	select {
	case d.reveilReseau <- struct{}{}:
	default:
	}
}

func borner[T any](s []T) []T {
	if len(s) > attenteMax {
		return s[len(s)-attenteMax:]
	}
	return s
}

// definitive : refus 4xx (hors 429) : renvoyer la même demande ne changera rien.
func definitive(err error) bool {
	var e *api.Erreur
	return errors.As(err, &e) && e.Statut/100 == 4 && e.Statut != 429
}

func (d *Demon) envoyerEnAttente(ctx context.Context) {
	d.mu.Lock()
	accuses, evenements := d.enAttente.accuses, d.enAttente.evenements
	d.enAttente.accuses, d.enAttente.evenements = nil, nil
	d.mu.Unlock()

	var resteA []api.Accuse
	for i, a := range accuses {
		err := d.o.API.Accuser(ctx, a)
		if err == nil {
			continue
		}
		if definitive(err) {
			d.o.Journal.Error("accusé refusé", "action", a.Action, "erreur", err)
			continue
		}
		resteA = accuses[i:]
		break
	}
	var resteE []api.Evenement
	if err := d.o.API.Evenements(ctx, evenements); err != nil {
		if definitive(err) {
			d.o.Journal.Error("événements refusés", "nombre", len(evenements), "erreur", err)
		} else {
			resteE = evenements
		}
	}
	if len(resteA) == 0 && len(resteE) == 0 {
		return
	}
	d.mu.Lock()
	d.enAttente.accuses = borner(append(resteA, d.enAttente.accuses...))
	d.enAttente.evenements = borner(append(resteE, d.enAttente.evenements...))
	d.mu.Unlock()
}

// signaler journalise une erreur seulement quand elle change : la boucle tourne toutes les 2 s.
func (d *Demon) signaler(composant string, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	texte := ""
	if err != nil {
		texte = err.Error()
	}
	if d.erreurs[composant] == texte {
		return
	}
	d.erreurs[composant] = texte
	if err != nil {
		d.o.Journal.Error("application", "composant", composant, "erreur", err)
	} else {
		d.o.Journal.Info("application rétablie", "composant", composant)
	}
}

// Executer tourne jusqu'à l'annulation du contexte.
func (d *Demon) Executer(ctx context.Context) {
	d.Appliquer() // depuis le cache, avant tout accès réseau
	go d.boucleReseau(ctx)
	tic := time.NewTicker(d.o.Application)
	defer tic.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tic.C:
			d.Appliquer()
		}
	}
}

func (d *Demon) boucleReseau(ctx context.Context) {
	rafraichir := func() {
		c, annuler := context.WithTimeout(ctx, 30*time.Second)
		defer annuler()
		_ = d.Rafraichir(c)
	}
	rafraichir()
	tic := time.NewTicker(d.o.Rafraichir)
	defer tic.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tic.C:
			rafraichir()
		case <-d.reveilReseau:
			d.mu.Lock()
			enLigne := !d.horsLigne
			d.mu.Unlock()
			if enLigne {
				c, annuler := context.WithTimeout(ctx, 30*time.Second)
				d.envoyerEnAttente(c)
				annuler()
			}
		}
	}
}

// DemanderRafraichissement : après une ouverture ou une réponse, le planning change tout de
// suite côté API ; inutile d'attendre la minute suivante.
func (d *Demon) DemanderRafraichissement(ctx context.Context) {
	d.fond.Add(1)
	go func() {
		defer d.fond.Done()
		c, annuler := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer annuler()
		if err := d.Rafraichir(c); err == nil {
			d.Appliquer()
		}
	}()
}

// Lever retire tout ce que Focus a posé (désinstallation, dépannage). Le verrou de session
// n'est pas défait : seul l'utilisateur déverrouille sa session.
func (d *Demon) Lever() error {
	d.applique.Lock()
	defer d.applique.Unlock()
	_, errH := d.o.Hosts.Appliquer(nil)
	errV := d.o.Verrou.Appliquer(false)
	errC := d.o.Comptes.Appliquer(false, nil)
	return errors.Join(errH, errV, errC)
}

// ─── Canal local (focus-agent) ───────────────────────────────────────────────

var _ local.Fournisseur = (*Demon)(nil)

func (d *Demon) Etat() local.Etat {
	d.mu.Lock()
	defer d.mu.Unlock()
	t := d.maintenant()
	e := local.Etat{Maintenant: t, HorsLigne: d.horsLigne, Sessions: []local.SessionLocale{}}
	if d.plan == nil || !t.Before(d.plan.ValableJusqua) {
		return e
	}
	seg := planning.SegmentEnVigueur(d.plan, t)
	if seg != nil {
		e.Mode = seg.Mode
	}
	e.SessionsPermises = planning.SessionsPermises(seg)
	if !e.SessionsPermises {
		// Aucune session ne libère rien : pas de question à poser à leur sujet.
		return e
	}
	for _, s := range d.plan.Sessions {
		if d.fermees[s.ID] || s.Terminee(t) {
			continue
		}
		accepte := s.Question != nil && d.continues[s.ID] == s.Question.ID
		e.Sessions = append(e.Sessions, local.SessionLocale{Session: s, ContinueAccepte: accepte})
	}
	return e
}

func (d *Demon) Taches(ctx context.Context) ([]planning.Tache, error) {
	return d.o.API.Taches(ctx)
}

func (d *Demon) OuvrirSession(ctx context.Context, o local.DemandeOuverture) error {
	err := d.o.API.OuvrirSession(ctx, api.OuvertureSession{Appareil: d.o.Appareil, TacheID: o.TacheID, Apps: o.Apps})
	if err != nil {
		return err
	}
	d.o.Journal.Info("session ouverte", "tache", o.TacheID, "apps", o.Apps)
	d.DemanderRafraichissement(ctx)
	return nil
}

func (d *Demon) Repondre(ctx context.Context, sessionID string, r local.DemandeReponse) error {
	if err := d.o.API.Repondre(ctx, sessionID, api.Reponse{QuestionID: r.QuestionID, Reponse: r.Reponse}); err != nil {
		return err
	}
	d.mu.Lock()
	if r.Reponse == "continue" {
		d.continues[sessionID] = r.QuestionID
	} else {
		delete(d.continues, sessionID)
		d.fermees[sessionID] = true
	}
	d.mu.Unlock()
	d.o.Journal.Info("réponse à la question de session", "session", sessionID, "reponse", r.Reponse)
	d.Appliquer()
	d.DemanderRafraichissement(ctx)
	return nil
}
