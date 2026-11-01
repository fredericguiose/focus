//go:build windows

package verrou

import (
	"errors"
	"log/slog"
	"strconv"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/wts"
)

// Windows n'offre pas de signal simple de déverrouillage à un service hors du gestionnaire de
// contrôle : on relit l'état des sessions à chaque tour (2 s).
type windowsVerrou struct {
	journal *slog.Logger
	sur     func(Reconnexion)
	actif   bool
	premier bool
}

func Systeme(journal *slog.Logger, sur func(Reconnexion)) (Verrou, error) {
	return &windowsVerrou{journal: journal, sur: sur}, nil
}

func (v *windowsVerrou) Fermer() error { return nil }

func (v *windowsVerrou) Appliquer(actif bool) error {
	if !actif {
		v.actif = false
		return nil
	}
	if !v.actif {
		v.actif = true
		v.premier = true
	}
	sessions, err := wts.Sessions()
	if err != nil {
		return err
	}
	var erreurs []error
	for _, s := range sessions {
		if !s.Active() {
			continue
		}
		// Après le premier tour, toute session active a été rouverte pendant le segment.
		if !v.premier {
			v.journal.Warn("session rouverte pendant un segment verrouillé", "session", s.ID, "compte", s.Compte)
			if v.sur != nil {
				go v.sur(Reconnexion{Compte: s.Compte, Session: strconv.FormatUint(uint64(s.ID), 10), Le: time.Now()})
			}
		}
		if err := wts.Deconnecter(s.ID); err != nil {
			erreurs = append(erreurs, err)
			continue
		}
		v.journal.Info("session verrouillée (déconnectée)", "session", s.ID, "compte", s.Compte)
	}
	v.premier = false
	return errors.Join(erreurs...)
}
