//go:build windows

// Paquet wts : sessions Windows (API WTS). Les fonctions absentes
// de golang.org/x/sys/windows sont chargées depuis les DLL système.
package wts

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	wtsapi32            = windows.NewLazySystemDLL("wtsapi32.dll")
	procDisconnect      = wtsapi32.NewProc("WTSDisconnectSession")
	procQuerySessionInf = wtsapi32.NewProc("WTSQuerySessionInformationW")
)

const (
	serveurCourant      = 0 // WTS_CURRENT_SERVER_HANDLE
	wtsUserName         = 5 // WTS_INFO_CLASS
)

type Session struct {
	ID     uint32
	Etat   uint32 // windows.WTSActive, WTSDisconnected…
	Compte string
}

// Active : session ouverte et affichée (y compris derrière l'écran Win+L).
func (s Session) Active() bool {
	return s.Etat == windows.WTSActive && s.Compte != ""
}

func Sessions() ([]Session, error) {
	var info *windows.WTS_SESSION_INFO
	var n uint32
	if err := windows.WTSEnumerateSessions(serveurCourant, 0, 1, &info, &n); err != nil {
		return nil, fmt.Errorf("WTSEnumerateSessions : %w", err)
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(info)))
	var sessions []Session
	for _, s := range unsafe.Slice(info, n) {
		if s.SessionID == 0 {
			continue // session 0 : services, jamais interactive
		}
		compte, _ := nomDuCompte(s.SessionID)
		sessions = append(sessions, Session{ID: s.SessionID, Etat: s.State, Compte: compte})
	}
	return sessions, nil
}

func nomDuCompte(id uint32) (string, error) {
	var buf *uint16
	var octets uint32
	r, _, err := procQuerySessionInf.Call(serveurCourant, uintptr(id), wtsUserName,
		uintptr(unsafe.Pointer(&buf)), uintptr(unsafe.Pointer(&octets)))
	if r == 0 {
		return "", err
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(buf)))
	return windows.UTF16PtrToString(buf), nil
}

// Deconnecter renvoie la session à l'écran de connexion sans fermer ses programmes : c'est le
// moyen, pour un service, de verrouiller une autre session que la sienne.
func Deconnecter(id uint32) error {
	r, _, err := procDisconnect.Call(serveurCourant, uintptr(id), 0)
	if r == 0 {
		return fmt.Errorf("WTSDisconnectSession(%d) : %w", id, err)
	}
	return nil
}
