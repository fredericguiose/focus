// Paquet comptes : fermeture des comptes libres (absents de comptes_de_travail, §2.4) pendant
// un segment fermer_comptes_hors_travail. Linux : sessions verrouillées puis fermées ;
// Windows : compte désactivé et sessions déconnectées.
package comptes

import (
	"log/slog"
	"slices"
	"strings"
)

type Gestionnaire interface {
	// Appliquer est appelé à chaque tour. actif=true ferme l'accès des comptes libres ;
	// actif=false : rien à rendre (on agit sur les sessions, jamais sur les comptes).
	Appliquer(actif bool, travail []string) error
	Fermer() error
}

// EstLibre : sous Windows les noms de comptes ne tiennent pas compte de la casse.
func EstLibre(compte string, travail []string, insensibleCasse bool) bool {
	for _, t := range travail {
		if t == compte || (insensibleCasse && strings.EqualFold(t, compte)) {
			return false
		}
	}
	return true
}

// Libres renvoie, triés et sans doublon, les comptes absents de comptes_de_travail.
func Libres(comptes, travail []string, insensibleCasse bool) []string {
	var libres []string
	for _, c := range comptes {
		if c != "" && EstLibre(c, travail, insensibleCasse) && !slices.Contains(libres, c) {
			libres = append(libres, c)
		}
	}
	slices.Sort(libres)
	return libres
}

// SansEffet journalise ce qui serait fait.
type SansEffet struct {
	Journal *slog.Logger
	actif   bool
	travail []string
}

func (s *SansEffet) Appliquer(actif bool, travail []string) error {
	if actif != s.actif || (actif && !slices.Equal(travail, s.travail)) {
		if actif {
			s.Journal.Info("sans effet : fermerait les comptes libres", "comptes_de_travail", travail)
		} else {
			s.Journal.Info("sans effet : rendrait l'accès aux comptes libres")
		}
	}
	s.actif = actif
	s.travail = slices.Clone(travail)
	return nil
}

func (s *SansEffet) Fermer() error { return nil }
