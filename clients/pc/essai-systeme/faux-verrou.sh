#!/usr/bin/env bash
# Simule l'écran de verrouillage d'une session graphique (ce que fait GNOME Shell) : à chaque
# signal Lock de logind, pose LockedHint=true. Lancé comme commande de la session elle-même
# (XDG_SESSION_TYPE=x11 su -l <compte> -c faux-verrou.sh) ; journal dans /run/faux-verrou/<id>.
set -u
S="${XDG_SESSION_ID:?XDG_SESSION_ID absent : pas dans une session logind}"
OBJ="/org/freedesktop/login1/session/$S"
J="/run/faux-verrou/$S"
echo "$(date +%s.%N) pret" >>"$J"
gdbus monitor --system --dest org.freedesktop.login1 --object-path "$OBJ" | while read -r ligne; do
	case "$ligne" in
	*"org.freedesktop.login1.Session.Lock ()"*)
		busctl call org.freedesktop.login1 "$OBJ" org.freedesktop.login1.Session SetLockedHint b true
		echo "$(date +%s.%N) lock" >>"$J"
		;;
	*"org.freedesktop.login1.Session.Unlock ()"*)
		busctl call org.freedesktop.login1 "$OBJ" org.freedesktop.login1.Session SetLockedHint b false
		echo "$(date +%s.%N) unlock" >>"$J"
		;;
	esac
done
