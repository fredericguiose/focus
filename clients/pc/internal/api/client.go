// Paquet api : client HTTP des points d'entrée « appareil » de l'API Focus (§4.2).
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/planning"
)

// Un planning fait quelques kilo-octets ; au-delà, c'est une réponse anormale.
const tailleMax = 1 << 20

type Client struct {
	Base      string
	Jeton     func() (string, error)
	HTTP      *http.Client
	UserAgent string
	// Horloge : horloge locale lue à la réception du planning (remplaçable dans les tests).
	Horloge func() time.Time
}

func Nouveau(base string, jeton func() (string, error)) *Client {
	return &Client{
		Base:      strings.TrimRight(base, "/"),
		Jeton:     jeton,
		HTTP:      &http.Client{Timeout: 15 * time.Second},
		UserAgent: "focus-pc/2.0",
		Horloge:   time.Now,
	}
}

// Erreur : réponse non 2xx, avec le corps { erreur, message } de l'API (§4.2).
type Erreur struct {
	Statut  int    `json:"-"`
	Code    string `json:"erreur"`
	Message string `json:"message"`
}

func (e *Erreur) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("API %d %s : %s", e.Statut, e.Code, e.Message)
	}
	return fmt.Sprintf("API %d", e.Statut)
}

type Accuse struct {
	Action string    `json:"action"`
	PoseLe time.Time `json:"pose_le"`
}

// Evenement : forme lue par l'API (`{ type: "reconnexion", debut, duree_s? }`) ; compte et
// session sont ignorés par l'API mais gardés pour le journal.
type Evenement struct {
	Type    string    `json:"type"`
	Le      time.Time `json:"debut"`
	Compte  string    `json:"compte,omitempty"`
	Session string    `json:"session,omitempty"`
}

type OuvertureSession struct {
	Appareil string   `json:"appareil"`
	TacheID  string   `json:"tache_id"`
	Apps     []string `json:"apps"`
}

type Reponse struct {
	QuestionID string `json:"question_id"`
	Reponse    string `json:"reponse"`
}

func (c *Client) faire(ctx context.Context, methode, chemin string, corps any) (*http.Response, error) {
	var lecteur io.Reader
	if corps != nil {
		b, err := json.Marshal(corps)
		if err != nil {
			return nil, err
		}
		lecteur = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, methode, c.Base+chemin, lecteur)
	if err != nil {
		return nil, err
	}
	jeton, err := c.Jeton()
	if err != nil {
		return nil, fmt.Errorf("jeton : %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+jeton)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.UserAgent)
	if corps != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rep, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	if rep.StatusCode/100 != 2 {
		defer rep.Body.Close()
		e := &Erreur{Statut: rep.StatusCode}
		b, _ := io.ReadAll(io.LimitReader(rep.Body, 64<<10))
		_ = json.Unmarshal(b, e)
		return nil, e
	}
	return rep, nil
}

func (c *Client) envoyer(ctx context.Context, methode, chemin string, corps, sortie any) error {
	rep, err := c.faire(ctx, methode, chemin, corps)
	if err != nil {
		return err
	}
	defer rep.Body.Close()
	b, err := io.ReadAll(io.LimitReader(rep.Body, tailleMax))
	if err != nil {
		return err
	}
	if sortie == nil || len(bytes.TrimSpace(b)) == 0 {
		return nil
	}
	return json.Unmarshal(b, sortie)
}

// Planning renvoie le planning validé et l'heure locale de réception (pour le calage).
func (c *Client) Planning(ctx context.Context) (*planning.Planning, time.Time, error) {
	rep, err := c.faire(ctx, http.MethodGet, "/v1/planning", nil)
	if err != nil {
		return nil, time.Time{}, err
	}
	recu := c.Horloge()
	defer rep.Body.Close()
	var p planning.Planning
	if err := json.NewDecoder(io.LimitReader(rep.Body, tailleMax)).Decode(&p); err != nil {
		return nil, time.Time{}, fmt.Errorf("planning illisible : %w", err)
	}
	if err := p.Valider(); err != nil {
		return nil, time.Time{}, err
	}
	return &p, recu, nil
}

func (c *Client) Accuser(ctx context.Context, a Accuse) error {
	return c.envoyer(ctx, http.MethodPost, "/v1/accuses", a, nil)
}

// Evenements envoie un lot : `{ "evenements": [...] }`.
func (c *Client) Evenements(ctx context.Context, lot []Evenement) error {
	if len(lot) == 0 {
		return nil
	}
	return c.envoyer(ctx, http.MethodPost, "/v1/evenements", struct {
		Evenements []Evenement `json:"evenements"`
	}{lot}, nil)
}

// Taches accepte un tableau ou un objet { taches: [...] } : la forme exacte de la réponse
// n'est pas fixée par la conception. Le nom peut venir de « nom » ou de « contenu ».
func (c *Client) Taches(ctx context.Context) ([]planning.Tache, error) {
	var brut json.RawMessage
	if err := c.envoyer(ctx, http.MethodGet, "/v1/taches", nil, &brut); err != nil {
		return nil, err
	}
	type tacheBrute struct {
		planning.Tache
		Contenu string `json:"contenu"`
	}
	var liste []tacheBrute
	if err := json.Unmarshal(brut, &liste); err != nil {
		var objet struct {
			Taches []tacheBrute `json:"taches"`
		}
		if err2 := json.Unmarshal(brut, &objet); err2 != nil {
			return nil, fmt.Errorf("liste de tâches illisible : %w", err)
		}
		liste = objet.Taches
	}
	taches := make([]planning.Tache, 0, len(liste))
	for _, t := range liste {
		if t.Nom == "" {
			t.Nom = t.Contenu
		}
		if t.ID == "" {
			continue
		}
		taches = append(taches, t.Tache)
	}
	return taches, nil
}

func (c *Client) OuvrirSession(ctx context.Context, o OuvertureSession) error {
	return c.envoyer(ctx, http.MethodPost, "/v1/sessions", o, nil)
}

func (c *Client) Repondre(ctx context.Context, sessionID string, r Reponse) error {
	if sessionID == "" {
		return errors.New("session sans identifiant")
	}
	return c.envoyer(ctx, http.MethodPost, "/v1/sessions/"+url.PathEscape(sessionID)+"/reponse", r, nil)
}
