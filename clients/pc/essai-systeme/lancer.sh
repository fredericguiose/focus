#!/usr/bin/env bash
# Essai système du client PC Focus dans un conteneur podman (Fedora, systemd en PID 1).
# Aucun droit root sur l'hôte, rien n'est modifié hors du conteneur.
#
#   ./lancer.sh                       essai complet contre une fausse API (dans le conteneur)
#   ./lancer.sh --garder              laisse le conteneur en marche à la fin (podman exec -it … bash)
#   ./lancer.sh --sortie DIR          captures d'écran et journaux (défaut : dossier temporaire)
#   ./lancer.sh --api-locale --jeton-appareil F [--jeton-interface F]
#       ajoute l'essai contre l'API locale (npm run local, http://127.0.0.1:8799) ; avec le
#       jeton interface, règle son horloge sur la nuit puis la remet à l'heure réelle.
#
# Prérequis : podman, Go (go dans le PATH ou ~/.local/bin/go) et ses modules déjà téléchargés
# (le conteneur compile hors ligne avec le Go et le cache de modules de l'hôte, en lecture seule).
set -euo pipefail

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PC="$(dirname "$ICI")"
IMAGE=localhost/focus-essai-systeme
NOM="focus-essai-$$"
URL_LOCALE=http://127.0.0.1:8799
GARDER=0
SORTIE=""
API_LOCALE=0
JETON_APPAREIL=""
JETON_INTERFACE=""
while [[ $# -gt 0 ]]; do
	case "$1" in
	--garder) GARDER=1; shift ;;
	--sortie) SORTIE="$2"; shift 2 ;;
	--api-locale) API_LOCALE=1; shift ;;
	--jeton-appareil) JETON_APPAREIL="$2"; shift 2 ;;
	--jeton-interface) JETON_INTERFACE="$2"; shift 2 ;;
	-h | --help) sed -n '2,13p' "$0"; exit 0 ;;
	*) echo "Option inconnue : $1" >&2; exit 2 ;;
	esac
done
if ((API_LOCALE)) && [[ ! -r "$JETON_APPAREIL" ]]; then
	echo "--api-locale demande --jeton-appareil (fichier contenant un jeton d'appareil pc_linux)." >&2
	exit 2
fi

GO="$(command -v go || true)"
[[ -z "$GO" && -x "$HOME/.local/bin/go" ]] && GO="$HOME/.local/bin/go"
[[ -n "$GO" ]] || { echo "Go introuvable." >&2; exit 1; }
GOROOT="$("$GO" env GOROOT)"
GOMODCACHE="$("$GO" env GOMODCACHE)"
(cd "$PC" && "$GO" mod download) # modules présents pour la compilation hors ligne

[[ -n "$SORTIE" ]] || SORTIE="$(mktemp -d -t focus-essai-XXXXXX)"
mkdir -p "$SORTIE"

# Avec l'API locale, le conteneur partage le réseau de l'hôte : les ports de l'essai doivent
# être libres (fausse API 18799, canal local de focusd 47600).
RESEAU=()
if ((API_LOCALE)); then
	RESEAU=(--network=host)
	for p in 18799 47600; do
		if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
			echo "Port 127.0.0.1:$p déjà pris sur l'hôte : un focusd tourne-t-il ici ?" >&2
			exit 1
		fi
	done
fi

horloge() { # horloge <valeur JSON> : POST /v1/dev/horloge (jeton interface, jamais affiché)
	curl -sS -o /dev/null -w '%{http_code}' -X POST "$URL_LOCALE/v1/dev/horloge" \
		-H "Authorization: Bearer $(tr -d '[:space:]' <"$JETON_INTERFACE")" \
		-H 'Content-Type: application/json' -d "{\"horloge\": $1}"
}
statut() {
	curl -sS "$URL_LOCALE/v1/statut" -H "Authorization: Bearer $(tr -d '[:space:]' <"$JETON_INTERFACE")"
}
HORLOGE_REGLEE=0
nettoyer() {
	if ((HORLOGE_REGLEE)); then
		echo "Horloge de l'API locale remise à l'heure réelle : HTTP $(horloge null)"
	fi
	if ((GARDER)); then
		echo "Conteneur gardé : podman exec -it $NOM bash   (podman rm -f $NOM pour finir)"
	else
		podman rm -f "$NOM" >/dev/null 2>&1 || true
	fi
}
trap nettoyer EXIT

