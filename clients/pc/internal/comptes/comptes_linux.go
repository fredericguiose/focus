//go:build linux

package comptes

import (
	"errors"
	"log/slog"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/logind"
	"github.com/godbus/dbus/v5"
)

// Comptes système (root, démons, nobody) : hors périmètre. Les fermer casserait
// l'administration et le dépannage de la machine.
const (
	uidMin    = 1000
	uidNobody = 65534
)

// Une session verrouillée qui ne l'est toujours pas après ce délai est fermée.
const delaiVerrouillage = 10 * time.Second

type suivi struct {
	vueVerrouillee bool
	demandeLe      time.Time
}

type linux struct {
	l       *logind.Logind
	journal *slog.Logger
	suivi   map[dbus.ObjectPath]*suivi
}

// Systeme : on verrouille d'abord (le travail en cours est gardé) ; une session qui est
// déverrouillée ensuite, ou une session texte, est fermée.
func Systeme(journal *slog.Logger, _ string) (Gestionnaire, error) {
	l, err := logind.Connecter()
	if err != nil {
		return nil, err
	}
	return &linux{l: l, journal: journal}, nil
}

func (g *linux) Fermer() error { return g.l.Fermer() }

func (g *linux) Appliquer(actif bool, travail []string) error {
	if !actif {
		g.suivi = nil
		return nil
	}
	if g.suivi == nil {
		g.suivi = map[dbus.ObjectPath]*suivi{}
	}
	sessions, err := g.l.Sessions()
	if err != nil {
		return err
	}
	var erreurs []error
	maintenant := time.Now()
	for _, s := range sessions {
		if !s.Utilisateur() || s.UID < uidMin || s.UID == uidNobody || !EstLibre(s.Compte, travail, false) {
			continue
		}
		if !s.Graphique() {
			erreurs = append(erreurs, g.terminer(s))
			continue
		}
		st := g.suivi[s.Chemin]
		if s.Verrouillee {
			if st == nil {
				st = &suivi{}
				g.suivi[s.Chemin] = st
			}
			st.vueVerrouillee = true
			continue
		}
		if st == nil {
			g.suivi[s.Chemin] = &suivi{demandeLe: maintenant}
			if err := g.l.Verrouiller(s.Chemin); err != nil {
				erreurs = append(erreurs, err)
				continue
			}
			g.journal.Info("compte libre : session verrouillée", "compte", s.Compte, "session", s.ID)
			continue
		}
		if st.vueVerrouillee || maintenant.Sub(st.demandeLe) > delaiVerrouillage {
			erreurs = append(erreurs, g.terminer(s))
		}
	}
	return errors.Join(erreurs...)
}

func (g *linux) terminer(s logind.Session) error {
	if err := g.l.Terminer(s.Chemin); err != nil {
		return err
	}
	delete(g.suivi, s.Chemin)
	g.journal.Warn("compte libre : session fermée", "compte", s.Compte, "session", s.ID, "type", s.Type)
	return nil
}
