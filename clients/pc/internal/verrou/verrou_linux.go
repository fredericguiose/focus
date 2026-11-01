//go:build linux

package verrou

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/logind"
	"github.com/godbus/dbus/v5"
)

// GNOME pose LockedHint en moins d'une seconde ; au-delà, on redemande le verrou.
const delaiRelance = 5 * time.Second

type suivi struct {
	compte         string
	id             string
	graphique      bool
	vueVerrouillee bool
	demandeLe      time.Time
}

type linux struct {
	l       *logind.Logind
	journal *slog.Logger
	sur     func(Reconnexion)
	annuler context.CancelFunc

	mu       sync.Mutex
	actif    bool
	premier  bool
	sessions map[dbus.ObjectPath]*suivi
}

// Systeme : verrou par logind, avec surveillance de LockedHint pour reverrouiller aussitôt.
func Systeme(journal *slog.Logger, sur func(Reconnexion)) (Verrou, error) {
	l, err := logind.Connecter()
	if err != nil {
		return nil, err
	}
	ctx, annuler := context.WithCancel(context.Background())
	v := &linux{l: l, journal: journal, sur: sur, annuler: annuler}
	if err := l.Surveiller(ctx, v.changement); err != nil {
		annuler()
		l.Fermer()
		return nil, err
	}
	return v, nil
}

func (v *linux) Fermer() error {
	v.annuler()
	return v.l.Fermer()
}

func (v *linux) Appliquer(actif bool) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if !actif {
		v.actif = false
		v.sessions = nil
		return nil
	}
	if !v.actif {
		v.actif = true
		v.premier = true
		v.sessions = map[dbus.ObjectPath]*suivi{}
	}
	sessions, err := v.l.Sessions()
	if err != nil {
		return err
	}
	var erreurs []error
	maintenant := time.Now()
	for _, s := range sessions {
		if !s.Utilisateur() {
			continue
		}
		st := v.sessions[s.Chemin]
		if st == nil {
			st = &suivi{compte: s.Compte, id: s.ID, graphique: s.Graphique(), vueVerrouillee: s.Verrouillee}
			v.sessions[s.Chemin] = st
			// Les sessions texte n'ont pas d'écran de verrouillage : un seul Lock suffit.
			if !s.Verrouillee {
				erreurs = append(erreurs, v.verrouiller(s.Chemin, st, maintenant))
				if st.graphique && !v.premier {
					v.signaler(st, maintenant) // ouverte pendant le segment verrouillé
				}
			}
			continue
		}
		if !st.graphique {
			continue
		}
		if s.Verrouillee {
			st.vueVerrouillee = true
			continue
		}
		if st.vueVerrouillee {
			st.vueVerrouillee = false
			erreurs = append(erreurs, v.verrouiller(s.Chemin, st, maintenant))
			v.signaler(st, maintenant)
		} else if maintenant.Sub(st.demandeLe) > delaiRelance {
			erreurs = append(erreurs, v.verrouiller(s.Chemin, st, maintenant))
		}
	}
	v.premier = false
	return errors.Join(erreurs...)
}

// changement réagit aux signaux D-Bus sans attendre le tour suivant.
func (v *linux) changement(c logind.Changement) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.actif || c.Nouvelle {
		return // les nouvelles sessions sont prises au tour suivant (2 s), avec leurs propriétés
	}
	st := v.sessions[c.Chemin]
	if st == nil || !st.graphique {
		return
	}
	if c.Verrouillee {
		st.vueVerrouillee = true
		return
	}
	if st.vueVerrouillee {
		st.vueVerrouillee = false
		maintenant := time.Now()
		if err := v.verrouiller(c.Chemin, st, maintenant); err != nil {
			v.journal.Error("reverrouillage", "session", st.id, "erreur", err)
		}
		v.signaler(st, maintenant)
	}
}

func (v *linux) verrouiller(chemin dbus.ObjectPath, st *suivi, t time.Time) error {
	st.demandeLe = t
	if err := v.l.Verrouiller(chemin); err != nil {
		return err
	}
	v.journal.Info("session verrouillée", "session", st.id, "compte", st.compte)
	return nil
}

func (v *linux) signaler(st *suivi, t time.Time) {
	v.journal.Warn("session déverrouillée pendant un segment verrouillé", "session", st.id, "compte", st.compte)
	if v.sur != nil {
		// Hors verrou : le rappel peut prendre son temps sans bloquer les signaux.
		r := Reconnexion{Compte: st.compte, Session: st.id, Le: t}
		go v.sur(r)
	}
}
