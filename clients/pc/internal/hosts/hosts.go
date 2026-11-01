// Paquet hosts : bloc de lignes géré par Focus dans le fichier hosts, entre deux balises.
// Tout ce qui est hors des balises est conservé à l'octet près.
//
// txeh n'est pas utilisé pour écrire le fichier : son rendu réécrit toutes les lignes
// d'adresses (espacement, casse, fins de ligne CRLF), ce qui toucherait le reste du fichier.
// Il sert au vidage du cache DNS, multi-plateforme (resolvectl, ipconfig /flushdns).
package hosts

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"

	"github.com/txn2/txeh"
)

const (
	DebutBloc = "# >>> focus"
	FinBloc   = "# <<< focus"
)

// Un nom invalide (espace, saut de ligne…) pourrait injecter une ligne arbitraire dans le
// fichier hosts, par exemple une redirection vers une fausse banque : on ne l'écrit jamais.
var nomValide = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

// Normaliser met en minuscules, dédoublonne, trie et écarte les noms invalides.
func Normaliser(domaines []string) (valides, rejetes []string) {
	vus := map[string]bool{}
	for _, d := range domaines {
		n := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(d)), ".")
		if len(n) > 253 || !nomValide.MatchString(n) {
			rejetes = append(rejetes, d)
			continue
		}
		if !vus[n] {
			vus[n] = true
			valides = append(valides, n)
		}
	}
	slices.Sort(valides)
	return valides, rejetes
}

// Rendre renvoie le contenu du fichier avec le bloc Focus remplacé par les domaines donnés
// (bloc supprimé si la liste est vide). Fonction pure, idempotente.
func Rendre(contenu string, domaines []string) string {
	valides, _ := Normaliser(domaines)
	fin := "\n"
	if strings.Contains(contenu, "\r\n") {
		fin = "\r\n"
	}

	var garde []string
	position := -1
	dansBloc := false
	for _, l := range strings.SplitAfter(contenu, "\n") {
		if l == "" {
			continue
		}
		t := strings.TrimSpace(l)
		switch {
		case !dansBloc && t == DebutBloc:
			dansBloc = true
			if position < 0 {
				position = len(garde)
			}
		case dansBloc:
			if t == FinBloc {
				dansBloc = false
			}
		case t == FinBloc:
			// balise de fin orpheline : on la retire, rien d'autre
		default:
			garde = append(garde, l)
		}
	}
	// Une balise de début sans fin ne peut venir que d'une écriture interrompue de notre
	// bloc, toujours placé en fin de fichier : tout ce qui suit est donc à nous.

	if len(valides) == 0 {
		return strings.Join(garde, "")
	}
	var b strings.Builder
	b.WriteString(DebutBloc + fin)
	for _, d := range valides {
		b.WriteString("0.0.0.0 " + d + fin)
		b.WriteString(":: " + d + fin)
	}
	b.WriteString(FinBloc + fin)

	if position < 0 {
		position = len(garde)
		if n := len(garde); n > 0 && !strings.HasSuffix(garde[n-1], "\n") {
			garde[n-1] += fin
		}
	}
	return strings.Join(garde[:position], "") + b.String() + strings.Join(garde[position:], "")
}

// CheminSysteme : /etc/hosts, ou %SystemRoot%\System32\drivers\etc\hosts sous Windows.
func CheminSysteme() string {
	if runtime.GOOS == "windows" {
		racine := os.Getenv("SystemRoot")
		if racine == "" {
			racine = `C:\Windows`
		}
		return filepath.Join(racine, "System32", "drivers", "etc", "hosts")
	}
	return "/etc/hosts"
}

// Applicateur pose la liste des domaines bloqués ; change indique si quelque chose a bougé.
type Applicateur interface {
	Appliquer(domaines []string) (change bool, err error)
}

// Fichier écrit réellement dans un fichier hosts (le vrai, ou celui de --hosts-fichier).
type Fichier struct {
	Chemin string
}

func (f Fichier) Appliquer(domaines []string) (bool, error) {
	b, err := os.ReadFile(f.Chemin)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return false, err
	}
	nouveau := Rendre(string(b), domaines)
	if nouveau == string(b) {
		return false, nil
	}
	if err := ecrireSurPlace(f.Chemin, []byte(nouveau)); err != nil {
		return false, fmt.Errorf("écriture de %s : %w", f.Chemin, err)
	}
	return true, nil
}

// ecrireSurPlace garde l'inode : un renommage changerait le contexte SELinux de /etc/hosts
// (net_conf_t sous Fedora) et remplacerait un éventuel lien symbolique. On écrit d'abord le
// nouveau contenu puis on tronque : une coupure laisse au pire une fin d'ancien bloc, jamais
// un fichier vide.
func ecrireSurPlace(chemin string, donnees []byte) error {
	f, err := os.OpenFile(chemin, os.O_WRONLY|os.O_CREATE, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.WriteAt(donnees, 0); err != nil {
		f.Close()
		return err
	}
	if err := f.Truncate(int64(len(donnees))); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// Journal remplace le fichier en mode --sans-effet sans --hosts-fichier : il dit ce qu'il
// écrirait, seulement quand la liste change.
type Journal struct {
	Journal *slog.Logger
	dernier []string
	premier bool
}

func (j *Journal) Appliquer(domaines []string) (bool, error) {
	valides, _ := Normaliser(domaines)
	if j.premier && slices.Equal(valides, j.dernier) {
		return false, nil
	}
	j.premier = true
	j.dernier = valides
	j.Journal.Info("sans effet : bloc hosts", "domaines", valides)
	return true, nil
}

// ViderCacheDNS : sous Linux, l'absence de systemd-resolved n'est pas une erreur (pas de cache
// local, le fichier hosts est relu à chaque résolution).
// txeh.ErrNoResolver n'existe que sous Linux ; ce cas se reconnaît à une commande vide.
func ViderCacheDNS() error {
	err := txeh.FlushDNSCache()
	var fe *txeh.FlushError
	if errors.As(err, &fe) && fe.Command == "" {
		return nil
	}
	return err
}
