package planning

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func instant(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func exemple(t *testing.T) *Planning {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "planning.json"))
	if err != nil {
		t.Fatal(err)
	}
	var p Planning
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatal(err)
	}
	if err := p.Valider(); err != nil {
		t.Fatal(err)
	}
	return &p
}

func TestSegmentEnVigueur(t *testing.T) {
	p := exemple(t)
	cas := []struct {
		t    string
		mode string
	}{
		{"2026-11-03T20:59:59Z", ""}, // avant le premier segment
		{"2026-11-03T21:00:00Z", "WORK"},
		{"2026-11-03T23:29:59Z", "WORK"},
		{"2026-11-03T23:30:00Z", "NIGHT_LOCK"}, // la fin d'un segment est exclue
		{"2026-11-04T06:00:00Z", "MORNING_LOCK"},
		{"2026-11-04T07:00:00Z", ""}, // trou après le dernier segment
	}
	for _, c := range cas {
		s := SegmentEnVigueur(p, instant(t, c.t))
		got := ""
		if s != nil {
			got = s.Mode
		}
		if got != c.mode {
			t.Errorf("%s : mode %q, attendu %q", c.t, got, c.mode)
		}
	}
}

func TestCalageHorloge(t *testing.T) {
	serveur := instant(t, "2026-11-03T21:00:00Z")
	local := instant(t, "2026-11-03T20:57:30Z") // horloge locale en retard de 2 min 30
	h := Caler(serveur, local)
	if h.Decalage != 150*time.Second {
		t.Fatalf("décalage %v, attendu 2m30s", h.Decalage)
	}
	// 10 minutes plus tard en local, l'instant serveur est 21:10:00.
	if got := h.Maintenant(local.Add(10 * time.Minute)); !got.Equal(instant(t, "2026-11-03T21:10:00Z")) {
		t.Errorf("Maintenant = %s", got)
	}
	if got := h.Local(serveur); !got.Equal(local) {
		t.Errorf("Local = %s", got)
	}
}

func TestDecalageChoisitLeSegment(t *testing.T) {
	p := exemple(t)
	// L'horloge locale avance de 5 min : à 23:27 local il est 23:32 serveur, donc NIGHT_LOCK.
	h := Caler(instant(t, "2026-11-03T21:00:00Z"), instant(t, "2026-11-03T21:05:00Z"))
	e := Evaluer(p, h.Maintenant(instant(t, "2026-11-03T23:37:00Z")), nil)
	if e.Segment == nil || e.Segment.Mode != "NIGHT_LOCK" || !e.Verrouiller {
		t.Fatalf("attendu NIGHT_LOCK verrouillé, obtenu %+v", e)
	}
}

func TestExpirationDuPlanning(t *testing.T) {
	p := exemple(t)
	juste := Evaluer(p, instant(t, "2026-11-05T08:59:59Z"), nil)
	if juste.Expire {
		t.Error("pas encore expiré à 08:59:59")
	}
	e := Evaluer(p, instant(t, "2026-11-05T09:00:00Z"), nil)
	if !e.Expire || len(e.Domaines) != 0 || e.Verrouiller || e.FermerComptes {
		t.Errorf("au-delà de valable_jusqua tout doit être levé : %+v", e)
	}
	if e := Evaluer(nil, instant(t, "2026-11-03T21:00:00Z"), nil); !e.Expire {
		t.Error("sans planning, tout doit être levé")
	}
}

func TestSoustractionSessionValide(t *testing.T) {
	p := exemple(t)
	e := Evaluer(p, instant(t, "2026-11-03T21:10:00Z"), nil)
	attendu := []string{"www.youtube.com", "youtube.com"}
	if !slices.Equal(e.Domaines, attendu) {
		t.Errorf("domaines %v, attendu %v", e.Domaines, attendu)
	}
	if !slices.Equal(e.SessionsValides, []string{"s_01"}) {
		t.Errorf("sessions valides %v", e.SessionsValides)
	}
	if !e.FermerComptes || e.Verrouiller || !slices.Equal(e.ComptesDeTravail, []string{"alice"}) {
		t.Errorf("actions inattendues : %+v", e)
	}
}

