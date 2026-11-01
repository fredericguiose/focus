package hosts

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// Espacements irréguliers, commentaire en ligne, majuscules, pas de saut de ligne final :
// tout cela doit survivre tel quel.
const origine = "127.0.0.1   localhost localhost.localdomain\n" +
	"::1\t\tlocalhost6   # boucle IPv6\n" +
	"\n" +
	"# Ligne de l'utilisateur\n" +
	"192.168.1.10 NAS.maison"

func TestRenduAjouteLeBlocEnFin(t *testing.T) {
	got := Rendre(origine, []string{"youtube.com", "chatgpt.com"})
	attendu := origine + "\n" +
		"# >>> focus\n" +
		"0.0.0.0 chatgpt.com\n:: chatgpt.com\n" +
		"0.0.0.0 youtube.com\n:: youtube.com\n" +
		"# <<< focus\n"
	if got != attendu {
		t.Fatalf("rendu inattendu :\n%s", got)
	}
}

func TestRenduIdempotent(t *testing.T) {
	d := []string{"youtube.com", "www.youtube.com"}
	une := Rendre(origine, d)
	deux := Rendre(une, d)
	if une != deux {
		t.Fatalf("pas idempotent :\n%s\n---\n%s", une, deux)
	}
}

func TestRenduNAltèrePasLesLignesHorsBalises(t *testing.T) {
	avecBloc := Rendre(origine, []string{"youtube.com"})
	// L'utilisateur ajoute une ligne après le bloc ; un nouveau rendu la garde.
	modifie := avecBloc + "10.0.0.1 imprimante\n"
	r := Rendre(modifie, []string{"x.com"})
	if !strings.HasPrefix(r, origine+"\n") || !strings.HasSuffix(r, "10.0.0.1 imprimante\n") {
		t.Fatalf("lignes hors balises modifiées :\n%s", r)
	}
	if strings.Contains(r, "youtube.com") || !strings.Contains(r, "0.0.0.0 x.com\n") {
		t.Fatalf("bloc non remplacé :\n%s", r)
	}
	// Le bloc reste à sa place (au milieu), pas de second bloc.
	if strings.Count(r, DebutBloc) != 1 || strings.Index(r, DebutBloc) > strings.Index(r, "imprimante") {
		t.Fatalf("bloc déplacé ou dupliqué :\n%s", r)
	}
}

func TestListeVideSupprimeLeBloc(t *testing.T) {
	sansFinal := origine + "\n" // le rendu a ajouté le saut de ligne final manquant
	avecBloc := Rendre(origine, []string{"youtube.com"})
	if got := Rendre(avecBloc, nil); got != sansFinal {
		t.Fatalf("bloc non supprimé proprement :\n%q", got)
	}
	// Sans bloc et sans domaine, le fichier n'est pas touché du tout.
	if got := Rendre(origine, nil); got != origine {
		t.Fatalf("fichier sans bloc modifié :\n%q", got)
	}
}

func TestFinsDeLigneWindows(t *testing.T) {
	win := "# Copyright (c) 1993-2009 Microsoft Corp.\r\n127.0.0.1       localhost\r\n"
	r := Rendre(win, []string{"youtube.com"})
	attendu := win + "# >>> focus\r\n0.0.0.0 youtube.com\r\n:: youtube.com\r\n# <<< focus\r\n"
	if r != attendu {
		t.Fatalf("CRLF non respecté :\n%q", r)
	}
	if Rendre(r, nil) != win {
		t.Fatal("suppression du bloc CRLF incorrecte")
	}
}

func TestBlocTronqueEtBalisesOrphelines(t *testing.T) {
	tronque := "127.0.0.1 localhost\n# >>> focus\n0.0.0.0 youtube.com\n:: you"
	if got := Rendre(tronque, nil); got != "127.0.0.1 localhost\n" {
		t.Fatalf("bloc tronqué mal réparé : %q", got)
	}
	orpheline := "127.0.0.1 localhost\n# <<< focus\n"
	if got := Rendre(orpheline, nil); got != "127.0.0.1 localhost\n" {
		t.Fatalf("balise orpheline : %q", got)
	}
	double := "a b\n# >>> focus\n0.0.0.0 x.com\n# <<< focus\n# >>> focus\n0.0.0.0 y.com\n# <<< focus\n"
	if got := Rendre(double, []string{"z.com"}); strings.Count(got, DebutBloc) != 1 || strings.Contains(got, "y.com") {
		t.Fatalf("blocs multiples : %q", got)
	}
}

func TestNomsInvalidesRejetes(t *testing.T) {
	valides, rejetes := Normaliser([]string{
		"YouTube.com.", "youtube.com", "bad domain.com", "evil.com\n1.2.3.4 banque.fr",
		"-x.com", "localhost", "a..b", "xn--bcher-kva.example",
	})
	if !slices.Equal(valides, []string{"xn--bcher-kva.example", "youtube.com"}) {
		t.Errorf("valides %v", valides)
	}
	if len(rejetes) != 5 {
		t.Errorf("rejetés %v", rejetes)
	}
	r := Rendre("", []string{"evil.com\n1.2.3.4 banque.fr"})
	if r != "" {
		t.Errorf("injection écrite : %q", r)
	}
}

func TestFichier(t *testing.T) {
	chemin := filepath.Join(t.TempDir(), "hosts")
	if err := os.WriteFile(chemin, []byte(origine), 0o644); err != nil {
		t.Fatal(err)
	}
	f := Fichier{Chemin: chemin}
	change, err := f.Appliquer([]string{"youtube.com"})
	if err != nil || !change {
		t.Fatalf("premier passage : change=%v err=%v", change, err)
	}
	change, err = f.Appliquer([]string{"youtube.com"})
	if err != nil || change {
		t.Fatalf("second passage identique : change=%v err=%v", change, err)
	}
	// Un contenu plus court doit tronquer correctement l'ancien.
	if _, err := f.Appliquer(nil); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(chemin)
	if string(b) != origine+"\n" {
		t.Fatalf("contenu final %q", b)
	}
}

func TestJournalSansEffet(t *testing.T) {
	j := &Journal{Journal: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if c, _ := j.Appliquer([]string{"x.com"}); !c {
		t.Error("premier appel : changement attendu")
	}
	if c, _ := j.Appliquer([]string{"X.com"}); c {
		t.Error("même liste : pas de changement attendu")
	}
}

func TestCheminSysteme(t *testing.T) {
	if CheminSysteme() == "" {
		t.Fatal("chemin vide")
	}
}