echo "▸ Image $IMAGE"
podman build -q -t "$IMAGE" -f "$ICI/Containerfile" "$ICI" >/dev/null

echo "▸ Conteneur $NOM (systemd en PID 1)"
# --no-hosts : /etc/hosts est un vrai fichier du conteneur, pas un montage de podman.
# label=disable : lecture des montages (sources, Go) sans réétiqueter les fichiers de l'hôte.
podman run -d --name "$NOM" --systemd=always --no-hosts --hostname focus-essai \
	--security-opt label=disable "${RESEAU[@]}" \
	-v "$PC:/src/pc:ro" -v "$GOROOT:/opt/go:ro" -v "$GOMODCACHE:/opt/gomod:ro" \
	"$IMAGE" >/dev/null
for _ in $(seq 1 60); do
	etat="$(podman exec "$NOM" systemctl is-system-running 2>/dev/null || true)"
	[[ "$etat" == running || "$etat" == degraded ]] && break
	sleep 0.5
done

# --privileged (dans l'espace de noms du conteneur seulement) : montage en lecture seule
# de /etc/hosts pour le point 6.13.
CODE=0
podman exec --privileged "$NOM" /src/pc/essai-systeme/verifier.sh principal || CODE=1

if ((API_LOCALE)); then
	podman cp "$JETON_APPAREIL" "$NOM:/run/jeton-appareil"
	podman exec "$NOM" /src/pc/essai-systeme/verifier.sh api-locale "$URL_LOCALE" /run/jeton-appareil || CODE=1
	if [[ -r "$JETON_INTERFACE" ]]; then
		coucher="$(statut | python3 -c 'import json,sys;print(json.load(sys.stdin)["journee"]["coucher_applique"])')"
		minutes="$(python3 -c "import datetime as d,sys;c=d.datetime.fromisoformat('$coucher'.replace('Z','+00:00'));print(max(int((c-d.datetime.now(d.timezone.utc)).total_seconds()//60)+10, 1))")"
		HORLOGE_REGLEE=1
		echo "▸ Horloge de l'API locale : +${minutes}min (coucher + 10 min) : HTTP $(horloge "\"+${minutes}min\"")"
		podman exec "$NOM" /src/pc/essai-systeme/verifier.sh api-locale-nuit || CODE=1
		echo "▸ Horloge de l'API locale remise à l'heure réelle : HTTP $(horloge null)"
		HORLOGE_REGLEE=0
		ecart="$(statut | python3 -c 'import json,sys,datetime as d;h=d.datetime.fromisoformat(json.load(sys.stdin)["heure_serveur"].replace("Z","+00:00"));print(abs((h-d.datetime.now(d.timezone.utc)).total_seconds()))')"
		if python3 -c "import sys;sys.exit(not $ecart < 5)"; then
			echo "OK     R.9 horloge de l'API locale à l'heure réelle (écart ${ecart} s)"
		else
			echo "ÉCHEC  R.9 horloge de l'API locale : écart ${ecart} s avec l'heure réelle"
			CODE=1
		fi
		podman exec "$NOM" /src/pc/essai-systeme/verifier.sh api-locale-fin || CODE=1
	fi
fi

podman cp "$NOM:/srv/essai-sortie/." "$SORTIE/" 2>/dev/null || true
echo
echo "Captures et journaux : $SORTIE"
if ((CODE == 0)); then echo "RÉSULTAT : OK"; else echo "RÉSULTAT : ÉCHEC"; fi
exit "$CODE"
