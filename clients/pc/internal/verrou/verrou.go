// Paquet verrou : verrouillage de toutes les sessions pendant un segment
// verrouiller_session (§5). Implémentations : logind (Linux), WTS (Windows), sans effet.
package verrou

import (
	"log/slog"
	"time"
)

// Reconnexion : une session a été déverrouillée (ou ouverte) pendant un segment verrouillé.
type Reconnexion struct {
	Compte  string
	Session string
	Le      time.Time // horloge locale
}

type Verrou interface {
	// Appliquer est appelé à chaque tour. actif=true pose le verrou sur toutes les sessions et
	// le maintient (reverrouillage) ; actif=false cesse de le maintenir sans rien déverrouiller.
	Appliquer(actif bool) error
	Fermer() error
}

// SansEffet journalise ce qui serait fait, sans appeler logind ni WTS.
type SansEffet struct {
	Journal *slog.Logger
	actif   bool
}

func (s *SansEffet) Appliquer(actif bool) error {
	if actif != s.actif {
		if actif {
			s.Journal.Info("sans effet : verrouillerait toutes les sessions de tous les comptes et les reverrouillerait")
		} else {
			s.Journal.Info("sans effet : cesserait de maintenir le verrou des sessions")
		}
	}
	s.actif = actif
	return nil
}

func (s *SansEffet) Fermer() error { return nil }
