package planning

import (
	"slices"
	"strings"
	"time"
)

// Horloge porte le décalage entre l'horloge du serveur et l'horloge locale (§4.3).
type Horloge struct {
	Decalage time.Duration
}

// Caler calcule le décalage = heure_serveur − horloge locale à la réception.
func Caler(heureServeur, reception time.Time) Horloge {
	return Horloge{Decalage: heureServeur.Sub(reception)}
}

// Maintenant convertit une lecture de l'horloge locale en instant serveur.
func (h Horloge) Maintenant(local time.Time) time.Time {
	return local.Add(h.Decalage)
}

// Local convertit un instant serveur en instant de l'horloge locale (échéances des dialogues).
func (h Horloge) Local(serveur time.Time) time.Time {
	return serveur.Add(-h.Decalage)
}

// Etat est ce qu'il faut appliquer à un instant donné.
type Etat struct {
	// Expire : pas de planning, ou instant au-delà de valable_jusqua : tout est levé.
	Expire           bool
	Segment          *Segment
	Domaines         []string
	Verrouiller      bool
	FermerComptes    bool
	ComptesDeTravail []string
	SessionsValides  []string
}

// SegmentEnVigueur renvoie le segment qui contient l'instant (début inclus, fin exclue).
func SegmentEnVigueur(p *Planning, t time.Time) *Segment {
	if p == nil {
		return nil
	}
	for i := range p.Segments {
		s := &p.Segments[i]
		if !t.Before(s.Debut) && t.Before(s.Fin) {
			return s
		}
	}
	return nil
}

// SessionValide : valide tant que question.expire_a n'est pas passé, ou après un « continue »
// accepté pour la question en cours. Sans question, aucune échéance n'est connue : la session
// reste valide jusqu'à ce que l'API la retire du planning.
func SessionValide(s Session, t time.Time, continueAccepte string) bool {
	if s.Question == nil {
		return true
	}
	if continueAccepte != "" && continueAccepte == s.Question.ID {
		return true
	}
	return t.Before(s.Question.ExpireA)
}

// Evaluer applique les règles côté client de §4.3. continues associe un identifiant de
// session à l'identifiant de la question pour laquelle un « continue » a été accepté.
func Evaluer(p *Planning, t time.Time, continues map[string]string) Etat {
	if p == nil || !t.Before(p.ValableJusqua) {
		return Etat{Expire: true}
	}
	e := Etat{ComptesDeTravail: slices.Clone(p.ComptesDeTravail)}
	seg := SegmentEnVigueur(p, t)
	if seg == nil {
		return e
	}
	e.Segment = seg
	e.Verrouiller = seg.Actions.VerrouillerSession
	e.FermerComptes = seg.Actions.FermerComptesHorsTravail

	liberes := map[string]bool{}
	if !seg.Actions.VerrouillerSession {
		for _, s := range p.Sessions {
			if !SessionValide(s, t, continues[s.ID]) {
				continue
			}
			e.SessionsValides = append(e.SessionsValides, s.ID)
			for _, d := range s.Domaines {
				liberes[normaliser(d)] = true
			}
		}
	}
	vus := map[string]bool{}
	for _, d := range seg.Actions.BloquerDomaines {
		d = normaliser(d)
		if d == "" || liberes[d] || vus[d] {
			continue
		}
		vus[d] = true
		e.Domaines = append(e.Domaines, d)
	}
	slices.Sort(e.Domaines)
	return e
}

func normaliser(d string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(d)), ".")
}
