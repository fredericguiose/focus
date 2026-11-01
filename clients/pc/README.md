# Client PC Focus (Linux, Windows)

Deux exécutables (conception §5) :

- `focusd` : service (root / SYSTEM). Toutes les 60 s, `GET /v1/planning` ; garde le dernier
  planning en cache ; applique le segment en vigueur (fichier hosts, verrouillage des sessions,
  comptes libres) ; envoie accusés et événements `reconnexion`. Il détient seul le jeton.
- `focus-agent` : tourne dans la session de l'utilisateur. Pose les questions de session
  (« Je continue » après l'attente demandée par l'API, « J'arrête » immédiat) et ouvre une
  session (`focus-agent ouvrir`). Il ne parle qu'à `focusd`, sur `127.0.0.1:47600`.

Compilation : Go 1.27, `CGO_ENABLED=0`.

```sh
go build -trimpath ./cmd/focusd ./cmd/focus-agent
GOOS=windows GOARCH=amd64 go build -trimpath -o focusd.exe ./cmd/focusd
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags -H=windowsgui -o focus-agent.exe ./cmd/focus-agent
```

## Configuration du client

`/etc/focus/client.json` (Linux) ou `%ProgramData%\Focus\client.json` (Windows). Pas de
secret dedans. Seuls `api` et `appareil` sont obligatoires :

```json
{
  "api": "https://focus.exemple.workers.dev",
  "appareil": "pc_linux",
  "jeton_fichier": "/etc/focus/jeton",
  "etat_dossier": "/var/lib/focus",
  "ecoute_locale": "127.0.0.1:47600",
  "hosts_fichier": ""
}
```

| Clé | Défaut Linux | Défaut Windows |
|---|---|---|
| `jeton_fichier` | `/etc/focus/jeton` | `%ProgramData%\Focus\jeton` |
| `etat_dossier` (cache du planning) | `/var/lib/focus` | `%ProgramData%\Focus\etat` |
| `ecoute_locale` | `127.0.0.1:47600` | idem |
| `hosts_fichier` (vide = système) | `/etc/hosts` | `%SystemRoot%\System32\drivers\etc\hosts` |

`api` doit être en `https` (seul `http://127.0.0.1` est admis, pour les essais).

### Jeton

Jeton de type `appareil`, créé côté serveur par `npm run jeton:creer -- appareil <nom>`.
Une ligne dans `jeton_fichier`, lisible par root / SYSTEM seulement (Linux : `600 root:root`,
`focusd` prévient sinon). Il est relu à chaque requête : le remplacer suffit, sans redémarrer.

## Installation Linux (Fedora)

```sh
./installer-linux.sh --api https://focus.exemple.workers.dev --appareil pc_linux
```

Le script compile, demande le jeton (s'il n'est pas déjà en place), puis, en une seule
demande `pkexec` : installe `zenity` (dnf), les binaires dans `/usr/local/bin`, la config,
le service systemd (`focusd install`, puis `start`) et l'agent dans
`/etc/xdg/autostart/focus-agent.desktop` (toutes les sessions GNOME). Relancé, il met à jour les
binaires et redémarre le service sans toucher à la config ni au jeton.

`zenity` est obligatoire sous Linux : `ncruces/zenity` appelle ce programme. Sans lui,
`focus-agent` s'arrête avec un message. Installation seule : `pkexec dnf install zenity`.

Suivi : `journalctl -u focusd -f`, `focusd status`.

## Installation Windows

PowerShell en administrateur, binaires compilés comme ci-dessus :

```powershell
New-Item -ItemType Directory -Force "$env:ProgramFiles\Focus", "$env:ProgramData\Focus" | Out-Null
Copy-Item focusd.exe, focus-agent.exe "$env:ProgramFiles\Focus\"
Set-Content -Encoding ascii "$env:ProgramData\Focus\client.json" '{ "api": "https://focus.exemple.workers.dev", "appareil": "pc_windows" }'
Set-Content -Encoding ascii -NoNewline "$env:ProgramData\Focus\jeton" (Read-Host "Jeton d'appareil")
icacls "$env:ProgramData\Focus\jeton" /inheritance:r /grant:r "SYSTEM:F" "Administrators:F"
& "$env:ProgramFiles\Focus\focusd.exe" install
& "$env:ProgramFiles\Focus\focusd.exe" start
New-ItemProperty -Force -Path HKLM:\Software\Microsoft\Windows\CurrentVersion\Run `
  -Name FocusAgent -Value "`"$env:ProgramFiles\Focus\focus-agent.exe`""
```

Le service redémarre en cas d'échec. Journal : `%ProgramData%\Focus\etat\focusd.log`.
Sous Windows, les dialogues sont natifs (pas de `zenity` à installer). Le verrouillage
déconnecte les sessions (retour à l'écran de connexion, programmes gardés) ; les comptes libres
sont désactivés, puis réactivés à la fin du segment.

## Mode essai

Sans root, sans rien toucher au système :

```sh
focusd --config essai.json --sans-effet --hosts-fichier /tmp/hosts-essai
```

- `--hosts-fichier F` : le bloc est écrit dans `F` au lieu du fichier hosts du système (pas de
  vidage du cache DNS).
- `--sans-effet` : aucun verrouillage, aucun compte fermé, aucun accusé envoyé ; ce qui serait
  fait est journalisé. Sans `--hosts-fichier`, le bloc hosts est seulement journalisé.
- Les deux sont refusées par `focusd install`.

`essai.json` pointe vers une API locale (`http://127.0.0.1:…`), un jeton et un `etat_dossier`
accessibles à son compte, et un autre `ecoute_locale` si un `focusd` tourne déjà.

## Fichier hosts

Focus n'écrit qu'entre `# >>> focus` et `# <<< focus`, en fin de fichier ; le reste est conservé
à l'octet près (fins de ligne Windows comprises). Bloc supprimé quand plus rien n'est bloqué,
réécriture seulement s'il change. Le nom d'hôte de l'API n'est jamais bloqué.

## Désinstallation

Linux :

```sh
pkexec /bin/bash -c 'focusd stop; focusd uninstall; focusd lever;
  rm -f /usr/local/bin/focusd /usr/local/bin/focus-agent /etc/xdg/autostart/focus-agent.desktop;
  rm -rf /etc/focus /var/lib/focus'
```

Windows (administrateur) :

```powershell
$f = "$env:ProgramFiles\Focus\focusd.exe"
& $f stop; & $f uninstall; & $f lever
Remove-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Run -Name FocusAgent
Remove-Item -Recurse "$env:ProgramFiles\Focus", "$env:ProgramData\Focus"
```

`focusd lever` retire le bloc hosts et réactive les comptes que Focus a désactivés. Il ne
déverrouille aucune session. Arrêter le service ne lève rien : le bloc reste jusqu'à `lever`.

## Bibliothèques

| Module | Rôle | Licence |
|---|---|---|
| `github.com/kardianos/service` v1.3.0 | service systemd / Windows | zlib |
| `github.com/ncruces/zenity` v0.10.15 | dialogues | MIT |
| `github.com/txn2/txeh` v1.8.1 | vidage du cache DNS | Apache-2.0 |
| `github.com/godbus/dbus/v5` v5.2.4 | logind (Linux) | BSD-2-Clause |
| `golang.org/x/sys` v0.49.0 | WTS, NetUser (Windows) | BSD-3-Clause |
| `golang.org/x/image` v0.45.0 | indirect (zenity) | BSD-3-Clause |
