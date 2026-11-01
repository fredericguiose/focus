// focusd : service (root/SYSTEM) qui applique le planning Focus de l'appareil.
//
//	focusd [options]                 exécuter (au premier plan, ou lancé par systemd / le SCM)
//	focusd [options] install         installer le service (démarrage automatique)
//	focusd uninstall|start|stop|restart|status
//	focusd [options] lever           retirer ce que Focus a posé (bloc hosts)
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/fredericguiose/focus/clients/pc/internal/api"
	"github.com/fredericguiose/focus/clients/pc/internal/comptes"
	"github.com/fredericguiose/focus/clients/pc/internal/config"
	"github.com/fredericguiose/focus/clients/pc/internal/demon"
	"github.com/fredericguiose/focus/clients/pc/internal/hosts"
	"github.com/fredericguiose/focus/clients/pc/internal/local"
	"github.com/fredericguiose/focus/clients/pc/internal/verrou"
	"github.com/kardianos/service"
)

type options struct {
	config       string
	hostsFichier string
	sansEffet    bool
	rafraichir   time.Duration
}

func main() {
	var o options
	flag.StringVar(&o.config, "config", config.CheminParDefaut(), "fichier de configuration du client")
	flag.StringVar(&o.hostsFichier, "hosts-fichier", "", "essai : écrire le bloc dans ce fichier au lieu du fichier hosts du système")
	flag.BoolVar(&o.sansEffet, "sans-effet", false, "essai : ne verrouille rien, ne ferme aucun compte, n'envoie aucun accusé")
	flag.DurationVar(&o.rafraichir, "rafraichir", 60*time.Second, "intervalle entre deux GET /v1/planning")
	flag.Usage = func() {
		fmt.Fprintln(flag.CommandLine.Output(), "Usage : focusd [options] [install|uninstall|start|stop|restart|status|lever]")
		flag.PrintDefaults()
	}
	flag.Parse()
	if err := lancer(o, flag.Arg(0)); err != nil {
		fmt.Fprintln(os.Stderr, "focusd :", err)
		os.Exit(1)
	}
}

func lancer(o options, commande string) error {
	if !filepath.IsAbs(o.config) {
		abs, err := filepath.Abs(o.config)
		if err != nil {
			return err
		}
		o.config = abs
	}
	p := &programme{o: o}
	svc, err := service.New(p, &service.Config{
		Name:         "focusd",
		DisplayName:  "Focus",
		Description:  "Applique le planning Focus : sites bloqués, verrouillage, comptes libres.",
		Arguments:    []string{"--config", o.config},
		Dependencies: []string{"Wants=network-online.target", "After=network-online.target"},
		Option: service.KeyValue{
			"OnFailure":              "restart",
			"OnFailureDelayDuration": "5s",
			"DelayedAutoStart":       false,
		},
	})
	if err != nil {
		return err
	}
	switch commande {
	case "":
		return svc.Run()
	case "lever":
		return lever(o)
	case "status":
		st, err := svc.Status()
		if err != nil {
			return err
		}
		switch st {
		case service.StatusRunning:
			fmt.Println("en marche")
		case service.StatusStopped:
			fmt.Println("arrêté")
		default:
			fmt.Println("inconnu")
		}
		return nil
	case "install":
		if o.sansEffet || o.hostsFichier != "" {
			return errors.New("--sans-effet et --hosts-fichier sont réservés aux essais, pas au service installé")
		}
		if _, err := config.Lire(o.config); err != nil {
			return err
		}
		fallthrough
	case "uninstall", "start", "stop", "restart":
		return service.Control(svc, commande)
	default:
		flag.Usage()
		return fmt.Errorf("commande inconnue : %q", commande)
	}
}

type programme struct {
	o       options
	annuler context.CancelFunc
	fini    sync.WaitGroup
}

func (p *programme) Start(s service.Service) error {
	ctx, annuler := context.WithCancel(context.Background())
	p.annuler = annuler
	pret := make(chan error, 1)
	p.fini.Add(1)
	go func() {
		defer p.fini.Done()
		if err := p.executer(ctx, pret); err != nil {
			pret <- err
		}
	}()
	return <-pret
}

func (p *programme) Stop(s service.Service) error {
	if p.annuler != nil {
		p.annuler()
	}
	p.fini.Wait()
	return nil
}

