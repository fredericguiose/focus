package config

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func ecrire(t *testing.T, contenu string) string {
	t.Helper()
	chemin := filepath.Join(t.TempDir(), "client.json")
	if err := os.WriteFile(chemin, []byte(contenu), 0o644); err != nil {
		t.Fatal(err)
	}
	return chemin
}

func TestLireAvecDefauts(t *testing.T) {
	c, err := Lire(ecrire(t, `{"api": "https://focus.exemple.dev", "appareil": "pc_linux"}`))
	if err != nil {
		t.Fatal(err)
	}
	if c.EcouteLocale != EcouteParDefaut || c.JetonFichier == "" || c.EtatDossier == "" {
		t.Errorf("valeurs par défaut absentes : %+v", c)
	}
	if c.HoteAPI() != "focus.exemple.dev" {
		t.Errorf("hôte API %q", c.HoteAPI())
	}
}

func TestRefus(t *testing.T) {
	cas := map[string]string{
		"http distant":      `{"api": "http://focus.exemple.dev", "appareil": "pc_linux"}`,
		"sans appareil":     `{"api": "https://focus.exemple.dev"}`,
		"écoute non locale": `{"api": "https://focus.exemple.dev", "appareil": "a", "ecoute_locale": "0.0.0.0:47600"}`,
		"champ inconnu":     `{"api": "https://focus.exemple.dev", "appareil": "a", "jeton": "secret"}`,
		"URL sans hôte":     `{"api": "https://", "appareil": "a"}`,
		"json invalide":     `{"api": `,
	}
	for nom, contenu := range cas {
		if _, err := Lire(ecrire(t, contenu)); err == nil {
			t.Errorf("%s : accepté", nom)
		}
	}
	if _, err := Lire(ecrire(t, `{"api": "http://127.0.0.1:8787", "appareil": "a"}`)); err != nil {
		t.Errorf("http vers la boucle locale refusé : %v", err)
	}
}

func TestJeton(t *testing.T) {
	dir := t.TempDir()
	c := &Config{JetonFichier: filepath.Join(dir, "jeton")}
	if err := os.WriteFile(c.JetonFichier, []byte("  abc123\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	j, err := c.LireJeton()
	if err != nil || j != "abc123" {
		t.Fatalf("jeton %q, %v", j, err)
	}
	if runtime.GOOS != "windows" {
		if c.JetonTropOuvert() {
			t.Error("0600 signalé trop ouvert")
		}
		if err := os.Chmod(c.JetonFichier, 0o644); err != nil {
			t.Fatal(err)
		}
		if !c.JetonTropOuvert() {
			t.Error("0644 non signalé")
		}
	}
	if err := os.WriteFile(c.JetonFichier, []byte("\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := c.LireJeton(); err == nil {
		t.Error("jeton vide accepté")
	}
}
