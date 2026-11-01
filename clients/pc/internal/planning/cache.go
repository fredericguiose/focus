package planning

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Cache est ce qui est gardé sur disque pour rejouer le dernier planning hors ligne,
// y compris après un redémarrage.
type Cache struct {
	Planning   *Planning `json:"planning"`
	DecalageMs int64     `json:"decalage_ms"`
	RecuLe     time.Time `json:"recu_le"`
}

func (c Cache) Horloge() Horloge {
	return Horloge{Decalage: time.Duration(c.DecalageMs) * time.Millisecond}
}

// LireCache renvoie os.ErrNotExist (enveloppée) s'il n'y a pas encore de cache.
func LireCache(chemin string) (Cache, error) {
	var c Cache
	b, err := os.ReadFile(chemin)
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, fmt.Errorf("cache illisible %s : %w", chemin, err)
	}
	if c.Planning == nil {
		return c, errors.New("cache sans planning")
	}
	if err := c.Planning.Valider(); err != nil {
		return c, fmt.Errorf("cache invalide : %w", err)
	}
	return c, nil
}

// EcrireCache remplace le fichier d'un coup (fichier temporaire puis renommage) : une coupure
// pendant l'écriture ne doit jamais laisser un cache tronqué.
func EcrireCache(chemin string, c Cache) error {
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	dossier := filepath.Dir(chemin)
	if err := os.MkdirAll(dossier, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dossier, ".planning-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), chemin)
}