func journal(cfg *config.Config) *slog.Logger {
	var sortie io.Writer = os.Stderr
	// Service Windows : pas de console, on écrit dans le dossier d'état.
	if runtime.GOOS == "windows" && !service.Interactive() {
		if err := os.MkdirAll(cfg.EtatDossier, 0o700); err == nil {
			if f, err := os.OpenFile(filepath.Join(cfg.EtatDossier, "focusd.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
				sortie = f
			}
		}
	}
	return slog.New(slog.NewTextHandler(sortie, nil))
}

// construire assemble le démon et ses applicateurs ; fermer libère les connexions système.
func construire(o options) (*demon.Demon, *config.Config, *slog.Logger, func(), error) {
	cfg, err := config.Lire(o.config)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if o.hostsFichier != "" {
		cfg.HostsFichier = o.hostsFichier
	}
	j := journal(cfg)
	if cfg.JetonTropOuvert() {
		j.Warn("fichier de jeton lisible par d'autres comptes : chmod 600", "fichier", cfg.JetonFichier)
	}

	var d *demon.Demon
	opts := demon.Options{
		API:         api.Nouveau(cfg.API, cfg.LireJeton),
		Appareil:    cfg.Appareil,
		HoteAPI:     cfg.HoteAPI(),
		CacheChemin: cfg.CheminCache(),
		SansEffet:   o.sansEffet,
		Journal:     j,
		Rafraichir:  o.rafraichir,
	}
	switch {
	case cfg.HostsFichier != "":
		opts.Hosts = hosts.Fichier{Chemin: cfg.HostsFichier}
	case o.sansEffet:
		opts.Hosts = &hosts.Journal{Journal: j}
	default:
		opts.Hosts = hosts.Fichier{Chemin: hosts.CheminSysteme()}
		opts.ViderDNS = hosts.ViderCacheDNS
	}
	var fermetures []func() error
	if o.sansEffet {
		opts.Verrou = &verrou.SansEffet{Journal: j}
		opts.Comptes = &comptes.SansEffet{Journal: j}
	} else {
		v, err := verrou.Systeme(j, func(r verrou.Reconnexion) { d.Reconnexion(r) })
		if err != nil {
			return nil, nil, nil, nil, fmt.Errorf("verrou : %w", err)
		}
		c, err := comptes.Systeme(j, cfg.EtatDossier)
		if err != nil {
			v.Fermer()
			return nil, nil, nil, nil, fmt.Errorf("comptes : %w", err)
		}
		opts.Verrou, opts.Comptes = v, c
		fermetures = append(fermetures, v.Fermer, c.Fermer)
	}
	d = demon.Nouveau(opts)
	fermer := func() {
		for _, f := range fermetures {
			_ = f()
		}
	}
	return d, cfg, j, fermer, nil
}

func (p *programme) executer(ctx context.Context, pret chan<- error) error {
	d, cfg, j, fermer, err := construire(p.o)
	if err != nil {
		return err
	}
	defer fermer()
	if err := d.ChargerCache(); err != nil && !errors.Is(err, fs.ErrNotExist) {
		j.Warn("cache du planning ignoré", "erreur", err)
	}

	ecoute, err := net.Listen("tcp", cfg.EcouteLocale)
	if err != nil {
		return fmt.Errorf("canal local %s : %w", cfg.EcouteLocale, err)
	}
	srv := &http.Server{
		Handler:           local.Gestionnaire(d),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
	}
	go func() {
		if err := srv.Serve(ecoute); err != nil && !errors.Is(err, http.ErrServerClosed) {
			j.Error("canal local", "erreur", err)
		}
	}()
	j.Info("focusd démarré", "appareil", cfg.Appareil, "api", cfg.API, "sans_effet", p.o.sansEffet,
		"hosts", map[bool]string{true: cfg.HostsFichier, false: hosts.CheminSysteme()}[cfg.HostsFichier != ""])
	pret <- nil

	d.Executer(ctx)

	arret, annuler := context.WithTimeout(context.Background(), 5*time.Second)
	defer annuler()
	_ = srv.Shutdown(arret)
	j.Info("focusd arrêté")
	return nil
}

// lever : désinstallation et dépannage. Le planning n'est pas consulté.
func lever(o options) error {
	d, _, _, fermer, err := construire(o)
	if err != nil {
		return err
	}
	defer fermer()
	return d.Lever()
}
