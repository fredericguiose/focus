package main

import (
	"strings"
	"testing"
)

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
