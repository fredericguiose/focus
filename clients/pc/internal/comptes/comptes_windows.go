//go:build windows

package comptes

import (
	"errors"
	"log/slog"

	"github.com/fredericguiose/focus/clients/pc/internal/wts"
)

// Windows : hors des modes qui le permettent, toute session ouverte d'un compte libre est
// déconnectée (décision du 01/11). Aucun compte n'est désactivé : si le service s'arrête ou
// plante, Windows reste accessible (pas de risque d'être enfermé dehors), et le comportement est
// le même que sous Linux (on agit sur les sessions, jamais sur les comptes).
type windowsComptes struct {
	journal *slog.Logger
}

func Systeme(journal *slog.Logger, _ string) (Gestionnaire, error) {
	return &windowsComptes{journal: journal}, nil
}

func (g *windowsComptes) Fermer() error { return nil }

func (g *windowsComptes) Appliquer(actif bool, travail []string) error {
	if !actif {
		return nil
	}
	sessions, err := wts.Sessions()
	if err != nil {
		return err
	}
	var erreurs []error
	for _, s := range sessions {
		if !s.Active() || !EstLibre(s.Compte, travail, true) {
			continue
		}
		if err := wts.Deconnecter(s.ID); err != nil {
			erreurs = append(erreurs, err)
			continue
		}
		g.journal.Info("compte libre : session déconnectée", "compte", s.Compte, "session", s.ID)
	}
	return errors.Join(erreurs...)
}
