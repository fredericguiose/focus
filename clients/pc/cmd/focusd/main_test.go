package main

import (
	"flag"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/demon"
)

// Le planning est relu toutes les 30 s par défaut ; --rafraichir reste réglable (essais).
func TestRafraichirParDefaut30s(t *testing.T) {
	if demon.RafraichirParDefaut != 30*time.Second {
		t.Fatalf("RafraichirParDefaut = %v, attendu 30s", demon.RafraichirParDefaut)
	}
	for _, cas := range []struct {
		args    []string
		attendu time.Duration
	}{
		{nil, 30 * time.Second},
		{[]string{"--rafraichir", "5s"}, 5 * time.Second},
	} {
		var o options
		fs := flag.NewFlagSet("focusd", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		declarerOptions(fs, &o)
		if err := fs.Parse(cas.args); err != nil {
			t.Fatal(err)
		}
		if o.rafraichir != cas.attendu {
			t.Errorf("%v : rafraichir = %v, attendu %v", cas.args, o.rafraichir, cas.attendu)
		}
	}
}

// L'unité de service ne fixe pas l'intervalle : le défaut du binaire s'applique.
func TestServiceSansIntervalleFige(t *testing.T) {
	c := configService("/etc/focus/client.json")
	if strings.Contains(strings.Join(c.Arguments, " "), "rafraichir") {
		t.Errorf("arguments du service : %v", c.Arguments)
	}
}

// Le modèle par défaut de kardianos/service met RestartSec=120 : focusd tué restait arrêté
// deux minutes (constaté dans l'essai système).
func TestUniteSystemdRedemarreVite(t *testing.T) {
	c := configService("/etc/focus/client.json")
	script, _ := c.Option["SystemdScript"].(string)
	for _, attendu := range []string{"Restart=always\n", "RestartSec=2\n", "StartLimitIntervalSec=0\n", "{{range Arguments}}"} {
		if !strings.Contains(script, attendu) {
			t.Errorf("unité systemd sans %q", attendu)
		}
	}
	if strings.Contains(script, "RestartSec=120") {
		t.Error("RestartSec=120 : redémarrage trop lent")
	}
	if c.Arguments[0] != "--config" || c.Arguments[1] != "/etc/focus/client.json" {
		t.Errorf("arguments %v", c.Arguments)
	}
}
