package comptes

import (
	"io"
	"log/slog"
	"slices"
	"testing"
)

func TestComptesLibres(t *testing.T) {
	tous := []string{"alice", "bob", "invite", "bob", ""}
	if got := Libres(tous, []string{"alice"}, false); !slices.Equal(got, []string{"bob", "invite"}) {
		t.Errorf("libres %v", got)
	}
	// Aucun compte de travail (exemple pc_windows) : tous les comptes sont libres.
	if got := Libres(tous, nil, false); !slices.Equal(got, []string{"alice", "bob", "invite"}) {
		t.Errorf("libres sans comptes de travail %v", got)
	}
	// Linux distingue la casse, Windows non.
	if !EstLibre("Alice", []string{"alice"}, false) {
		t.Error("Linux : Alice ≠ alice")
	}
	if EstLibre("Alice", []string{"alice"}, true) {
		t.Error("Windows : Alice = alice")
	}
}

func TestSansEffet(t *testing.T) {
	s := &SansEffet{Journal: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if err := s.Appliquer(true, []string{"alice"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Appliquer(false, nil); err != nil {
		t.Fatal(err)
	}
}
