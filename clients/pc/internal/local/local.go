// Paquet local : canal entre focusd et focus-agent, en HTTP sur la boucle locale.
//
// focusd garde seul le jeton d'appareil (fichier lisible par root/SYSTEM) et relaie vers l'API
// les quelques demandes de l'agent. Ce canal ne donne rien de plus que l'interface web : toutes
// les règles (sessions interdites, attente avant « continue », plafond) sont appliquées par
// l'API. L'en-tête obligatoire et le contrôle de Host empêchent une page web d'y accéder.
package local

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/api"
	"github.com/fredericguiose/focus/clients/pc/internal/planning"
)

const EnTete = "X-Focus-Agent"

type SessionLocale struct {
	planning.Session
	ContinueAccepte bool `json:"continue_accepte"`
}

type Etat struct {
	// Maintenant : instant serveur estimé par focusd (horloge calée).
	Maintenant       time.Time       `json:"maintenant"`
	Mode             string          `json:"mode,omitempty"`
	SessionsPermises bool            `json:"sessions_permises"`
	HorsLigne        bool            `json:"hors_ligne"`
	Sessions         []SessionLocale `json:"sessions"`
}

type DemandeOuverture struct {
	TacheID string   `json:"tache_id"`
	Apps    []string `json:"apps"`
}

type DemandeReponse struct {
	QuestionID string `json:"question_id"`
	Reponse    string `json:"reponse"`
}

type Fournisseur interface {
	Etat() Etat
	Taches(ctx context.Context) ([]planning.Tache, error)
	OuvrirSession(ctx context.Context, d DemandeOuverture) error
	Repondre(ctx context.Context, sessionID string, d DemandeReponse) error
}

var identifiantValide = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

// Gestionnaire : routes servies par focusd.
func Gestionnaire(f Fournisseur) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /etat", func(w http.ResponseWriter, r *http.Request) {
		repondreJSON(w, http.StatusOK, f.Etat())
	})
	mux.HandleFunc("GET /taches", func(w http.ResponseWriter, r *http.Request) {
		ts, err := f.Taches(r.Context())
		if err != nil {
			repondreErreur(w, err)
			return
		}
		repondreJSON(w, http.StatusOK, ts)
	})
	mux.HandleFunc("POST /sessions", func(w http.ResponseWriter, r *http.Request) {
		var d DemandeOuverture
		if !lire(w, r, &d) {
			return
		}
		if !identifiantValide.MatchString(d.TacheID) || len(d.Apps) == 0 {
			repondreJSON(w, http.StatusBadRequest, api.Erreur{Code: "demande_invalide", Message: "Tâche ou apps manquantes."})
			return
		}
		for _, a := range d.Apps {
			if !identifiantValide.MatchString(a) {
				repondreJSON(w, http.StatusBadRequest, api.Erreur{Code: "demande_invalide", Message: fmt.Sprintf("App invalide : %q.", a)})
				return
			}
		}
		if err := f.OuvrirSession(r.Context(), d); err != nil {
			repondreErreur(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /sessions/{id}/reponse", func(w http.ResponseWriter, r *http.Request) {
		var d DemandeReponse
		if !lire(w, r, &d) {
			return
		}
		id := r.PathValue("id")
		if !identifiantValide.MatchString(id) || !identifiantValide.MatchString(d.QuestionID) ||
			(d.Reponse != "continue" && d.Reponse != "arrete") {
			repondreJSON(w, http.StatusBadRequest, api.Erreur{Code: "demande_invalide", Message: "Réponse invalide."})
			return
		}
		if err := f.Repondre(r.Context(), id, d); err != nil {
			repondreErreur(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	return garde(mux)
}

// garde refuse ce qui ne vient pas de l'agent : une page web ne peut pas poser d'en-tête
// personnalisé sans pré-vérification CORS (jamais acceptée ici), et le contrôle de Host
// déjoue le rebond DNS.
func garde(suivant http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hote, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			hote = r.Host
		}
		ip := net.ParseIP(hote)
		if hote != "localhost" && (ip == nil || !ip.IsLoopback()) {
			repondreJSON(w, http.StatusForbidden, api.Erreur{Code: "interdit", Message: "Hôte refusé."})
			return
		}
		if r.Header.Get(EnTete) != "1" {
			repondreJSON(w, http.StatusForbidden, api.Erreur{Code: "interdit", Message: "En-tête manquant."})
			return
		}
		suivant.ServeHTTP(w, r)
	})
}

func lire(w http.ResponseWriter, r *http.Request, v any) bool {
	if r.Header.Get("Content-Type") != "application/json" {
		repondreJSON(w, http.StatusUnsupportedMediaType, api.Erreur{Code: "demande_invalide", Message: "JSON attendu."})
		return false
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, 64<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		repondreJSON(w, http.StatusBadRequest, api.Erreur{Code: "demande_invalide", Message: "JSON invalide."})
		return false
	}
	return true
}

func repondreErreur(w http.ResponseWriter, err error) {
	var e *api.Erreur
	if errors.As(err, &e) {
		repondreJSON(w, e.Statut, e)
		return
	}
	repondreJSON(w, http.StatusBadGateway, api.Erreur{Code: "api_injoignable", Message: "API injoignable : " + err.Error()})
}

func repondreJSON(w http.ResponseWriter, statut int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statut)
	_ = json.NewEncoder(w).Encode(v)
}

// Client : côté focus-agent.
type Client struct {
	Base string
	HTTP *http.Client
}

func NouveauClient(adresse string) *Client {
	return &Client{Base: "http://" + adresse, HTTP: &http.Client{Timeout: 20 * time.Second}}
}

func (c *Client) faire(ctx context.Context, methode, chemin string, corps, sortie any) error {
	var lecteur io.Reader
	if corps != nil {
		b, err := json.Marshal(corps)
		if err != nil {
			return err
		}
		lecteur = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, methode, c.Base+chemin, lecteur)
	if err != nil {
		return err
	}
	req.Header.Set(EnTete, "1")
	if corps != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rep, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("focusd injoignable : %w", err)
	}
	defer rep.Body.Close()
	b, err := io.ReadAll(io.LimitReader(rep.Body, 1<<20))
	if err != nil {
		return err
	}
	if rep.StatusCode/100 != 2 {
		e := &api.Erreur{Statut: rep.StatusCode}
		_ = json.Unmarshal(b, e)
		return e
	}
	if sortie == nil || len(b) == 0 {
		return nil
	}
	return json.Unmarshal(b, sortie)
}

func (c *Client) Etat(ctx context.Context) (Etat, error) {
	var e Etat
	err := c.faire(ctx, http.MethodGet, "/etat", nil, &e)
	return e, err
}

func (c *Client) Taches(ctx context.Context) ([]planning.Tache, error) {
	var ts []planning.Tache
	err := c.faire(ctx, http.MethodGet, "/taches", nil, &ts)
	return ts, err
}

func (c *Client) OuvrirSession(ctx context.Context, d DemandeOuverture) error {
	return c.faire(ctx, http.MethodPost, "/sessions", d, nil)
}

func (c *Client) Repondre(ctx context.Context, sessionID string, d DemandeReponse) error {
	return c.faire(ctx, http.MethodPost, "/sessions/"+url.PathEscape(sessionID)+"/reponse", d, nil)
}
