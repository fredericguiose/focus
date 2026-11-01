// Paquet planning : le planning reçu de l'API (conception §4.3), son cache sur disque,
// le calage d'horloge et les règles côté client. Aucune décision de mode ici : le client
// applique ce que l'API a calculé.
package planning

import (
	"errors"
	"fmt"
	"time"
)

// VersionFormat est la seule version du format que ce client sait appliquer.
const VersionFormat = 1

type Planning struct {
	Version          int       `json:"version"`
	Appareil         string    `json:"appareil"`
	HeureServeur     time.Time `json:"heure_serveur"`
	ConfigVersion    string    `json:"config_version"`
	ValableJusqua    time.Time `json:"valable_jusqua"`
	ComptesDeTravail []string  `json:"comptes_de_travail"`
	Segments         []Segment `json:"segments"`
	Sessions         []Session `json:"sessions"`
	Raison           string    `json:"raison"`
}

type Segment struct {
	Debut    time.Time `json:"debut"`
	Fin      time.Time `json:"fin"`
	Mode     string    `json:"mode"`
	Sessions string    `json:"sessions"`
	Actions  Actions   `json:"actions"`
}

type Actions struct {
	BloquerDomaines          []string `json:"bloquer_domaines"`
	VerrouillerSession       bool     `json:"verrouiller_session"`
	FermerComptesHorsTravail bool     `json:"fermer_comptes_hors_travail"`
}

type Session struct {
	ID        string    `json:"id"`
	Tache     Tache     `json:"tache"`
	Apps      []string  `json:"apps"`
	Domaines  []string  `json:"domaines"`
	OuverteLe time.Time `json:"ouverte_le"`
	Question  *Question `json:"question,omitempty"`
}

type Question struct {
	ID       string    `json:"id"`
	PoseeA   time.Time `json:"posee_a"`
	AttenteS int       `json:"attente_s"`
	ExpireA  time.Time `json:"expire_a"`
}

type Tache struct {
	ID         string     `json:"id"`
	Nom        string     `json:"nom"`
	EligibleLe *time.Time `json:"eligible_le,omitempty"`
}

// Valider refuse un planning qu'on ne saurait pas appliquer sans risque : mieux vaut
// garder le précédent que bloquer ou lever à tort.
func (p *Planning) Valider() error {
	if p.Version != VersionFormat {
		return fmt.Errorf("version de planning %d inconnue (attendu %d)", p.Version, VersionFormat)
	}
	if p.HeureServeur.IsZero() {
		return errors.New("heure_serveur absente")
	}
	if p.ValableJusqua.IsZero() {
		return errors.New("valable_jusqua absent")
	}
	for i, s := range p.Segments {
		if !s.Debut.Before(s.Fin) {
			return fmt.Errorf("segment %d : début %s pas avant fin %s", i, s.Debut, s.Fin)
		}
	}
	for i, s := range p.Sessions {
		if s.ID == "" {
			return fmt.Errorf("session %d sans identifiant", i)
		}
	}
	return nil
}
