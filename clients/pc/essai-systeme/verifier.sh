#!/usr/bin/env bash
# Vérifications de l'essai système, DANS le conteneur (root, systemd en PID 1). Lancé par
# lancer.sh ; chaque point affiche OK, ÉCHEC ou INFO.
#
#   verifier.sh principal                    installation, planning, hosts, logind, verrou, agent, robustesse
#   verifier.sh api-locale <url> <jeton>     bascule sur une vraie API locale (http://127.0.0.1:…)
#   verifier.sh api-locale-nuit              vérifie le verrou après réglage de l'horloge de l'API
#   verifier.sh api-locale-fin               vérifie le retour au mode réel
set -uo pipefail

E=/src/pc/essai-systeme
FA=/srv/fausse-api
PORT_FA=18799
CACHE=/var/lib/focus/planning.json
SORTIE=/srv/essai-sortie
mkdir -p "$SORTIE" /run/faux-verrou
chmod 1777 /run/faux-verrou

NB_OK=0
NB_ECHEC=0
ok() { printf 'OK     %s\n' "$1"; NB_OK=$((NB_OK + 1)); }
echec() {
	printf 'ÉCHEC  %s\n' "$1"
	[[ -n "${2:-}" ]] && printf '       %s\n' "$2"
	NB_ECHEC=$((NB_ECHEC + 1))
}
info() { printf 'INFO   %s\n' "$1"; }
section() { printf '\n── %s ──\n' "$1"; }

# attendre <secondes> <commande…> : vrai dès que la commande réussit.
attendre() {
	local fin=$((SECONDS + $1))
	shift
	while ((SECONDS < fin)); do
		"$@" >/dev/null 2>&1 && return 0
		sleep 0.5
	done
	"$@" >/dev/null 2>&1
}
# tenir <secondes> <commande…> : vrai si la commande réussit pendant toute la durée.
tenir() {
	local fin=$((SECONDS + $1))
	shift
	while ((SECONDS < fin)); do
		"$@" >/dev/null 2>&1 || return 1
		sleep 0.5
	done
}
verifier() { # verifier <libellé> <secondes> <commande…>
	local l="$1" s="$2"
	shift 2
	if attendre "$s" "$@"; then ok "$l"; else echec "$l"; fi
}
non() { ! "$@"; }
# fenetre : attend qu'une fenêtre zenity « Focus » soit affichée sur :99 (et prenne le focus).
fenetre() {
	attendre 8 bash -c "DISPLAY=:99 xdotool search --onlyvisible --name '^Focus\$'"
	sleep 1.5
}

# ─── Journal de focusd ────────────────────────────────────────────────────────
CURSEUR=""
marquer() { CURSEUR=$(journalctl -u focusd -n 0 --show-cursor --no-pager 2>/dev/null | sed -n 's/^-- cursor: //p'); }
journal() {
	if [[ -n "$CURSEUR" ]]; then
		journalctl -u focusd -o cat --no-pager --after-cursor="$CURSEUR"
	else
		journalctl -u focusd -o cat --no-pager
	fi
}
journal_contient() { journal | grep -qF -- "$1"; }

# ─── Fausse API ───────────────────────────────────────────────────────────────
planning() { # planning <spec JSON> (voir fabriquer-planning.py)
	python3 "$E/fabriquer-planning.py" <<<"$1" >"$FA/planning.json.tmp" && mv "$FA/planning.json.tmp" "$FA/planning.json"
}
# planning_recu <config_version> : le cache de focusd contient ce planning.
planning_recu() { grep -q "\"config_version\": \"$1\"" "$CACHE" 2>/dev/null; }
mode_planning() { # mode_planning <config> <spec> : publie et attend que focusd l'ait reçu et appliqué
	planning "$2"
	attendre 15 planning_recu "$1" || echec "planning $1 non reçu par focusd"
	sleep 2.5 # un tour d'application (2 s)
}
fausse_api() {
	systemctl "$1" fausse-api.service
	[[ "$1" == start ]] && attendre 5 bash -c "exec 3<>/dev/tcp/127.0.0.1/$PORT_FA"
	return 0
}
comportement() { echo "$1" >"$FA/comportement"; }
requete_recue() { grep -F -- "$1" "$FA/requetes.jsonl" | grep -qF -- "${2:-}"; }

# ─── Fichier hosts ────────────────────────────────────────────────────────────
bloc() { sed -n '/^# >>> focus$/,/^# <<< focus$/p' /etc/hosts; }
hors_bloc() { sed '/^# >>> focus$/,/^# <<< focus$/d' /etc/hosts; }
a_bloc() { grep -qx '# >>> focus' /etc/hosts; }
bloque() { grep -qx "0.0.0.0 $1" /etc/hosts && grep -qx ":: $1" /etc/hosts; }
inode() { stat -c %i /etc/hosts; }
empreinte_hosts() { stat -c '%i %Y %s' /etc/hosts; sha256sum /etc/hosts; }

