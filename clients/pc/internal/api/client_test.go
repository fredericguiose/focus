package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

const jetonTest = "jeton-de-test"

type serveurFactice struct {
	mu       sync.Mutex
	planning []byte
	taches   string
	recus    map[string][]byte // chemin → dernier corps reçu
}

func nouveauServeur(t *testing.T) (*serveurFactice, *httptest.Server) {
	t.Helper()
	b, err := os.ReadFile("../planning/testdata/planning.json")
	if err != nil {
		t.Fatal(err)
	}
	f := &serveurFactice{planning: b, taches: `[{"id":"123","nom":"DM de maths"}]`, recus: map[string][]byte{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+jetonTest {
			w.WriteHeader(http.StatusUnauthorized)
			io.WriteString(w, `{"erreur":"jeton_invalide","message":"Jeton inconnu."}`)
			return
		}
		corps, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.recus[r.Method+" "+r.URL.EscapedPath()] = corps
		f.mu.Unlock()
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/planning":
			w.Header().Set("Content-Type", "application/json")
			w.Write(f.planning)
		case r.Method == http.MethodGet && r.URL.Path == "/v1/taches":
			io.WriteString(w, f.taches)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sessions":
			var o OuvertureSession
			json.Unmarshal(corps, &o)
			if o.TacheID == "999" {
				w.WriteHeader(http.StatusConflict)
				io.WriteString(w, `{"erreur":"sessions_interdites","message":"Sessions interdites en NIGHT_LOCK."}`)
				return
			}
			w.WriteHeader(http.StatusCreated)
			io.WriteString(w, `{"id":"s_02"}`)
		case r.Method == http.MethodPost && (r.URL.Path == "/v1/accuses" || r.URL.Path == "/v1/evenements" ||
			strings.HasPrefix(r.URL.Path, "/v1/sessions/")):
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return f, srv
}

func client(srv *httptest.Server, jeton string) *Client {
	return Nouveau(srv.URL+"/", func() (string, error) { return jeton, nil })
}

func TestPlanning(t *testing.T) {
	_, srv := nouveauServeur(t)
	avant := time.Now()
	p, recu, err := client(srv, jetonTest).Planning(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if recu.Before(avant) {
		t.Error("heure de réception antérieure à la requête")
	}
	if p.Appareil != "pc_linux" || len(p.Segments) != 3 || len(p.Sessions) != 1 {
		t.Errorf("planning mal lu : %+v", p)
	}
	s := p.Sessions[0]
	if s.Question == nil || s.Question.AttenteS != 3 || s.Tache.Nom != "DM de maths" {
		t.Errorf("session mal lue : %+v", s)
	}
	if !p.Segments[1].Actions.VerrouillerSession || p.Segments[0].Actions.BloquerDomaines[0] != "chatgpt.com" {
		t.Errorf("actions mal lues : %+v", p.Segments)
	}
}

func TestPlanningRefuse(t *testing.T) {
	f, srv := nouveauServeur(t)
	_, _, err := client(srv, "mauvais").Planning(context.Background())
	var e *Erreur
	if !errors.As(err, &e) || e.Statut != 401 || e.Code != "jeton_invalide" || e.Message != "Jeton inconnu." {
		t.Fatalf("erreur attendue 401 jeton_invalide, obtenu %v", err)
	}
	f.planning = []byte(`{"version": 2, "heure_serveur": "2026-11-03T21:00:00Z", "valable_jusqua": "2026-11-05T09:00:00Z"}`)
	if _, _, err := client(srv, jetonTest).Planning(context.Background()); err == nil {
		t.Error("version de format inconnue acceptée")
	}
	f.planning = []byte(`<html>`)
	if _, _, err := client(srv, jetonTest).Planning(context.Background()); err == nil {
		t.Error("réponse non JSON acceptée")
	}
}

func TestAccusesEtEvenements(t *testing.T) {
	f, srv := nouveauServeur(t)
	c := client(srv, jetonTest)
	pose := time.Date(2026, 11, 3, 23, 30, 0, 0, time.UTC)
	if err := c.Accuser(context.Background(), Accuse{Action: "verrouiller_session", PoseLe: pose}); err != nil {
		t.Fatal(err)
	}
	if got := string(f.recus["POST /v1/accuses"]); got != `{"action":"verrouiller_session","pose_le":"2026-11-03T23:30:00Z"}` {
		t.Errorf("corps de l'accusé : %s", got)
	}
	lot := []Evenement{{Type: "reconnexion", Le: pose, Compte: "alice", Session: "3"}}
	if err := c.Evenements(context.Background(), lot); err != nil {
		t.Fatal(err)
	}
	if got := string(f.recus["POST /v1/evenements"]); got != `{"evenements":[{"type":"reconnexion","debut":"2026-11-03T23:30:00Z","compte":"alice","session":"3"}]}` {
		t.Errorf("corps des événements : %s", got)
	}
}

func TestTaches(t *testing.T) {
	f, srv := nouveauServeur(t)
	c := client(srv, jetonTest)
	for _, forme := range []string{
		`[{"id":"123","nom":"DM de maths"},{"nom":"sans id"}]`,
		`{"taches":[{"id":"123","contenu":"DM de maths","eligible_le":"2026-11-03T08:15:00Z"}]}`,
	} {
		f.taches = forme
		ts, err := c.Taches(context.Background())
		if err != nil {
			t.Fatalf("%s : %v", forme, err)
		}
		if len(ts) != 1 || ts[0].ID != "123" || ts[0].Nom != "DM de maths" {
			t.Errorf("%s : %+v", forme, ts)
		}
	}
}

func TestSessions(t *testing.T) {
	f, srv := nouveauServeur(t)
	c := client(srv, jetonTest)
	if err := c.OuvrirSession(context.Background(), OuvertureSession{Appareil: "pc_linux", TacheID: "123", Apps: []string{"chatgpt"}}); err != nil {
		t.Fatal(err)
	}
	if got := string(f.recus["POST /v1/sessions"]); got != `{"appareil":"pc_linux","tache_id":"123","apps":["chatgpt"]}` {
		t.Errorf("corps de l'ouverture : %s", got)
	}
	err := c.OuvrirSession(context.Background(), OuvertureSession{Appareil: "pc_linux", TacheID: "999"})
	var e *Erreur
	if !errors.As(err, &e) || e.Code != "sessions_interdites" {
		t.Errorf("refus attendu : %v", err)
	}
	if err := c.Repondre(context.Background(), "s/01", Reponse{QuestionID: "q_07", Reponse: "continue"}); err != nil {
		t.Fatal(err)
	}
	if got := string(f.recus["POST /v1/sessions/s%2F01/reponse"]); got != `{"question_id":"q_07","reponse":"continue"}` {
		t.Errorf("réponse mal adressée ou mal formée : %q (reçus %v)", got, f.recus)
	}
}
