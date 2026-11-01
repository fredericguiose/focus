package demon

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/api"
	"github.com/fredericguiose/focus/clients/pc/internal/hosts"
	"github.com/fredericguiose/focus/clients/pc/internal/local"
	"github.com/fredericguiose/focus/clients/pc/internal/verrou"
)

type horlogeFactice struct {
	mu sync.Mutex
	t  time.Time
}

func (h *horlogeFactice) lire() time.Time {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.t
}

func (h *horlogeFactice) avancer(d time.Duration) {
	h.mu.Lock()
	h.t = h.t.Add(d)
	h.mu.Unlock()
}

type verrouFactice struct{ actif bool }

func (v *verrouFactice) Appliquer(actif bool) error { v.actif = actif; return nil }
func (v *verrouFactice) Fermer() error              { return nil }

type comptesFactices struct {
	actif   bool
	travail []string
}

func (c *comptesFactices) Appliquer(actif bool, travail []string) error {
	c.actif, c.travail = actif, travail
	return nil
}
func (c *comptesFactices) Fermer() error { return nil }

type apiFactice struct {
	mu         sync.Mutex
	enPanne    bool
	accuses    []api.Accuse
	evenements []api.Evenement
	reponses   []string
	planning   []byte
}

func (f *apiFactice) serveur(t *testing.T) *httptest.Server {
	planning, err := os.ReadFile("../planning/testdata/planning.json")
	if err != nil {
		t.Fatal(err)
	}
	f.planning = planning
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.enPanne {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		corps, _ := io.ReadAll(r.Body)
		switch r.URL.Path {
		case "/v1/planning":
			w.Write(f.planning)
		case "/v1/accuses":
			var a api.Accuse
			json.Unmarshal(corps, &a)
			f.accuses = append(f.accuses, a)
			w.WriteHeader(http.StatusNoContent)
		case "/v1/evenements":
			var lot struct {
				Evenements []api.Evenement `json:"evenements"`
			}
			json.Unmarshal(corps, &lot)
			f.evenements = append(f.evenements, lot.Evenements...)
			w.WriteHeader(http.StatusNoContent)
		case "/v1/sessions/s_01/reponse":
			f.reponses = append(f.reponses, string(corps))
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

type banc struct {
	d       *Demon
	horloge *horlogeFactice
	api     *apiFactice
	hosts   string
	verrou  *verrouFactice
	comptes *comptesFactices
	cache   string
}

// L'horloge locale retarde d'une heure sur le serveur : 20:00 local = 21:00 serveur.
func nouveauBanc(t *testing.T, hoteAPI string) *banc {
	t.Helper()
	dir := t.TempDir()
	b := &banc{
		horloge: &horlogeFactice{t: time.Date(2026, 11, 3, 20, 0, 0, 0, time.UTC)},
		api:     &apiFactice{},
		hosts:   filepath.Join(dir, "hosts"),
		verrou:  &verrouFactice{},
		comptes: &comptesFactices{},
		cache:   filepath.Join(dir, "planning.json"),
	}
	if err := os.WriteFile(b.hosts, []byte("127.0.0.1 localhost\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := b.api.serveur(t)
	client := api.Nouveau(srv.URL, func() (string, error) { return "jeton", nil })
	client.Horloge = b.horloge.lire
	b.d = Nouveau(Options{
		API: client, Appareil: "pc_linux", HoteAPI: hoteAPI, CacheChemin: b.cache,
		Hosts: hosts.Fichier{Chemin: b.hosts}, Verrou: b.verrou, Comptes: b.comptes,
		Journal: slog.New(slog.NewTextHandler(io.Discard, nil)), Horloge: b.horloge.lire,
	})
	return b
}

func (b *banc) bloques(t *testing.T) []string {
	t.Helper()
	c, err := os.ReadFile(b.hosts)
	if err != nil {
		t.Fatal(err)
	}
	var d []string
	for _, l := range strings.Split(string(c), "\n") {
		if nom, ok := strings.CutPrefix(l, "0.0.0.0 "); ok {
			d = append(d, nom)
		}
	}
	return d
}

func (b *banc) panne(oui bool) {
	b.api.mu.Lock()
	b.api.enPanne = oui
	b.api.mu.Unlock()
}

func TestCycleEnLigne(t *testing.T) {
	b := nouveauBanc(t, "focus.exemple.dev")
	ctx := context.Background()
	if err := b.d.Rafraichir(ctx); err != nil {
		t.Fatal(err)
	}
	b.horloge.avancer(10 * time.Minute) // 21:10 serveur, session s_01 valide
	b.d.Appliquer()
	if got := b.bloques(t); !slices.Equal(got, []string{"www.youtube.com", "youtube.com"}) {
		t.Errorf("domaines bloqués %v", got)
	}
	if b.verrou.actif || !b.comptes.actif || !slices.Equal(b.comptes.travail, []string{"alice"}) {
		t.Errorf("verrou=%v comptes=%+v", b.verrou.actif, b.comptes)
	}
	b.d.envoyerEnAttente(ctx)
	b.d.Appliquer() // pas de second accusé pour le même segment
	b.d.envoyerEnAttente(ctx)
	if len(b.api.accuses) != 2 || b.api.accuses[0].Action != ActionDomaines || b.api.accuses[1].Action != ActionComptes {
		t.Fatalf("accusés %+v", b.api.accuses)
	}
	if !b.api.accuses[0].PoseLe.Equal(time.Date(2026, 11, 3, 21, 10, 0, 0, time.UTC)) {
		t.Errorf("pose_le doit être l'instant serveur : %s", b.api.accuses[0].PoseLe)
	}
	// Le cache a été écrit avec le décalage.
	lu, err := os.ReadFile(b.cache)
	if err != nil || !json.Valid(lu) {
		t.Fatalf("cache : %v", err)
	}
}

// L'API fait commencer le premier segment à l'heure de la requête : un rafraîchissement
// ne doit pas faire renvoyer les accusés du même segment.
func TestPasDeNouvelAccuseQuandSeulLeDebutBouge(t *testing.T) {
	b := nouveauBanc(t, "")
	ctx := context.Background()
	if err := b.d.Rafraichir(ctx); err != nil {
		t.Fatal(err)
	}
	b.horloge.avancer(10 * time.Minute)
	b.d.Appliquer()
	b.d.envoyerEnAttente(ctx)
	b.api.mu.Lock()
	b.api.planning = []byte(strings.Replace(string(b.api.planning),
		`"debut": "2026-11-03T21:00:00Z"`, `"debut": "2026-11-03T21:10:00Z"`, 1))
	b.api.mu.Unlock()
	if err := b.d.Rafraichir(ctx); err != nil {
		t.Fatal(err)
	}
	b.d.Appliquer()
	b.d.envoyerEnAttente(ctx)
	if len(b.api.accuses) != 2 {
		t.Fatalf("accusés %+v", b.api.accuses)
	}
}

func TestQuestionExpireeEtContinue(t *testing.T) {
	b := nouveauBanc(t, "")
	ctx := context.Background()
	if err := b.d.Rafraichir(ctx); err != nil {
		t.Fatal(err)
	}
	b.horloge.avancer(25*time.Minute + 10*time.Second) // 21:25:10, question posée
	if err := b.d.Repondre(ctx, "s_01", local.DemandeReponse{QuestionID: "q_07", Reponse: "continue"}); err != nil {
		t.Fatal(err)
	}
	b.d.fond.Wait()
	b.horloge.avancer(5 * time.Minute) // 21:30:10, expire_a passé mais « continue » accepté
	b.d.Appliquer()
	if slices.Contains(b.bloques(t), "chatgpt.com") {
		t.Error("après un continue accepté, chatgpt.com ne doit pas être bloqué")
	}
	if e := b.d.Etat(); len(e.Sessions) != 1 || !e.Sessions[0].ContinueAccepte || !e.SessionsPermises || e.Mode != "WORK" {
		t.Errorf("état local %+v", e)
	}
	if len(b.api.reponses) != 1 || b.api.reponses[0] != `{"question_id":"q_07","reponse":"continue"}` {
		t.Errorf("réponses envoyées %v", b.api.reponses)
	}
}

func TestArretReBloqueAussitot(t *testing.T) {
	b := nouveauBanc(t, "")
	ctx := context.Background()
	if err := b.d.Rafraichir(ctx); err != nil {
		t.Fatal(err)
	}
	b.horloge.avancer(25*time.Minute + 10*time.Second)
	b.d.Appliquer()
	if slices.Contains(b.bloques(t), "chatgpt.com") {
		t.Fatal("session valide : chatgpt.com libre attendu")
	}
	b.panne(true) // la réponse échoue : rien ne doit changer
	err := b.d.Repondre(ctx, "s_01", local.DemandeReponse{QuestionID: "q_07", Reponse: "arrete"})
	if err == nil {
		t.Fatal("API en panne : erreur attendue")
	}
	b.panne(false)
	if err := b.d.Repondre(ctx, "s_01", local.DemandeReponse{QuestionID: "q_07", Reponse: "arrete"}); err != nil {
		t.Fatal(err)
	}
	b.d.fond.Wait()
	if !slices.Contains(b.bloques(t), "chatgpt.com") {
		t.Error("après « j'arrête », chatgpt.com doit être rebloqué sans attendre le planning suivant")
	}
}

func TestHorsLigneRejoueLeCache(t *testing.T) {
	b := nouveauBanc(t, "")
	if err := b.d.Rafraichir(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Redémarrage sans réseau : un nouveau démon ne dispose que du cache.
	b.panne(true)
	b2 := Nouveau(b.d.o)
	if err := b2.ChargerCache(); err != nil {
		t.Fatal(err)
	}
	if err := b2.Rafraichir(context.Background()); err == nil {
		t.Fatal("API en panne : erreur attendue")
	}
	b.horloge.avancer(3*time.Hour + 45*time.Minute) // 23:45 serveur : NIGHT_LOCK
	b2.Appliquer()
	if !b.verrou.actif || b.comptes.actif {
		t.Errorf("NIGHT_LOCK depuis le cache : verrou=%v comptes=%v", b.verrou.actif, b.comptes.actif)
	}
	if !b2.Etat().HorsLigne {
		t.Error("état local : hors ligne attendu")
	}
	// Au-delà de valable_jusqua (05/11 09:00 serveur), tout est levé.
	b.horloge.avancer(34 * time.Hour)
	b2.Appliquer()
	if len(b.bloques(t)) != 0 || b.verrou.actif || b.comptes.actif {
		t.Errorf("planning expiré : tout doit être levé (hosts %v)", b.bloques(t))
	}
}

func TestNeBloqueJamaisLAPI(t *testing.T) {
	b := nouveauBanc(t, "youtube.com")
	if err := b.d.Rafraichir(context.Background()); err != nil {
		t.Fatal(err)
	}
	b.d.Appliquer()
	if slices.Contains(b.bloques(t), "youtube.com") {
		t.Error("l'hôte de l'API ne doit jamais être bloqué")
	}
}

func TestReconnexionEnvoyee(t *testing.T) {
	b := nouveauBanc(t, "")
	ctx := context.Background()
	if err := b.d.Rafraichir(ctx); err != nil {
		t.Fatal(err)
	}
	b.d.Reconnexion(verrou.Reconnexion{Compte: "alice", Session: "3", Le: b.horloge.lire()})
	b.panne(true)
	b.d.envoyerEnAttente(ctx) // échec : l'événement reste en file
	b.panne(false)
	b.d.envoyerEnAttente(ctx)
	if len(b.api.evenements) != 1 {
		t.Fatalf("événements %+v", b.api.evenements)
	}
	e := b.api.evenements[0]
	if e.Type != "reconnexion" || e.Compte != "alice" || !e.Le.Equal(time.Date(2026, 11, 3, 21, 0, 0, 0, time.UTC)) {
		t.Errorf("événement %+v", e)
	}
}

func TestSansEffetNAccusePas(t *testing.T) {
	b := nouveauBanc(t, "")
	b.d.o.SansEffet = true
	ctx := context.Background()
	if err := b.d.Rafraichir(ctx); err != nil {
		t.Fatal(err)
	}
	b.d.Appliquer()
	b.d.envoyerEnAttente(ctx)
	if len(b.api.accuses) != 0 {
		t.Errorf("accusés envoyés en mode sans effet : %+v", b.api.accuses)
	}
}

func TestLever(t *testing.T) {
	b := nouveauBanc(t, "")
	if err := b.d.Rafraichir(context.Background()); err != nil {
		t.Fatal(err)
	}
	b.d.Appliquer()
	if len(b.bloques(t)) == 0 {
		t.Fatal("rien de bloqué avant Lever")
	}
	if err := b.d.Lever(); err != nil {
		t.Fatal(err)
	}
	c, _ := os.ReadFile(b.hosts)
	if string(c) != "127.0.0.1 localhost\n" || b.comptes.actif {
		t.Errorf("Lever incomplet : %q", c)
	}
}

type journalCompte struct {
	mu       sync.Mutex
	messages []string
}

func (j *journalCompte) Write(b []byte) (int, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.messages = append(j.messages, string(b))
	return len(b), nil
}

func (j *journalCompte) compter(texte string) int {
	j.mu.Lock()
	defer j.mu.Unlock()
	n := 0
	for _, m := range j.messages {
		if strings.Contains(m, texte) {
			n++
		}
	}
	return n
}

// Essai système : API injoignable dès le démarrage (ou jeton refusé à l'installation) ne
// laissait aucune ligne dans le journal, horsLigne valant déjà vrai.
func TestPremierEchecJournalise(t *testing.T) {
	b := nouveauBanc(t, "")
	j := &journalCompte{}
	b.d.o.Journal = slog.New(slog.NewTextHandler(j, nil))
	b.panne(true)
	for range 3 {
		_ = b.d.Rafraichir(context.Background())
	}
	if n := j.compter("aucun planning connu"); n != 1 {
		t.Fatalf("premier échec sans planning : %d ligne(s), 1 attendue\n%v", n, j.messages)
	}
	b.panne(false)
	if err := b.d.Rafraichir(context.Background()); err != nil {
		t.Fatal(err)
	}
	b.panne(true)
	for range 3 {
		_ = b.d.Rafraichir(context.Background())
	}
	if n := j.compter("rejeu du dernier planning"); n != 1 {
		t.Errorf("échec après un planning reçu : %d ligne(s), 1 attendue", n)
	}
}

// Attaque : « continue » accepté en WORK, puis API coupée. Le démon rejoue le planning en
// cache ; au segment MORNING_LOCK (sessions interdites, écran non verrouillé), la session ne
// doit plus rien libérer, et aucune question ne doit plus être proposée à l'agent.
func TestContinueNeSurvitPasAuSegmentInterdit(t *testing.T) {
	b := nouveauBanc(t, "")
	ctx := context.Background()
	if err := b.d.Rafraichir(ctx); err != nil {
		t.Fatal(err)
	}
	b.horloge.avancer(25*time.Minute + 10*time.Second) // 21:25:10 serveur
	if err := b.d.Repondre(ctx, "s_01", local.DemandeReponse{QuestionID: "q_07", Reponse: "continue"}); err != nil {
		t.Fatal(err)
	}
	b.d.fond.Wait()
	b.panne(true)
	b.horloge.avancer(9 * time.Hour) // MORNING_LOCK (le rafraîchissement après la réponse a recalé l'horloge)
	b.d.Appliquer()
	if !slices.Contains(b.bloques(t), "chatgpt.com") {
		t.Errorf("segment « interdites » : chatgpt.com doit être bloqué malgré le continue (hosts %v)", b.bloques(t))
	}
	if e := b.d.Etat(); e.Mode != "MORNING_LOCK" || e.SessionsPermises || len(e.Sessions) != 0 {
		t.Errorf("état local %+v", e)
	}
}

// Attaque : fin_au_plus_tard (plafond atteint) passée alors qu'un « continue » a été accepté.
func TestContinueNeSurvitPasAFinAuPlusTard(t *testing.T) {
	b := nouveauBanc(t, "")
	b.api.planning = []byte(strings.Replace(string(b.api.planning),
		`"ouverte_le": "2026-11-03T21:00:00Z",`,
		`"ouverte_le": "2026-11-03T21:00:00Z", "fin_au_plus_tard": "2026-11-03T22:00:00Z",`, 1))
	ctx := context.Background()
	if err := b.d.Rafraichir(ctx); err != nil {
		t.Fatal(err)
	}
	b.horloge.avancer(25*time.Minute + 10*time.Second)
	if err := b.d.Repondre(ctx, "s_01", local.DemandeReponse{QuestionID: "q_07", Reponse: "continue"}); err != nil {
		t.Fatal(err)
	}
	b.d.fond.Wait()
	b.panne(true)
	// Le rafraîchissement qui suit la réponse recale l'horloge (heure_serveur fixe du faux
	// serveur) : on vise l'instant serveur, pas l'heure locale.
	vers := func(serveur time.Time) { b.horloge.avancer(serveur.Sub(b.d.Etat().Maintenant)) }
	vers(time.Date(2026, 11, 3, 21, 59, 59, 0, time.UTC))
	b.d.Appliquer()
	if slices.Contains(b.bloques(t), "chatgpt.com") {
		t.Fatal("avant fin_au_plus_tard, chatgpt.com doit rester libre")
	}
	vers(time.Date(2026, 11, 3, 22, 0, 0, 0, time.UTC))
	b.d.Appliquer()
	if !slices.Contains(b.bloques(t), "chatgpt.com") {
		t.Error("à fin_au_plus_tard, chatgpt.com doit être rebloqué malgré le continue")
	}
	if e := b.d.Etat(); len(e.Sessions) != 0 {
		t.Errorf("session terminée encore proposée à l'agent : %+v", e.Sessions)
	}
}
