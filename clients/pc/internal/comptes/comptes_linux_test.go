//go:build linux

package comptes

import (
	"testing"

	"github.com/fredericguiose/focus/clients/pc/internal/logind"
)

func TestDecider(t *testing.T) {
	travail := []string{"alice"}
	libre := func(classe, typ string) logind.Session {
		return logind.Session{UID: 1001, Compte: "libre", Classe: classe, Type: typ, Etat: "online"}
	}
	cas := []struct {
		nom     string
		s       logind.Session
		attendu Action
	}{
		// Contournement corrigé : su sans terminal, cron, ssh sans pty.
		{"background du compte libre", libre("background", "unspecified"), Terminer},
		{"background-light du compte libre", libre("background-light", "unspecified"), Terminer},
		{"user tty du compte libre", libre("user", "tty"), Terminer},
		{"user x11 du compte libre", libre("user", "x11"), VerrouillerPuisFermer},
		{"user wayland du compte libre", libre("user", "wayland"), VerrouillerPuisFermer},
		{"user-incomplete du compte libre", libre("user-incomplete", "tty"), Terminer},
		{"user-early graphique", libre("user-early", "wayland"), VerrouillerPuisFermer},
		{"user-light", libre("user-light", "unspecified"), Terminer},
		{"manager du compte libre", libre("manager", "unspecified"), Ignorer},
		{"manager-early du compte libre", libre("manager-early", "unspecified"), Ignorer},
		{"greeter", libre("greeter", "wayland"), Ignorer},
		{"lock-screen", libre("lock-screen", "wayland"), Ignorer},
		{"classe inconnue", libre("none", "unspecified"), Ignorer},
		{"session en cours de fermeture", logind.Session{UID: 1001, Compte: "libre", Classe: "background", Etat: "closing"}, Ignorer},
		{"root", logind.Session{UID: 0, Compte: "root", Classe: "background", Etat: "online"}, Ignorer},
		{"compte système", logind.Session{UID: 999, Compte: "gdm", Classe: "user", Type: "wayland", Etat: "active"}, Ignorer},
		{"nobody", logind.Session{UID: 65534, Compte: "nobody", Classe: "background", Etat: "online"}, Ignorer},
		// La casse compte sous Linux : « Alice » n'est pas « alice ».
		{"Alice ≠ alice", logind.Session{UID: 1002, Compte: "Alice", Classe: "background", Etat: "online"}, Terminer},
	}
	for _, c := range cas {
		if got := Decider(c.s, travail); got != c.attendu {
			t.Errorf("%s : %v, attendu %v", c.nom, got, c.attendu)
		}
	}
	// Compte de travail : jamais touché, quelle que soit la classe ou le type.
	for _, classe := range []string{"user", "user-early", "user-incomplete", "user-light", "background", "background-light", "manager", "manager-early", "greeter", "lock-screen", ""} {
		for _, typ := range []string{"tty", "x11", "wayland", "unspecified"} {
			s := logind.Session{UID: 1000, Compte: "alice", Classe: classe, Type: typ, Etat: "active"}
			if got := Decider(s, travail); got != Ignorer {
				t.Errorf("compte de travail %s/%s : %v", classe, typ, got)
			}
		}
	}
	// Sans compte de travail, tout compte utilisateur est libre.
	if got := Decider(libre("background", "unspecified"), nil); got != Terminer {
		t.Errorf("sans compte de travail : %v", got)
	}
}
