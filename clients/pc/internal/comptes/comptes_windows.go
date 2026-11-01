//go:build windows

package comptes

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/fredericguiose/focus/clients/pc/internal/wts"
)

type windowsComptes struct {
	journal *slog.Logger
	fichier string
	// Comptes désactivés par Focus, gardés sur disque : on ne réactive jamais un compte qui
	// était déjà désactivé avant (Invité, Administrateur intégré…).
	desactives []string
}

func Systeme(journal *slog.Logger, etatDossier string) (Gestionnaire, error) {
	g := &windowsComptes{journal: journal, fichier: filepath.Join(etatDossier, "comptes_desactives.json")}
	b, err := os.ReadFile(g.fichier)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	if len(b) > 0 {
		if err := json.Unmarshal(b, &g.desactives); err != nil {
			return nil, err
		}
	}
	return g, nil
}

func (g *windowsComptes) Fermer() error { return nil }

func (g *windowsComptes) Appliquer(actif bool, travail []string) error {
	var erreurs []error
	if !actif {
		for _, nom := range slices.Clone(g.desactives) {
			erreurs = append(erreurs, g.reactiver(nom))
		}
		return errors.Join(erreurs...)
	}
	comptes, err := wts.Comptes()
	if err != nil {
		return err
	}
	for _, c := range comptes {
		if !EstLibre(c.Nom, travail, true) {
			if g.estDesactiveParFocus(c.Nom) {
				erreurs = append(erreurs, g.reactiver(c.Nom)) // devenu compte de travail
			}
			continue
		}
		if c.Desactive {
			continue
		}
		if err := wts.DefinirDesactive(c.Nom, true); err != nil {
			erreurs = append(erreurs, err)
			continue
		}
		g.desactives = append(g.desactives, c.Nom)
		erreurs = append(erreurs, g.enregistrer())
		g.journal.Info("compte libre désactivé", "compte", c.Nom)
	}
	// Désactiver un compte ne ferme pas une session déjà ouverte.
	sessions, err := wts.Sessions()
	if err != nil {
		return errors.Join(append(erreurs, err)...)
	}
	for _, s := range sessions {
		if s.Active() && EstLibre(s.Compte, travail, true) {
			if err := wts.Deconnecter(s.ID); err != nil {
				erreurs = append(erreurs, err)
				continue
			}
			g.journal.Info("compte libre : session déconnectée", "compte", s.Compte, "session", s.ID)
		}
	}
	return errors.Join(erreurs...)
}

func (g *windowsComptes) estDesactiveParFocus(nom string) bool {
	return slices.ContainsFunc(g.desactives, func(d string) bool { return strings.EqualFold(d, nom) })
}

func (g *windowsComptes) reactiver(nom string) error {
	if err := wts.DefinirDesactive(nom, false); err != nil {
		return err
	}
	g.desactives = slices.DeleteFunc(g.desactives, func(d string) bool { return strings.EqualFold(d, nom) })
	g.journal.Info("compte réactivé", "compte", nom)
	return g.enregistrer()
}

func (g *windowsComptes) enregistrer() error {
	b, err := json.Marshal(g.desactives)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(g.fichier), 0o700); err != nil {
		return err
	}
	return os.WriteFile(g.fichier, b, 0o600)
}
