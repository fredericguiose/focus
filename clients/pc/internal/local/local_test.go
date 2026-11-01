package local

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/api"
	"github.com/fredericguiose/focus/clients/pc/internal/planning"
)

type fournisseurFactice struct {
	ouvertures []DemandeOuverture
	reponses   map[string]DemandeReponse
}

func (f *fournisseurFactice) Etat() Etat {
	return Etat{Maintenant: time.Date(2026, 11, 3, 21, 25, 0, 0, time.UTC), Mode: "WORK", SessionsPermises: true,
		Sessions: []SessionLocale{{Session: planning.Session{ID: "s_01", Tache: planning.Tache{ID: "123", Nom: "DM de maths"}}}}}
}

func (f *fournisseurFactice) Taches(context.Context) ([]planning.Tache, error) {
	return []planning.Tache{{ID: "123", Nom: "DM de maths"}}, nil
}

func (f *fournisseurFactice) OuvrirSession(_ context.Context, d DemandeOuverture) error {
	if d.TacheID == "999" {
		return &api.Erreur{Statut: 409, Code: "sessions_interdites", Message: "Sessions interdites en NIGHT_LOCK."}
	}
	if d.TacheID == "500" {
		return errors.New("délai dépassé")
	}
	f.ouvertures = append(f.ouvertures, d)
	return nil
}

func (f *fournisseurFactice) Repondre(_ context.Context, id string, d DemandeReponse) error {
	f.reponses[id] = d
	return nil
}

func TestAllerRetour(t *testing.T) {
	f := &fournisseurFactice{reponses: map[string]DemandeReponse{}}
	srv := httptest.NewServer(Gestionnaire(f))
	defer srv.Close()
	c := NouveauClient(strings.TrimPrefix(srv.URL, "http://"))
	ctx := context.Background()

	e, err := c.Etat(ctx)
	if err != nil || e.Mode != "WORK" || len(e.Sessions) != 1 || e.Sessions[0].Tache.Nom != "DM de maths" {
		t.Fatalf("état %+v, %v", e, err)
	}
	ts, err := c.Taches(ctx)
	if err != nil || len(ts) != 1 {
		t.Fatalf("tâches %+v, %v", ts, err)
	}
	if err := c.OuvrirSession(ctx, DemandeOuverture{TacheID: "123", Apps: []string{"chatgpt"}}); err != nil {
		t.Fatal(err)
	}
	if len(f.ouvertures) != 1 || f.ouvertures[0].Apps[0] != "chatgpt" {
		t.Errorf("ouvertures %+v", f.ouvertures)
	}
	if err := c.Repondre(ctx, "s_01", DemandeReponse{QuestionID: "q_07", Reponse: "continue"}); err != nil {
		t.Fatal(err)
	}
	if f.reponses["s_01"].Reponse != "continue" {
		t.Errorf("réponses %+v", f.reponses)
	}

	// Les refus de l'API remontent avec leur message, pour être affichés tels quels.
	err = c.OuvrirSession(ctx, DemandeOuverture{TacheID: "999", Apps: []string{"chatgpt"}})
	var ae *api.Erreur
	if !errors.As(err, &ae) || ae.Statut != 409 || ae.Message != "Sessions interdites en NIGHT_LOCK." {
		t.Errorf("refus de l'API : %v", err)
	}
	err = c.OuvrirSession(ctx, DemandeOuverture{TacheID: "500", Apps: []string{"chatgpt"}})
	if !errors.As(err, &ae) || ae.Statut != http.StatusBadGateway || ae.Code != "api_injoignable" {
		t.Errorf("API injoignable : %v", err)
	}
	for _, d := range []DemandeReponse{{QuestionID: "q_07", Reponse: "peut-être"}, {Reponse: "continue"}} {
		if err := c.Repondre(ctx, "s_01", d); !errors.As(err, &ae) || ae.Statut != 400 {
			t.Errorf("réponse invalide %+v acceptée : %v", d, err)
		}
	}
	if err := c.OuvrirSession(ctx, DemandeOuverture{TacheID: "123"}); !errors.As(err, &ae) || ae.Statut != 400 {
		t.Errorf("ouverture sans app acceptée : %v", err)
	}
}

func TestGarde(t *testing.T) {
	f := &fournisseurFactice{reponses: map[string]DemandeReponse{}}
	h := Gestionnaire(f)
	cas := []struct {
		nom     string
		req     func() *http.Request
		attendu int
	}{
		{"sans en-tête (page web)", func() *http.Request {
			return httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47600/etat", nil)
		}, http.StatusForbidden},
		{"rebond DNS", func() *http.Request {
			r := httptest.NewRequest(http.MethodGet, "http://evil.example:47600/etat", nil)
			r.Header.Set(EnTete, "1")
			return r
		}, http.StatusForbidden},
		{"formulaire au lieu de JSON", func() *http.Request {
			r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47600/sessions", strings.NewReader("tache_id=123"))
			r.Header.Set(EnTete, "1")
			r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			return r
		}, http.StatusUnsupportedMediaType},
		{"champ inconnu", func() *http.Request {
			r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:47600/sessions", strings.NewReader(`{"tache_id":"1","apps":["a"],"appareil":"autre"}`))
			r.Header.Set(EnTete, "1")
			r.Header.Set("Content-Type", "application/json")
			return r
		}, http.StatusBadRequest},
		{"agent légitime", func() *http.Request {
			r := httptest.NewRequest(http.MethodGet, "http://localhost:47600/etat", nil)
			r.Header.Set(EnTete, "1")
			return r
		}, http.StatusOK},
	}
	for _, c := range cas {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, c.req())
		if w.Code != c.attendu {
			t.Errorf("%s : %d, attendu %d", c.nom, w.Code, c.attendu)
		}
	}
}
