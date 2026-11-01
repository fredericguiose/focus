//go:build windows

// Paquet wts : sessions Windows (API WTS) et comptes locaux (NetUser*). Les fonctions absentes
// de golang.org/x/sys/windows sont chargées depuis les DLL système.
package wts

import (
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	wtsapi32            = windows.NewLazySystemDLL("wtsapi32.dll")
	procDisconnect      = wtsapi32.NewProc("WTSDisconnectSession")
	procQuerySessionInf = wtsapi32.NewProc("WTSQuerySessionInformationW")
	netapi32            = windows.NewLazySystemDLL("netapi32.dll")
	procNetUserSetInfo  = netapi32.NewProc("NetUserSetInfo")
)

const (
	serveurCourant      = 0 // WTS_CURRENT_SERVER_HANDLE
	wtsUserName         = 5 // WTS_INFO_CLASS
	filtreCompteNormal  = 0x0002
	ufCompteDesactive   = 0x0002
	longueurMaxPreferee = 0xFFFFFFFF
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

// USER_INFO_1
type infoCompte1 struct {
	Nom          *uint16
	MotDePasse   *uint16
	AgeMotDePass uint32
	Privilege    uint32
	Dossier      *uint16
	Commentaire  *uint16
	Drapeaux     uint32
	Script       *uint16
}

// USER_INFO_1008
type infoCompte1008 struct {
	Drapeaux uint32
}

type Compte struct {
	Nom       string
	Desactive bool
}

// Comptes : comptes locaux « normaux » (ni comptes d'approbation, ni comptes machine).
func Comptes() ([]Compte, error) {
	var buf *byte
	var lus, total, reprise uint32
	if err := windows.NetUserEnum(nil, 1, filtreCompteNormal, &buf, longueurMaxPreferee, &lus, &total, &reprise); err != nil {
		return nil, fmt.Errorf("NetUserEnum : %w", err)
	}
	defer windows.NetApiBufferFree(buf)
	var comptes []Compte
	for _, c := range unsafe.Slice((*infoCompte1)(unsafe.Pointer(buf)), lus) {
		comptes = append(comptes, Compte{
			Nom:       windows.UTF16PtrToString(c.Nom),
			Desactive: c.Drapeaux&ufCompteDesactive != 0,
		})
	}
	return comptes, nil
}

// DefinirDesactive change seulement le drapeau « compte désactivé », sans toucher aux autres.
func DefinirDesactive(nom string, desactive bool) error {
	n, err := windows.UTF16PtrFromString(nom)
	if err != nil {
		return err
	}
	var buf *byte
	if err := windows.NetUserGetInfo(nil, n, 1, &buf); err != nil {
		return fmt.Errorf("NetUserGetInfo(%s) : %w", nom, err)
	}
	drapeaux := (*infoCompte1)(unsafe.Pointer(buf)).Drapeaux
	windows.NetApiBufferFree(buf)
	if desactive {
		drapeaux |= ufCompteDesactive
	} else {
		drapeaux &^= ufCompteDesactive
	}
	info := infoCompte1008{Drapeaux: drapeaux}
	var parametreFautif uint32
	r, _, _ := procNetUserSetInfo.Call(0, uintptr(unsafe.Pointer(n)), 1008,
		uintptr(unsafe.Pointer(&info)), uintptr(unsafe.Pointer(&parametreFautif)))
	if r != 0 {
		return fmt.Errorf("NetUserSetInfo(%s) : %w", nom, syscall.Errno(r))
	}
	return nil
}