# ─── Sessions logind ──────────────────────────────────────────────────────────
# ouvrir <compte> <tty|x11|x11-verrou|fond> : ouvre une vraie session logind (pam_systemd)
# et affiche son identifiant.
ouvrir() {
	local compte="$1" sorte="$2" avant id
	avant=$(loginctl list-sessions --no-legend | awk '{print $1}' | sort)
	case "$sorte" in
	tty) setsid script -qfc "su -l $compte -c 'sleep 3600'" /dev/null </dev/null >/dev/null 2>&1 & ;;
	x11) XDG_SESSION_TYPE=x11 setsid su -l "$compte" -c 'sleep 3600' </dev/null >/dev/null 2>&1 & ;;
	x11-verrou) XDG_SESSION_TYPE=x11 setsid su -l "$compte" -c "$E/faux-verrou.sh" </dev/null >/dev/null 2>&1 & ;;
	fond) setsid su -l "$compte" -c 'sleep 3600' </dev/null >/dev/null 2>&1 & ;;
	esac
	for _ in $(seq 1 40); do
		id=$(comm -13 <(echo "$avant") <(loginctl list-sessions --no-legend | awk -v c="$compte" '$3==c && $6!="manager"{print $1}' | sort) | head -1)
		[[ -n "$id" ]] && break
		sleep 0.25
	done
	if [[ "$sorte" == x11-verrou ]]; then
		for _ in $(seq 1 40); do grep -q pret "/run/faux-verrou/$id" 2>/dev/null && break; sleep 0.25; done
		sleep 0.5
	fi
	echo "$id"
}
existe() { [[ "$(loginctl show-session "$1" -p State --value 2>/dev/null)" =~ ^(active|online)$ ]]; }
fermee() { ! existe "$1"; }
verrouillee() { [[ "$(loginctl show-session "$1" -p LockedHint --value 2>/dev/null)" == yes ]]; }
classe() { loginctl show-session "$1" -p Class --value 2>/dev/null; }
locks() { local n; n=$(grep -c ' lock$' "/run/faux-verrou/$1" 2>/dev/null); echo "${n:-0}"; }
deverrouiller() { # l'utilisateur déverrouille : l'écran de verrouillage retire LockedHint
	busctl call org.freedesktop.login1 "/org/freedesktop/login1/session/$1" org.freedesktop.login1.Session SetLockedHint b false
}
tout_fermer() { for c in alice libre; do loginctl terminate-user "$c" 2>/dev/null; done; sleep 1; }

# ─── Plannings types ──────────────────────────────────────────────────────────
DOMAINES='["youtube.com","www.youtube.com","chatgpt.com"]'
p_travail() { echo "{\"config\":\"$1\",\"segments\":[{\"mode\":\"WORK\",\"de\":-60,\"a\":3600,\"bloquer\":${2:-$DOMAINES},\"fermer\":${3:-false},\"sessions\":\"autorisees\"}]}"; }
p_libre() { echo "{\"config\":\"$1\",\"segments\":[{\"mode\":\"EVENING_FREE\",\"de\":-60,\"a\":3600}]}"; }
p_matin() { echo "{\"config\":\"$1\",\"segments\":[{\"mode\":\"MORNING_LOCK\",\"de\":-60,\"a\":3600,\"bloquer\":$DOMAINES,\"fermer\":true}]}"; }
p_nuit() { echo "{\"config\":\"$1\",\"segments\":[{\"mode\":\"NIGHT_LOCK\",\"de\":-60,\"a\":3600,\"bloquer\":$DOMAINES,\"verrou\":true}]}"; }

