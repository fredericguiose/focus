//go:build linux

package comptes

import (
	"errors"
	"log/slog"
	"strings"
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

// Action : ce qu'un segment fermer_comptes_hors_travail fait d'une session logind.
type Action int

const (
	// Ignorer : compte de travail, compte système, session en cours de fermeture, ou classe
	// qui n'est pas un accès à la machine (voir Decider).
	Ignorer Action = iota
	// Terminer : session sans écran (texte, background) : rien à verrouiller, on ferme.
	Terminer
	// VerrouillerPuisFermer : session graphique : verrouillée d'abord (le travail en cours est
	// gardé), fermée si elle est déverrouillée ou ne se verrouille pas.
	VerrouillerPuisFermer
)

func (a Action) String() string {
	switch a {
	case Terminer:
		return "terminer"
	case VerrouillerPuisFermer:
		return "verrouiller puis fermer"
	}
	return "ignorer"
}

// Decider : sort d'une session pendant un segment qui ferme les comptes hors travail.
// Fonction pure (aucun appel à logind), testée seule.
//
// Classes logind (systemd ≥ 256) :
//   - user, user-early, user-incomplete, user-light : sessions de connexion (tty, ssh avec pty,
//     GDM…). Graphiques : verrouillées puis fermées ; sinon fermées.
//   - background, background-light : su/runuser sans terminal, cron, ssh sans pty. Pas d'écran,
//     donc pas de verrouillage : fermées directement. C'est un vrai accès au compte (un shell
//     distant suffit pour contourner la fermeture des sessions « user »).
//   - manager, manager-early : la session du gestionnaire de services de l'utilisateur
//     (user@UID.service). Ignorée : ce n'est pas un accès en soi (aucun shell, aucun écran) ;
//     systemd l'arrête seul quand la dernière autre session du compte se ferme. La terminer
//     couperait aussi les services de l'utilisateur sans rien empêcher de plus, et logind la
//     recrée à la session suivante. Seul cas où elle survit : « linger » activé pour le compte.
//   - greeter, lock-screen : écran de connexion (GDM) et écran de verrouillage. Ignorées : les
//     fermer empêcherait toute connexion, y compris aux comptes de travail.
//   - toute autre classe (inconnue, future) : ignorée, sauf préfixe « user » ou « background ».
func Decider(s logind.Session, travail []string) Action {
	if s.Etat == "closing" || s.UID < uidMin || s.UID == uidNobody || !EstLibre(s.Compte, travail, false) {
		return Ignorer
	}
	switch {
	case strings.HasPrefix(s.Classe, "background"):
		return Terminer
	case s.Classe == "user" || strings.HasPrefix(s.Classe, "user-"):
		if s.Graphique() {
			return VerrouillerPuisFermer
		}
		return Terminer
	}
	return Ignorer
}

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
// déverrouillée ensuite, une session texte ou une session background est fermée.
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
		switch Decider(s, travail) {
		case Ignorer:
			continue
		case Terminer:
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
	g.journal.Warn("compte libre : session fermée", "compte", s.Compte, "session", s.ID, "type", s.Type, "classe", s.Classe)
	return nil
}
