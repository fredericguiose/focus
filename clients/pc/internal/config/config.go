// Paquet config : fichier de configuration du client PC (JSON, sans secret : le jeton est
// dans un fichier à part, lisible par root/SYSTEM seulement).
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// EcouteParDefaut : adresse locale où focusd attend focus-agent.
const EcouteParDefaut = "127.0.0.1:47600"

type Config struct {
	// API : URL de base, ex. https://api-focus.fredericguiose.com
	API string `json:"api"`
	// JetonFichier : fichier contenant le jeton d'appareil (une ligne).
	JetonFichier string `json:"jeton_fichier"`
	// Appareil : nom de l'appareil dans la config Focus (pc_linux, pc_windows…).
	Appareil string `json:"appareil"`
	// EtatDossier : cache du planning et état local de focusd.
	EtatDossier string `json:"etat_dossier"`
	// EcouteLocale : adresse de boucle locale du canal focusd ↔ focus-agent.
	EcouteLocale string `json:"ecoute_locale"`
	// HostsFichier : vide = fichier hosts du système.
	HostsFichier string `json:"hosts_fichier"`
}

func dossierSysteme() string {
	if runtime.GOOS == "windows" {
		pd := os.Getenv("ProgramData")
		if pd == "" {
			pd = `C:\ProgramData`
		}
		return filepath.Join(pd, "Focus")
	}
	return "/etc/focus"
}

// CheminParDefaut : /etc/focus/client.json ou %ProgramData%\Focus\client.json.
func CheminParDefaut() string {
	return filepath.Join(dossierSysteme(), "client.json")
}

func defauts() Config {
	c := Config{
		JetonFichier: filepath.Join(dossierSysteme(), "jeton"),
		EcouteLocale: EcouteParDefaut,
	}
	if runtime.GOOS == "windows" {
		c.EtatDossier = filepath.Join(dossierSysteme(), "etat")
	} else {
		c.EtatDossier = "/var/lib/focus"
	}
	return c
}

// Lire charge le fichier, complète les valeurs par défaut et valide.
func Lire(chemin string) (*Config, error) {
	b, err := os.ReadFile(chemin)
	if err != nil {
		return nil, err
	}
	c := defauts()
	dec := json.NewDecoder(strings.NewReader(strings.TrimPrefix(string(b), "\ufeff")))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("%s : %w", chemin, err)
	}
	if err := c.Valider(); err != nil {
		return nil, fmt.Errorf("%s : %w", chemin, err)
	}
	return &c, nil
}

func (c *Config) Valider() error {
	u, err := url.Parse(c.API)
	if err != nil || u.Host == "" {
		return fmt.Errorf("api : URL invalide %q", c.API)
	}
	// Le jeton ne part jamais en clair, sauf vers la machine elle-même (essais).
	if u.Scheme != "https" && !(u.Scheme == "http" && estBoucle(u.Hostname())) {
		return fmt.Errorf("api : https obligatoire (%q)", c.API)
	}
	if c.Appareil == "" {
		return errors.New("appareil : obligatoire")
	}
	if c.JetonFichier == "" || c.EtatDossier == "" {
		return errors.New("jeton_fichier et etat_dossier : obligatoires")
	}
	hote, _, err := net.SplitHostPort(c.EcouteLocale)
	if err != nil || !estBoucle(hote) {
		return fmt.Errorf("ecoute_locale : adresse de boucle locale attendue (%q)", c.EcouteLocale)
	}
	return nil
}

// HoteAPI : nom d'hôte de l'API, que le client ne doit jamais bloquer lui-même.
func (c *Config) HoteAPI() string {
	u, err := url.Parse(c.API)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// CheminCache : fichier du dernier planning reçu.
func (c *Config) CheminCache() string {
	return filepath.Join(c.EtatDossier, "planning.json")
}

// LireJeton relit le fichier à chaque appel : un jeton remplacé est pris en compte sans
// redémarrer le service.
func (c *Config) LireJeton() (string, error) {
	b, err := os.ReadFile(c.JetonFichier)
	if err != nil {
		return "", err
	}
	j := strings.TrimSpace(strings.TrimPrefix(string(b), "\ufeff"))
	if j == "" {
		return "", fmt.Errorf("jeton vide dans %s", c.JetonFichier)
	}
	return j, nil
}

// JetonTropOuvert signale un fichier de jeton lisible par d'autres que son propriétaire
// (Linux ; sous Windows les ACL sont posées par l'installeur).
func (c *Config) JetonTropOuvert() bool {
	if runtime.GOOS == "windows" {
		return false
	}
	info, err := os.Stat(c.JetonFichier)
	return err == nil && info.Mode().Perm()&0o077 != 0
}

func estBoucle(hote string) bool {
	if hote == "localhost" {
		return true
	}
	ip := net.ParseIP(hote)
	return ip != nil && ip.IsLoopback()
}