# ══════════════════════════════════════════════════════════════════════════════
principal() {
	install -d -m 700 "$FA"
	: >"$FA/requetes.jsonl"
	comportement normal
	# Jeton factice de l'essai (aucun secret réel) : connu de la fausse API et de l'installeur.
	(umask 077 && head -c 32 /dev/urandom | base64 | tr -d '/+=\n' >"$FA/jeton")
	install -m 600 -o alice "$FA/jeton" /home/alice/.jeton-essai

	# /etc/hosts préexistant au contenu varié (tabulations, IPv6, commentaires, entrée
	# personnelle sur un domaine que Focus bloque aussi, ligne vide, espaces en fin de ligne).
	printf '%s\n' \
		'# Fichier hosts de la machine' \
		'127.0.0.1   localhost localhost.localdomain localhost4 localhost4.localdomain4' \
		'::1         localhost localhost.localdomain localhost6 localhost6.localdomain6' \
		'' \
		$'192.168.1.20\tnas.maison nas   ' \
		'0.0.0.0 youtube.com   # blocage personnel, hors Focus' \
		'fe80::1%eth0 routeur.local' \
		'# fin' >/etc/hosts
	cp -p /etc/hosts /root/hosts.origine
	INODE=$(inode)

	section "1. Compilation, installation, service systemd"
	local sortie rc
	sortie=$(su -l alice -c "$E/../installer-linux.sh --api http://127.0.0.1:$PORT_FA --appareil pc_linux < ~/.jeton-essai" 2>&1)
	rc=$?
	echo "$sortie" >"$SORTIE/installeur-1.log"
	if [[ $rc -eq 0 ]]; then ok "1.1 installer-linux.sh tel quel (compilation Go + pkexec) : code 0"; else echec "1.1 installer-linux.sh : code $rc" "$(tail -5 <<<"$sortie")"; fi
	if file_statique /usr/local/bin/focusd && file_statique /usr/local/bin/focus-agent; then ok "1.2 binaires focusd et focus-agent installés, statiques (CGO_ENABLED=0)"; else echec "1.2 binaires absents ou dynamiques"; fi
	[[ "$(stat -c '%a %U:%G' /etc/focus/jeton)" == "600 root:root" ]] && ok "1.3 /etc/focus/jeton en 600 root:root" || echec "1.3 droits du jeton : $(stat -c '%a %U:%G' /etc/focus/jeton)"
	[[ "$(stat -c '%a' /var/lib/focus)" == 700 && -f /etc/xdg/autostart/focus-agent.desktop ]] && ok "1.4 /var/lib/focus en 700, agent dans /etc/xdg/autostart" || echec "1.4 dossier d'état ou autostart"
	verifier "1.5 service focusd actif et activé ; « focusd status » = en marche" 10 bash -c '[[ $(systemctl is-active focusd) == active && $(systemctl is-enabled focusd) == enabled && $(focusd status) == "en marche" ]]'
	grep -q '^Restart=always' /etc/systemd/system/focusd.service && grep -q '^RestartSec=2$' /etc/systemd/system/focusd.service &&
		ok "1.6 unité : Restart=always, RestartSec=2" || echec "1.6 unité systemd" "$(grep -E 'Restart' /etc/systemd/system/focusd.service | tr '\n' ' ')"

	section "6a. Robustesse : API injoignable au démarrage, sans cache"
	verifier "6.1 journal : premier échec signalé (« aucun planning connu »)" 10 journal_contient "aucun planning connu"
	tenir 4 systemctl is-active --quiet focusd && ok "6.2 le service reste actif sans API" || echec "6.2 service arrêté sans API"
	cmp -s /etc/hosts /root/hosts.origine && ok "6.3 /etc/hosts intact tant qu'aucun planning n'est connu" || echec "6.3 /etc/hosts modifié sans planning"

	section "1 (suite). Redémarrage après kill, journal, réinstallation"
	local pid pid2
	pid=$(systemctl show -p MainPID --value focusd)
	kill -9 "$pid"
	if attendre 10 bash -c "p=\$(systemctl show -p MainPID --value focusd); [[ \$p != 0 && \$p != $pid ]] && systemctl is-active --quiet focusd"; then
		ok "1.7 kill -9 : focusd relancé par systemd en moins de 10 s"
	else
		echec "1.7 kill -9 : pas relancé en 10 s" "$(systemctl show -p SubState -p NRestarts focusd | tr '\n' ' ')"
	fi
	journalctl -u focusd -o cat --no-pager | grep -q "focusd démarré" && ok "1.8 journalctl -u focusd lisible (« focusd démarré »)" || echec "1.8 journal vide"
	# Ensuite, rafraîchissement toutes les 2 s (au lieu de 60) pour enchaîner les modes vite.
	mkdir -p /etc/systemd/system/focusd.service.d
	printf '%s\n' '[Service]' 'ExecStart=' 'ExecStart=/usr/local/bin/focusd --config /etc/focus/client.json --rafraichir 2s' \
		>/etc/systemd/system/focusd.service.d/essai.conf
	systemctl daemon-reload

	section "2. Planning : réception, cache, hors ligne"
	# Unité permanente (une unité systemd-run disparaît dès qu'on l'arrête).
	printf '%s\n' '[Unit]' 'Description=Fausse API Focus (essai)' '[Service]' \
		"ExecStart=/usr/bin/python3 $E/fausse-api.py $PORT_FA $FA" >/etc/systemd/system/fausse-api.service
	systemctl daemon-reload
	systemctl start fausse-api.service
	attendre 5 bash -c "exec 3<>/dev/tcp/127.0.0.1/$PORT_FA"
	planning "$(p_travail essai-1)"
	marquer
	systemctl restart focusd
	verifier "2.1 planning reçu de l'API (journal « planning reçu »)" 15 journal_contient "config_version=essai-1"
	[[ "$(stat -c %a "$CACHE" 2>/dev/null)" == 600 ]] && planning_recu essai-1 && ok "2.2 planning mis en cache dans $CACHE (600)" || echec "2.2 cache absent ou trop ouvert"
	requete_recue '"/v1/planning"' '"autorise": true' && ok "2.3 jeton envoyé et accepté (Authorization: Bearer)" || echec "2.3 jeton non présenté"

	section "3. /etc/hosts"
	verifier "3.1 bloc « # >>> focus » écrit (youtube.com, www.youtube.com, chatgpt.com ; IPv4 et IPv6)" 6 bash -c "$(declare -f bloque); bloque youtube.com && bloque www.youtube.com && bloque chatgpt.com"
	[[ "$(tail -1 /etc/hosts)" == "# <<< focus" ]] && ok "3.2 bloc placé en fin de fichier" || echec "3.2 bloc pas en fin de fichier"
	hors_bloc | cmp -s - /root/hosts.origine && ok "3.3 reste du fichier conservé à l'octet près" || echec "3.3 reste du fichier modifié" "$(hors_bloc | diff /root/hosts.origine - | head -5 | tr '\n' '|')"
	[[ $(inode) == "$INODE" ]] && ok "3.4 même inode (écriture sur place)" || echec "3.4 inode changé"
	verifier "3.5 accusé bloquer_domaines envoyé à l'API" 6 requete_recue '"/v1/accuses"' '"bloquer_domaines"'
	local e1
	e1=$(empreinte_hosts)
	sleep 6
	[[ "$(empreinte_hosts)" == "$e1" ]] && ok "3.6 idempotence : 3 tours sans changement, fichier non réécrit (inode, mtime, contenu)" || echec "3.6 fichier réécrit sans changement"
	# Liste modifiée, avec des noms invalides qui ne doivent jamais être écrits.
	mode_planning essai-2 "$(p_travail essai-2 '["youtube.com","twitch.tv","bad name","evil.com\n6.6.6.6 banque.fr","127.0.0.1"]')"
	if bloque twitch.tv && ! bloque chatgpt.com && ! grep -q '6.6.6.6\|banque\|bad name\|127.0.0.1$' <(bloc); then
		ok "3.7 liste modifiée appliquée ; noms invalides (espace, saut de ligne, IP) écartés"
	else
		echec "3.7 liste modifiée" "$(bloc | tr '\n' '|')"
	fi
	echo '192.168.1.50 imprimante.maison' >>/etc/hosts # ajout de l'utilisateur après le bloc
	sleep 3
	mode_planning essai-3 "$(p_libre essai-3)"
	if ! a_bloc && cmp -s /etc/hosts <(cat /root/hosts.origine; echo '192.168.1.50 imprimante.maison'); then
		ok "3.8 soirée libre : bloc retiré, fichier d'origine + ajout de l'utilisateur intacts"
	else
		echec "3.8 retrait du bloc" "$(diff /root/hosts.origine /etc/hosts | head -6 | tr '\n' '|')"
	fi
	[[ $(inode) == "$INODE" ]] && ok "3.9 toujours le même inode après ajout et retrait" || echec "3.9 inode changé"
	cp -p /etc/hosts /root/hosts.origine

	section "2 (suite). Hors ligne : rejeu du cache, fin de segment à l'heure"
	tout_fermer
	# Matin verrouillé pendant 45 s, puis soirée libre ; planning valable 2 h.
	mode_planning essai-4 "{\"config\":\"essai-4\",\"segments\":[{\"mode\":\"MORNING_LOCK\",\"de\":-60,\"a\":45,\"bloquer\":[\"youtube.com\"],\"fermer\":true},{\"mode\":\"EVENING_FREE\",\"de\":45,\"a\":3600}]}"
	local fin_matin
	fin_matin=$(python3 -c "import json,datetime;p=json.load(open('$CACHE'))['planning'];print(datetime.datetime.fromisoformat(p['segments'][0]['fin'].replace('Z','+00:00')).timestamp())")
	marquer
	fausse_api stop
	verifier "2.4 API coupée : journal « API injoignable : rejeu du dernier planning »" 10 journal_contient "rejeu du dernier planning"
	marquer
	systemctl restart focusd
	verifier "2.5 redémarrage hors ligne : cache relu, MORNING_LOCK réappliqué" 8 journal_contient "mode=MORNING_LOCK"
	bloque youtube.com && ok "2.6 hors ligne : bloc hosts maintenu" || echec "2.6 bloc perdu hors ligne"
	local s
	s=$(ouvrir libre tty)
	verifier "2.7 hors ligne : session texte du compte libre fermée (fermer_comptes_hors_travail rejoué)" 6 fermee "$s"
	a_bloc || echec "2.8 préalable : bloc attendu avant la fin du segment"
	if attendre 60 non a_bloc; then
		local retard
		retard=$(python3 -c "import time;print(round(time.time()-$fin_matin,1))")
		if python3 -c "import sys;sys.exit(not(-0.5<=$retard<=3))"; then
			ok "2.8 fin du segment hors ligne : bloc levé à l'heure de fin (+${retard} s)"
		else
			echec "2.8 bloc levé à +${retard} s de l'heure de fin"
		fi
	else
		echec "2.8 bloc toujours là après la fin du segment"
	fi
	s=$(ouvrir libre tty)
	tenir 6 existe "$s" && ok "2.9 après la fin du segment : compte libre de nouveau utilisable" || echec "2.9 session libre fermée après la fin du segment"
	tout_fermer
	# Planning valable 20 s seulement : au-delà, hors ligne, tout est levé.
	fausse_api start
	mode_planning essai-5 "{\"config\":\"essai-5\",\"valable\":20,\"segments\":[{\"mode\":\"WORK\",\"de\":-60,\"a\":3600,\"bloquer\":[\"youtube.com\"]}]}"
	fausse_api stop
	bloque youtube.com || echec "2.10 préalable : bloc attendu"
	sleep 15
	verifier "2.10 hors ligne au-delà de valable_jusqua : tout est levé" 10 non a_bloc
	fausse_api start

	section "4. logind : comptes libres"
	tout_fermer
	mode_planning essai-6 "$(p_libre essai-6)"
	local L_tty L_fond L_x11v L_x11 F_tty F_x11v
	L_tty=$(ouvrir libre tty)
	L_fond=$(ouvrir libre fond)
	L_x11v=$(ouvrir libre x11-verrou)
	L_x11=$(ouvrir libre x11)
	F_tty=$(ouvrir alice tty)
	F_x11v=$(ouvrir alice x11-verrou)
	info "sessions : libre tty=$L_tty fond=$L_fond($(classe "$L_fond")) x11+verrou=$L_x11v x11=$L_x11 ; alice tty=$F_tty x11+verrou=$F_x11v"
	if tenir 8 bash -c "$(declare -f existe); existe $L_tty && existe $L_x11v && existe $L_x11 && existe $F_tty && existe $F_x11v" && [[ $(locks "$L_x11v") == 0 && $(locks "$F_x11v") == 0 ]]; then
		ok "4.1 soirée libre : aucune session fermée ni verrouillée (8 s)"
	else
		echec "4.1 soirée libre : une session a été touchée"
	fi
	marquer
	mode_planning essai-7 "$(p_matin essai-7)"
	verifier "4.2 MORNING_LOCK : session texte (tty) du compte libre fermée" 4 fermee "$L_tty"
	verifier "4.3 session graphique du compte libre verrouillée (Lock reçu, LockedHint=yes)" 4 verrouillee "$L_x11v"
	local t1=$SECONDS
	if attendre 16 fermee "$L_x11"; then ok "4.4 session graphique sans écran de verrouillage fermée après le délai (~$((SECONDS - t1 + 3)) s)"; else echec "4.4 session graphique non verrouillable toujours ouverte"; fi
	existe "$L_x11v" && ok "4.5 session graphique verrouillée gardée (travail en cours conservé)" || echec "4.5 session verrouillée fermée à tort"
	deverrouiller "$L_x11v" >/dev/null
	verifier "4.6 déverrouillage pendant le segment : session du compte libre fermée" 5 fermee "$L_x11v"
	s=$(ouvrir libre tty)
	verifier "4.7 nouvelle session texte du compte libre pendant le segment : fermée" 5 fermee "$s"
	if existe "$F_tty" && existe "$F_x11v" && [[ $(locks "$F_x11v") == 0 ]] && ! verrouillee "$F_x11v"; then
		ok "4.8 compte de travail (alice) : sessions ni fermées ni verrouillées"
	else
		echec "4.8 compte de travail touché"
	fi
	if existe "$L_fond"; then
		info "4.9 session de classe « $(classe "$L_fond") » du compte libre (su sans terminal, cron, ssh sans pty) NON fermée : seules les classes « user » sont visées (point à trancher)"
	else
		info "4.9 session de classe background du compte libre fermée"
	fi
	journal | grep -q "compte=alice" && echec "4.10 journal : une action vise alice" || ok "4.10 journal : aucune action sur le compte de travail"
	mode_planning essai-8 "$(p_libre essai-8)"
	s=$(ouvrir libre tty)
	local s2
	s2=$(ouvrir libre x11-verrou)
	tenir 12 bash -c "$(declare -f existe); existe $s && existe $s2" && [[ $(locks "$s2") == 0 ]] && ok "4.11 retour en soirée libre : nouvelles sessions du compte libre intactes (12 s)" || echec "4.11 soirée libre : session touchée"

	section "5. Verrouillage des sessions (NIGHT_LOCK)"
	tout_fermer
	F_x11v=$(ouvrir alice x11-verrou)
	F_tty=$(ouvrir alice tty)
	L_x11v=$(ouvrir libre x11-verrou)
	: >"$FA/requetes.jsonl"
	marquer
	mode_planning essai-9 "$(p_nuit essai-9)"
	verifier "5.1 session graphique du compte de travail verrouillée (Lock logind → LockedHint=yes)" 4 verrouillee "$F_x11v"
	verifier "5.2 session graphique du compte libre verrouillée aussi" 4 verrouillee "$L_x11v"
	verifier "5.3 session texte : Lock demandé une fois, session gardée" 4 bash -c "$(declare -f journal journal_contient existe); CURSEUR='$CURSEUR'; journal_contient 'session verrouillée\" session=$F_tty' && existe $F_tty"
	verifier "5.4 accusé verrouiller_session envoyé" 6 requete_recue '"/v1/accuses"' '"verrouiller_session"'
	deverrouiller "$F_x11v" >/dev/null
	verifier "5.5 déverrouillage pendant la nuit : reverrouillée aussitôt" 4 bash -c "$(declare -f locks verrouillee); [[ \$(locks $F_x11v) -ge 2 ]] && verrouillee $F_x11v"
	verifier "5.6 événement « reconnexion » envoyé (compte alice, session $F_x11v)" 8 requete_recue '"/v1/evenements"' "\"session\": \"$F_x11v\""
	s=$(ouvrir alice x11-verrou)
	verifier "5.7 session graphique ouverte pendant la nuit : verrouillée (relance si le Lock précède l'écran de verrouillage)" 12 verrouillee "$s"
	verifier "5.8 … et signalée en reconnexion" 8 requete_recue '"/v1/evenements"' "\"session\": \"$s\""
	existe "$F_tty" && existe "$F_x11v" && ok "5.9 aucune session fermée par le verrou" || echec "5.9 session fermée par le verrou"
	mode_planning essai-10 "$(p_libre essai-10)"
	deverrouiller "$F_x11v" >/dev/null
	local n
	n=$(locks "$F_x11v")
	sleep 7
	[[ $(locks "$F_x11v") == "$n" ]] && ! verrouillee "$F_x11v" && ok "5.10 fin de la nuit : plus de reverrouillage (7 s)" || echec "5.10 reverrouillage après la fin du segment"

	section "5 (suite). focus-agent et dialogues zenity (Xvfb)"
	tout_fermer
	systemd-run --quiet --unit xvfb -p Restart=no Xvfb :99 -screen 0 1024x768x24 -nolisten tcp
	attendre 5 test -e /tmp/.X11-unix/X99
	mode_planning essai-11 "{\"config\":\"essai-11\",\"segments\":[{\"mode\":\"WORK\",\"de\":-60,\"a\":3600,\"bloquer\":[\"youtube.com\",\"chatgpt.com\"],\"sessions\":\"autorisees\"}],\"sessions\":[{\"id\":\"s_01\",\"tache\":\"DM de maths\",\"domaines\":[\"chatgpt.com\"],\"question\":{\"id\":\"q_01\",\"posee\":12,\"attente\":8,\"expire\":180}}]}"
	bloque youtube.com && ! bloque chatgpt.com && ok "5.11 session de travail ouverte : chatgpt.com débloqué, youtube.com bloqué" || echec "5.11 domaines de la session"
	XDG_SESSION_TYPE=x11 setsid su -l alice -c "DISPLAY=:99 GTK_A11Y=none focus-agent > /tmp/agent.log 2>&1" </dev/null >/dev/null 2>&1 &
	verifier "5.12 focus-agent démarré dans une session X (DISPLAY=:99)" 6 grep -q "focus-agent démarré" /tmp/agent.log
	verifier "5.13 question posée à l'heure : fenêtre zenity « Toujours sur « DM de maths » ? »" 20 bash -c "pgrep -u alice -a zenity | grep -q 'question'"
	fenetre
	DISPLAY=:99 import -window root "$SORTIE/1-question.png" 2>/dev/null
	DISPLAY=:99 xdotool key Return # « Je continue » (bouton par défaut)
	verifier "5.14 « Je continue » : compte à rebours affiché (attente_s)" 5 bash -c "pgrep -u alice -a zenity | grep -q 'progress'"
	fenetre
	DISPLAY=:99 import -window root "$SORTIE/2-patienter.png" 2>/dev/null
	verifier "5.15 réponse « continue » envoyée à l'API après l'attente" 15 requete_recue '/v1/sessions/s_01/reponse' '"reponse": "continue"'
	pgrep -u alice zenity >/dev/null && echec "5.16 dialogue resté ouvert" || ok "5.16 dialogues fermés, agent toujours en marche ($(pgrep -u alice -c focus-agent) processus)"
	(su -l alice -c "DISPLAY=:99 GTK_A11Y=none focus-agent ouvrir --apps chatgpt > /tmp/ouvrir.log 2>&1; echo code=\$? >> /tmp/ouvrir.log") &
	verifier "5.17 « focus-agent ouvrir » : liste des tâches affichée" 8 bash -c "pgrep -u alice -a zenity | grep -q -- '--list'"
	fenetre
	DISPLAY=:99 import -window root "$SORTIE/3-taches.png" 2>/dev/null
	DISPLAY=:99 xdotool key Down
	sleep 0.5
	DISPLAY=:99 xdotool key Return
	verifier "5.18 attente de 10 s avant ouverture (annulable)" 5 bash -c "pgrep -u alice -a zenity | grep -q -- '--progress'"
	verifier "5.19 POST /v1/sessions envoyé (tâche choisie, apps chatgpt)" 15 requete_recue '"/v1/sessions"' '"apps": ["chatgpt"]'
	verifier "5.20 confirmation « Session ouverte » affichée" 5 bash -c "pgrep -u alice -a zenity | grep -q -- '--info'"
	fenetre
	DISPLAY=:99 import -window root "$SORTIE/4-ouverte.png" 2>/dev/null
	DISPLAY=:99 xdotool key Return
	verifier "5.21 « focus-agent ouvrir » terminé avec le code 0" 8 grep -q "code=0" /tmp/ouvrir.log
	cp /tmp/agent.log /tmp/ouvrir.log "$SORTIE/" 2>/dev/null
	pkill -u alice focus-agent

	section "6. Robustesse"
	tout_fermer
	# Jeton refusé (401) : le planning en mémoire continue de s'appliquer.
	mode_planning essai-12 "$(p_travail essai-12)"
	marquer
	echo "autre-jeton" >"$FA/jeton"
	verifier "6.4 jeton refusé : 401 journalisé" 8 journal_contient "API 401"
	tenir 4 bloque youtube.com && ok "6.5 jeton refusé : blocage en cours maintenu" || echec "6.5 blocage perdu sur 401"
	cp /etc/focus/jeton "$FA/jeton"
	# API muette (ne répond pas) : la boucle d'application continue.
	comportement muet
	marquer
	if attendre 40 journal_contient "rejeu du dernier planning"; then ok "6.6 API muette : délai de 30 s, puis rejeu (pas de blocage de la boucle)"; else echec "6.6 API muette : pas d'erreur après 40 s"; fi
	systemctl is-active --quiet focusd && bloque youtube.com && ok "6.7 API muette : service actif, blocage maintenu" || echec "6.7 API muette"
	comportement panne
	sleep 3
	comportement normal
	# Cache corrompu au démarrage, sans API.
	fausse_api stop
	systemctl stop focusd
	echo '{"planning": {"version": 1, "segments": [' >"$CACHE"
	marquer
	systemctl start focusd
	verifier "6.8 cache corrompu : « cache du planning ignoré » journalisé" 8 journal_contient "cache du planning ignoré"
	tenir 4 systemctl is-active --quiet focusd && ok "6.9 cache corrompu : le service démarre quand même" || echec "6.9 service arrêté sur cache corrompu"
	if a_bloc; then info "6.10 cache corrompu sans API : bloc hosts de l'ancien planning laissé en place"; else info "6.10 cache corrompu sans API : aucun planning, tout est levé (bloc retiré) — comportement « ouvert » par défaut"; fi
	echo '{"planning": {"version": 2, "heure_serveur": "2026-11-01T00:00:00Z", "valable_jusqua": "2099-01-01T00:00:00Z"}}' >"$CACHE"
	marquer
	systemctl restart focusd
	verifier "6.11 cache d'une version inconnue refusé (« version de planning 2 inconnue »)" 8 journal_contient "version de planning 2 inconnue"
	fausse_api start
	mode_planning essai-13 "$(p_travail essai-13)"
	planning_recu essai-13 && ok "6.12 API revenue : cache réécrit proprement" || echec "6.12 cache non réécrit"
	# /etc/hosts en lecture seule (montage lié ro) au moment où le bloc doit changer.
	tout_fermer
	marquer
	mount --bind /etc/hosts /etc/hosts && mount -o remount,ro,bind /etc/hosts
	planning "{\"config\":\"essai-14\",\"segments\":[{\"mode\":\"MORNING_LOCK\",\"de\":-60,\"a\":3600,\"bloquer\":[\"youtube.com\",\"reddit.com\"],\"fermer\":true}]}"
	attendre 15 planning_recu essai-14
	verifier "6.13 /etc/hosts en lecture seule : erreur journalisée (composant=hosts)" 6 journal_contient "composant=hosts"
	s=$(ouvrir libre tty)
	verifier "6.14 … les autres actions continuent (session du compte libre fermée)" 5 fermee "$s"
	systemctl is-active --quiet focusd && ok "6.15 … et le service reste actif" || echec "6.15 service arrêté sur hosts en lecture seule"
	umount /etc/hosts
	verifier "6.16 lecture seule levée : bloc écrit, « application rétablie »" 6 bash -c "$(declare -f journal journal_contient bloque); CURSEUR='$CURSEUR'; journal_contient 'application rétablie' && bloque reddit.com"
	# Arrêt du service pendant un blocage : le bloc reste jusqu'à « focusd lever ».
	systemctl stop focusd
	sleep 3
	bloque youtube.com && ok "6.17 service arrêté pendant un blocage : bloc hosts conservé" || echec "6.17 bloc retiré à l'arrêt"
	s=$(ouvrir libre tty)
	tenir 4 existe "$s" && info "6.18 service arrêté : plus de fermeture des comptes libres (attendu : rien n'agit sans focusd)" || echec "6.18 session fermée alors que focusd est arrêté ?"
	focusd lever >"$SORTIE/lever.log" 2>&1
	if ! a_bloc && cmp -s /etc/hosts /root/hosts.origine; then ok "6.19 « focusd lever » : bloc retiré, fichier d'origine restauré à l'octet près"; else echec "6.19 focusd lever" "$(cat "$SORTIE/lever.log")"; fi
	systemctl start focusd
	verifier "6.20 redémarrage : blocage réappliqué" 8 bloque youtube.com
	# Jeton lisible par tous : avertissement.
	chmod 644 /etc/focus/jeton
	marquer
	systemctl restart focusd
	verifier "6.21 jeton en 644 : avertissement « chmod 600 » journalisé" 6 journal_contient "chmod 600"
	chmod 600 /etc/focus/jeton
	if journalctl --no-pager -o cat | grep -qF "$(cat /etc/focus/jeton)"; then echec "6.22 le jeton apparaît dans le journal"; else ok "6.22 le jeton n'apparaît nulle part dans le journal"; fi

	section "1 (fin). Réinstallation (mise à jour)"
	local avant
	avant=$(sha256sum /etc/focus/client.json /etc/focus/jeton)
	sortie=$(su -l alice -c "$E/../installer-linux.sh < /dev/null" 2>&1)
	rc=$?
	echo "$sortie" >"$SORTIE/installeur-2.log"
	[[ $rc -eq 0 && "$(sha256sum /etc/focus/client.json /etc/focus/jeton)" == "$avant" ]] && ok "1.9 installeur relancé : code 0, config et jeton inchangés" || echec "1.9 réinstallation (code $rc)" "$(tail -3 <<<"$sortie")"
	verifier "1.10 service de nouveau actif après la mise à jour" 10 systemctl is-active --quiet focusd
	grep -q "DNS\|dns" <(journalctl -u focusd -o cat --no-pager) && info "DNS : « resolvectl flush-caches » échoue dans le conteneur (pas de systemd-resolved) ; erreur journalisée une fois par changement"

	resume
}

