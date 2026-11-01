// focus-agent : tourne dans la session de l'utilisateur, pose les questions de session et
// ouvre une session à la demande. Ne parle qu'à focusd, sur la boucle locale.
//
//	focus-agent [options]                     surveiller (démarrage automatique de la session)
//	focus-agent [options] ouvrir [--apps a,b] ouvrir une session de travail
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/agent"
	"github.com/fredericguiose/focus/clients/pc/internal/config"
	"github.com/fredericguiose/focus/clients/pc/internal/dialogues"
	"github.com/fredericguiose/focus/clients/pc/internal/local"
)

func main() {
	chemin := flag.String("config", config.CheminParDefaut(), "fichier de configuration du client (pour ecoute_locale)")
	adresse := flag.String("adresse", "", "adresse de focusd (défaut : ecoute_locale de la config, sinon "+config.EcouteParDefaut+")")
	flag.Usage = func() {
		fmt.Fprintln(flag.CommandLine.Output(), "Usage : focus-agent [options] [ouvrir [--apps a,b]]")
		flag.PrintDefaults()
	}
	flag.Parse()

	j := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if !dialogues.Disponible() {
		j.Error("programme zenity introuvable : l'installer (Fedora : dnf install zenity)")
		os.Exit(1)
	}
	if *adresse == "" {
		*adresse = config.EcouteParDefaut
		if c, err := config.Lire(*chemin); err == nil {
			*adresse = c.EcouteLocale
		}
	}
	a := &agent.Agent{
		Canal:     local.NouveauClient(*adresse),
		Dialogues: dialogues.Zenity{Journal: j},
		Journal:   j,
	}
	ctx, arreter := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer arreter()

	switch flag.Arg(0) {
	case "":
		j.Info("focus-agent démarré", "focusd", *adresse)
		a.Surveiller(ctx, 2*time.Second)
	case "ouvrir":
		fs := flag.NewFlagSet("ouvrir", flag.ExitOnError)
		apps := fs.String("apps", "", "apps à débloquer, séparées par des virgules (sinon demandées)")
		_ = fs.Parse(flag.Args()[1:])
		if err := a.Ouvrir(ctx, agent.LireApps(*apps)); err != nil && !errors.Is(err, context.Canceled) {
			j.Error("ouverture de session", "erreur", err)
			os.Exit(1)
		}
	default:
		flag.Usage()
		os.Exit(2)
	}
}
