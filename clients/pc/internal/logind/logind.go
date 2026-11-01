//go:build linux

// Paquet logind : accès à systemd-logind par D-Bus (sessions, verrouillage, fermeture).
// Équivaut à « loginctl lock-session / terminate-session » sans lancer de processus.
package logind

import (
	"context"
	"fmt"

	"github.com/godbus/dbus/v5"
)

const (
	service      = "org.freedesktop.login1"
	cheminRacine = dbus.ObjectPath("/org/freedesktop/login1")
	ifManager    = "org.freedesktop.login1.Manager"
	ifSession    = "org.freedesktop.login1.Session"
	ifProprietes = "org.freedesktop.DBus.Properties"
)

type Session struct {
	Chemin      dbus.ObjectPath
	ID          string
	UID         uint32
	Compte      string
	Type        string // x11, wayland, mir, tty, unspecified
	Classe      string // user, greeter, lock-screen, background, manager…
	Etat        string // online, active, closing
	Verrouillee bool   // LockedHint
}

// Graphique : seules ces sessions ont un écran de verrouillage qui renseigne LockedHint.
func (s Session) Graphique() bool {
	return s.Type == "x11" || s.Type == "wayland" || s.Type == "mir"
}

// Utilisateur : session d'un compte, ni écran de connexion ni gestionnaire de services.
func (s Session) Utilisateur() bool {
	return s.Classe == "user" && s.Etat != "closing"
}

type Logind struct {
	conn *dbus.Conn
}

// Connecter ouvre une connexion privée au bus système (pas la connexion partagée de godbus,
// pour pouvoir la fermer sans gêner d'autres utilisateurs du paquet).
func Connecter() (*Logind, error) {
	conn, err := dbus.ConnectSystemBus()
	if err != nil {
		return nil, fmt.Errorf("bus système D-Bus : %w", err)
	}
	return &Logind{conn: conn}, nil
}

func (l *Logind) Fermer() error {
	return l.conn.Close()
}

func (l *Logind) Sessions() ([]Session, error) {
	var liste []struct {
		ID     string
		UID    uint32
		Compte string
		Siege  string
		Chemin dbus.ObjectPath
	}
	err := l.conn.Object(service, cheminRacine).Call(ifManager+".ListSessions", 0).Store(&liste)
	if err != nil {
		return nil, fmt.Errorf("ListSessions : %w", err)
	}
	sessions := make([]Session, 0, len(liste))
	for _, e := range liste {
		var props map[string]dbus.Variant
		err := l.conn.Object(service, e.Chemin).Call(ifProprietes+".GetAll", 0, ifSession).Store(&props)
		if err != nil {
			continue // session fermée entre les deux appels
		}
		s := Session{Chemin: e.Chemin, ID: e.ID, UID: e.UID, Compte: e.Compte}
		s.Type, _ = props["Type"].Value().(string)
		s.Classe, _ = props["Class"].Value().(string)
		s.Etat, _ = props["State"].Value().(string)
		s.Verrouillee, _ = props["LockedHint"].Value().(bool)
		sessions = append(sessions, s)
	}
	return sessions, nil
}

func (l *Logind) Verrouiller(chemin dbus.ObjectPath) error {
	return l.conn.Object(service, chemin).Call(ifSession+".Lock", 0).Err
}

func (l *Logind) Terminer(chemin dbus.ObjectPath) error {
	return l.conn.Object(service, chemin).Call(ifSession+".Terminate", 0).Err
}

// Changement : une session a changé d'état de verrouillage, ou vient d'apparaître.
type Changement struct {
	Chemin      dbus.ObjectPath
	Verrouillee bool
	Nouvelle    bool
}

// Surveiller transmet les changements de LockedHint et les nouvelles sessions jusqu'à
// l'annulation du contexte.
func (l *Logind) Surveiller(ctx context.Context, f func(Changement)) error {
	if err := l.conn.AddMatchSignal(
		dbus.WithMatchSender(service),
		dbus.WithMatchInterface(ifProprietes),
		dbus.WithMatchMember("PropertiesChanged"),
		dbus.WithMatchArg(0, ifSession),
	); err != nil {
		return err
	}
	if err := l.conn.AddMatchSignal(
		dbus.WithMatchSender(service),
		dbus.WithMatchInterface(ifManager),
		dbus.WithMatchMember("SessionNew"),
	); err != nil {
		return err
	}
	ch := make(chan *dbus.Signal, 32)
	l.conn.Signal(ch)
	go func() {
		defer l.conn.RemoveSignal(ch)
		for {
			select {
			case <-ctx.Done():
				return
			case sig, ok := <-ch:
				if !ok {
					return
				}
				l.traiter(sig, f)
			}
		}
	}()
	return nil
}

func (l *Logind) traiter(sig *dbus.Signal, f func(Changement)) {
	switch sig.Name {
	case ifManager + ".SessionNew":
		if len(sig.Body) == 2 {
			if chemin, ok := sig.Body[1].(dbus.ObjectPath); ok {
				f(Changement{Chemin: chemin, Nouvelle: true})
			}
		}
	case ifProprietes + ".PropertiesChanged":
		if len(sig.Body) < 2 {
			return
		}
		if iface, _ := sig.Body[0].(string); iface != ifSession {
			return
		}
		changees, _ := sig.Body[1].(map[string]dbus.Variant)
		if v, ok := changees["LockedHint"]; ok {
			if b, ok := v.Value().(bool); ok {
				f(Changement{Chemin: sig.Path, Verrouillee: b})
				return
			}
		}
		// Propriété seulement invalidée : on relit la valeur.
		if len(sig.Body) >= 3 {
			invalidees, _ := sig.Body[2].([]string)
			for _, nom := range invalidees {
				if nom == "LockedHint" {
					var v dbus.Variant
					if err := l.conn.Object(service, sig.Path).Call(ifProprietes+".Get", 0, ifSession, "LockedHint").Store(&v); err == nil {
						if b, ok := v.Value().(bool); ok {
							f(Changement{Chemin: sig.Path, Verrouillee: b})
						}
					}
				}
			}
		}
	}
}
