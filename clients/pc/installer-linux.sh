#!/usr/bin/env bash
# Installe ou met à jour le client PC Focus sous Fedora (focusd en service systemd,
# focus-agent au démarrage de chaque session GNOME). Idempotent : relançable sans risque.
#
#   ./installer-linux.sh --api https://api-focus.fredericguiose.com --appareil pc_linux
#
# --api et --appareil ne servent qu'à la première installation (création de
# /etc/focus/client.json). Le jeton d'appareil est demandé s'il n'est pas déjà en place.
# Les droits root sont demandés une seule fois, par pkexec.
set -euo pipefail

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API=""
APPAREIL=""
while [[ $# -gt 0 ]]; do
	case "$1" in
	--api) API="$2"; shift 2 ;;
	--appareil) APPAREIL="$2"; shift 2 ;;
	-h | --help) sed -n '2,9p' "$0"; exit 0 ;;
	*) echo "Option inconnue : $1" >&2; exit 2 ;;
	esac
done

if [[ $EUID -eq 0 ]]; then
	echo "À lancer avec son compte : la compilation se fait sans droits, pkexec est demandé ensuite." >&2
	exit 1
fi

GO="$(command -v go || true)"
[[ -z "$GO" && -x "$HOME/.local/bin/go" ]] && GO="$HOME/.local/bin/go"
if [[ -z "$GO" ]]; then
	echo "Go introuvable (attendu dans le PATH ou ~/.local/bin/go)." >&2
	exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
chmod 700 "$TMP"

echo "Compilation…"
(cd "$ICI" && CGO_ENABLED=0 "$GO" build -trimpath -o "$TMP/focusd" ./cmd/focusd)
(cd "$ICI" && CGO_ENABLED=0 "$GO" build -trimpath -o "$TMP/focus-agent" ./cmd/focus-agent)

if [[ ! -e /etc/focus/client.json ]]; then
	if [[ -z "$API" || -z "$APPAREIL" ]]; then
		echo "Première installation : --api et --appareil sont obligatoires." >&2
		exit 2
	fi
	printf '{\n  "api": "%s",\n  "appareil": "%s"\n}\n' "$API" "$APPAREIL" >"$TMP/client.json"
fi

if [[ ! -e /etc/focus/jeton ]]; then
	read -rsp "Jeton d'appareil (affiché une fois par « npm run jeton:creer -- appareil <nom> ») : " JETON || true # dernière ligne sans saut de ligne : read échoue mais remplit JETON
	echo
	if [[ -z "$JETON" ]]; then
		echo "Jeton vide." >&2
		exit 2
	fi
	(umask 077 && printf '%s\n' "$JETON" >"$TMP/jeton")
	unset JETON
fi

cat >"$TMP/focus-agent.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Focus (agent)
Comment=Questions de session et ouverture de session Focus
Exec=/usr/local/bin/focus-agent
X-GNOME-Autostart-enabled=true
NoDisplay=true
EOF

cat >"$TMP/racine.sh" <<'EOF'
set -euo pipefail
TMP="$1"

rpm -q zenity >/dev/null 2>&1 || dnf install -y zenity

install -d -m 755 /etc/focus
install -d -m 700 /var/lib/focus
[[ -e "$TMP/client.json" && ! -e /etc/focus/client.json ]] && install -m 644 "$TMP/client.json" /etc/focus/client.json
[[ -e "$TMP/jeton" && ! -e /etc/focus/jeton ]] && install -m 600 -o root -g root "$TMP/jeton" /etc/focus/jeton

install -m 755 "$TMP/focusd" /usr/local/bin/focusd
install -m 755 "$TMP/focus-agent" /usr/local/bin/focus-agent
install -m 644 "$TMP/focus-agent.desktop" /etc/xdg/autostart/focus-agent.desktop
command -v restorecon >/dev/null && restorecon -F /usr/local/bin/focusd /usr/local/bin/focus-agent \
	/etc/xdg/autostart/focus-agent.desktop /etc/focus /etc/focus/* /var/lib/focus || true

# L'unité est régénérée à chaque passage : une mise à jour de focusd peut changer son modèle.
if [[ -e /etc/systemd/system/focusd.service ]]; then
	systemctl stop focusd || true
	/usr/local/bin/focusd uninstall
fi
/usr/local/bin/focusd --config /etc/focus/client.json install
/usr/local/bin/focusd start
systemctl --no-pager --lines=5 status focusd || true
EOF

echo "Droits administrateur demandés (pkexec)…"
pkexec /bin/bash "$TMP/racine.sh" "$TMP"

echo "Installé. L'agent démarrera à la prochaine ouverture de session ; pour l'avoir tout de suite :"
echo "  nohup /usr/local/bin/focus-agent >/dev/null 2>&1 &"