func TestSoustractionSessionExpiree(t *testing.T) {
	p := exemple(t)
	// expire_a = 21:26:03 : à cet instant la session n'est plus valide.
	e := Evaluer(p, instant(t, "2026-11-03T21:26:03Z"), nil)
	attendu := []string{"chat.openai.com", "chatgpt.com", "www.youtube.com", "youtube.com"}
	if !slices.Equal(e.Domaines, attendu) {
		t.Errorf("domaines %v, attendu %v", e.Domaines, attendu)
	}
	if len(e.SessionsValides) != 0 {
		t.Errorf("aucune session ne devrait être valide : %v", e.SessionsValides)
	}
}

func TestSessionValideApresContinue(t *testing.T) {
	p := exemple(t)
	t0 := instant(t, "2026-11-03T21:40:00Z")
	e := Evaluer(p, t0, map[string]string{"s_01": "q_07"})
	if !slices.Equal(e.Domaines, []string{"www.youtube.com", "youtube.com"}) {
		t.Errorf("après continue accepté, la session doit rester valide : %v", e.Domaines)
	}
	// Un « continue » accepté pour une autre question ne prolonge pas la session.
	e = Evaluer(p, t0, map[string]string{"s_01": "q_06"})
	if len(e.SessionsValides) != 0 {
		t.Errorf("continue d'une autre question pris en compte : %v", e.SessionsValides)
	}
}

func TestSessionSansQuestion(t *testing.T) {
	s := Session{ID: "s_02", Domaines: []string{"youtube.com"}}
	if !SessionValide(s, instant(t, "2026-11-03T22:00:00Z"), "") {
		t.Error("une session sans question est valide")
	}
}

func TestSessionsIgnoreesPendantSegmentVerrouille(t *testing.T) {
	p := exemple(t)
	// Session encore valide (question lointaine), mais segment NIGHT_LOCK.
	p.Sessions[0].Question.ExpireA = instant(t, "2026-11-04T01:00:00Z")
	e := Evaluer(p, instant(t, "2026-11-03T23:45:00Z"), map[string]string{"s_01": "q_07"})
	if !e.Verrouiller {
		t.Fatal("segment verrouillé attendu")
	}
	if len(e.SessionsValides) != 0 || !slices.Contains(e.Domaines, "chatgpt.com") {
		t.Errorf("les sessions ne doivent pas compter pendant un segment verrouillé : %+v", e)
	}
}

func TestDomainesNormalises(t *testing.T) {
	p := &Planning{
		ValableJusqua: instant(t, "2026-11-04T00:00:00Z"),
		Segments: []Segment{{
			Debut: instant(t, "2026-11-03T00:00:00Z"), Fin: instant(t, "2026-11-04T00:00:00Z"),
			Actions: Actions{BloquerDomaines: []string{"X.com", "x.com.", " x.com ", "a.fr", ""}},
		}},
	}
	e := Evaluer(p, instant(t, "2026-11-03T12:00:00Z"), nil)
	if !slices.Equal(e.Domaines, []string{"a.fr", "x.com"}) {
		t.Errorf("domaines %v", e.Domaines)
	}
}

func TestValider(t *testing.T) {
	p := exemple(t)
	p.Version = 2
	if p.Valider() == nil {
		t.Error("version inconnue acceptée")
	}
	p = exemple(t)
	p.Segments[0].Fin = p.Segments[0].Debut
	if p.Valider() == nil {
		t.Error("segment vide accepté")
	}
}

func TestCache(t *testing.T) {
	chemin := filepath.Join(t.TempDir(), "sous", "planning.json")
	if _, err := LireCache(chemin); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("cache absent : %v", err)
	}
	c := Cache{Planning: exemple(t), DecalageMs: 150000, RecuLe: instant(t, "2026-11-03T20:57:30Z")}
	if err := EcrireCache(chemin, c); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(chemin)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		t.Errorf("cache lisible par d'autres : %v", info.Mode())
	}
	lu, err := LireCache(chemin)
	if err != nil {
		t.Fatal(err)
	}
	if lu.Horloge().Decalage != 150*time.Second || lu.Planning.ConfigVersion != "3f2a9c1" {
		t.Errorf("cache relu différent : %+v", lu)
	}
	// Rejouer le cache hors ligne : à 22:00 le segment WORK s'applique encore.
	e := Evaluer(lu.Planning, lu.Horloge().Maintenant(instant(t, "2026-11-03T21:57:30Z")), nil)
	if e.Segment == nil || e.Segment.Mode != "WORK" {
		t.Errorf("rejeu du cache : %+v", e)
	}
	if err := os.WriteFile(chemin, []byte("{pas du json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LireCache(chemin); err == nil {
		t.Error("cache corrompu accepté")
	}
}