file_statique() { [[ -x "$1" ]] && ! ldd "$1" >/dev/null 2>&1; }

resume() {
	printf '\n%s OK, %s ÉCHEC\n' "$NB_OK" "$NB_ECHEC"
	journalctl -u focusd -o cat --no-pager >"$SORTIE/journal-focusd.log"
	cp "$FA/requetes.jsonl" "$SORTIE/requetes-api.jsonl" 2>/dev/null
	[[ $NB_ECHEC -eq 0 ]]
}

# ─── Vraie API locale (facultatif) ────────────────────────────────────────────
api_locale() {
	local url="$1" jeton="$2"
	section "R. Vraie API locale ($url)"
	tout_fermer
	systemctl stop fausse-api.service 2>/dev/null
	install -m 600 -o root -g root "$jeton" /etc/focus/jeton
	rm -f "$jeton"
	printf '{\n  "api": "%s",\n  "appareil": "pc_linux"\n}\n' "$url" >/etc/focus/client.json
	rm -f "$CACHE"
	marquer
	systemctl restart focusd
	verifier "R.1 planning reçu de la vraie API" 15 journal_contient "planning reçu"
	python3 -c "import json;p=json.load(open('$CACHE'))['planning'];print('INFO   appareil', p['appareil'], '· config', p['config_version'], '· segments', [(s['mode'], s['fin']) for s in p['segments']][:3])"
	python3 -c "import json,sys;p=json.load(open('$CACHE'))['planning'];sys.exit(p['appareil']!='pc_linux')" && ok "R.2 planning de l'appareil pc_linux, format accepté par le client" || echec "R.2 appareil du planning"
	sleep 6
	if journal | grep -q "accusé refusé\|événements refusés\|autre appareil"; then echec "R.3 accusés ou événements refusés par la vraie API" "$(journal | grep 'refusé\|autre appareil' | head -2)"; else ok "R.3 aucun accusé ni événement refusé par la vraie API"; fi
	local mode
	mode=$(journal | sed -n 's/.*segment en vigueur" mode=\([A-Z_]*\).*/\1/p' | tail -1)
	info "mode réel en vigueur : ${mode:-?} ; domaines bloqués : $(grep -c '^0.0.0.0' /etc/hosts)"
	F_x11v_reel=$(ouvrir alice x11-verrou)
	echo "$F_x11v_reel" >/run/essai-session-nuit
	resume_court
}
api_locale_nuit() {
	section "R (suite). Horloge de l'API réglée sur la nuit"
	local s
	s=$(cat /run/essai-session-nuit)
	marquer
	systemctl restart focusd # rafraîchissement immédiat
	verifier "R.4 NIGHT_LOCK reçu de la vraie API" 15 journal_contient "mode=NIGHT_LOCK"
	verifier "R.5 session graphique du compte de travail verrouillée" 6 verrouillee "$s"
	sleep 4
	if journal | grep -q "accusé refusé"; then echec "R.6 accusé verrouiller_session refusé"; else ok "R.6 accusé verrouiller_session accepté par la vraie API"; fi
	resume_court
}
api_locale_fin() {
	section "R (fin). Horloge de l'API remise à l'heure réelle"
	marquer
	systemctl restart focusd
	verifier "R.7 planning reçu après remise à l'heure" 15 journal_contient "planning reçu"
	sleep 3 # un tour d'application : le premier, depuis le cache, rejoue encore la nuit
	local mode
	mode=$(journal | sed -n 's/.*segment en vigueur" mode=\([A-Z_]*\).*/\1/p' | tail -1)
	[[ -n "$mode" && "$mode" != NIGHT_LOCK ]] && ok "R.8 mode réel de nouveau en vigueur ($mode)" || echec "R.8 mode après remise à l'heure : ${mode:-?}"
	resume_court
}
resume_court() {
	printf '\n%s OK, %s ÉCHEC\n' "$NB_OK" "$NB_ECHEC"
	[[ $NB_ECHEC -eq 0 ]]
}

case "${1:-}" in
principal) principal ;;
api-locale) api_locale "$2" "$3" ;;
api-locale-nuit) api_locale_nuit ;;
api-locale-fin) api_locale_fin ;;
*) echo "usage : $0 principal | api-locale <url> <jeton> | api-locale-nuit | api-locale-fin" >&2; exit 2 ;;
esac
