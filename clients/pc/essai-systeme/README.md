# Essai système du client PC Linux

Joue en vrai, dans un conteneur podman (Fedora, systemd en PID 1, logind, polkit, Xvfb),
ce que les tests unitaires ne touchent pas : `installer-linux.sh`, l'unité systemd, logind
(lister, verrouiller, terminer des sessions), le vrai `/etc/hosts`, `focus-agent` et zenity.
Sans root sur l'hôte ; rien n'est modifié hors du conteneur.

```sh
./lancer.sh                       # ~5 min, fausse API dans le conteneur
./lancer.sh --sortie DIR          # captures d'écran Xvfb, journal de focusd, requêtes reçues
./lancer.sh --garder              # garde le conteneur pour fouiller (podman exec -it … bash)
./lancer.sh --api-locale --jeton-appareil F [--jeton-interface F]
```

Chaque point affiche `OK`, `ÉCHEC` ou `INFO` (constat sans verdict) ; la dernière ligne est
`RÉSULTAT : OK` ou `ÉCHEC` (code de sortie 0 ou 1).

Prérequis : podman (rootless suffit), Go et les modules du client déjà téléchargés : le
conteneur compile hors ligne avec le Go de l'hôte monté en lecture seule.

## Fichiers

| Fichier | Rôle |
|---|---|
| `Containerfile` | image : systemd, `systemd-pam` (sessions logind réelles), polkit, zenity, Xvfb, xdotool |
| `lancer.sh` | construit l'image, démarre le conteneur, lance les vérifications, rapatrie les sorties |
| `verifier.sh` | les vérifications, dans le conteneur (points 1 à 6, et R avec l'API locale) |
| `fausse-api.py` | API factice pilotée par fichiers : planning, panne, API muette, jeton refusé |
| `fabriquer-planning.py` | planning aux instants relatifs à maintenant (segments de 45 s, etc.) |
| `faux-verrou.sh` | écran de verrouillage simulé : répond au signal `Lock` de logind par `LockedHint` |

## Ce qui est simulé

- **Sessions** : `su -l` sous `script` (session `tty`, classe `user`), `XDG_SESSION_TYPE=x11 su -l`
  (session graphique), `su -l` sans terminal (classe `background`). Ce sont de vraies sessions
  logind créées par `pam_systemd`.
- **Écran de verrouillage** : `faux-verrou.sh` fait ce que fait GNOME Shell (Lock → LockedHint).
  Le « déverrouillage » est simulé par `SetLockedHint false`.
- **pkexec** : une règle polkit autorise `alice` sans mot de passe ; le bac à sable systemd de
  `polkitd` est retiré (il ne démarre pas sinon dans un conteneur sans privilèges).
- **Rafraîchissement** : après les points 1.x, un drop-in passe `--rafraichir 2s` (au lieu de
  60 s) pour enchaîner les modes.
- **/etc/hosts en lecture seule** : montage lié `ro` (d'où `podman exec --privileged`, limité à
  l'espace de noms du conteneur).

## Non testable ici (à vérifier sur le vrai Fedora)

- Verrouillage réel par GNOME Shell (Lock → écran de verrouillage, LockedHint posé par GNOME),
  y compris quand GDM ouvre une session pendant un segment verrouillé.
- Veille, capot fermé, mise en veille prolongée puis réveil pendant un segment.
- Vidage du cache DNS par `resolvectl` (pas de systemd-resolved dans le conteneur) et effet du
  blocage dans Firefox / Chrome (DNS sur HTTPS, cache du navigateur).
- Démarrage automatique de `focus-agent` par `/etc/xdg/autostart` dans une session GNOME
  Wayland, et l'apparence des fenêtres zenity sous Wayland.
- SELinux (`restorecon`, contexte `net_conf_t` de `/etc/hosts`) : désactivé dans le conteneur.
- Ordre de démarrage au boot (`network-online.target`).

## API locale (facultatif)

Avec `--api-locale`, le conteneur partage le réseau de l'hôte (`--network=host`) pour joindre
`npm run local` sur `http://127.0.0.1:8799` ; les ports 18799 et 47600 doivent être libres.
`--jeton-appareil` : un jeton `appareil` pc_linux de l'utilisateur de la config locale
(`npm run jeton:creer -- appareil pc_linux --utilisateur <u> --sortie f.sql`, puis
`npx wrangler d1 execute DB --local --persist-to .wrangler/local --file f.sql` dans `api/`).
`--jeton-interface` (ex. `~/.config/focus/local/interface-<u>.jeton`) : règle l'horloge de
l'API sur coucher + 10 min (NIGHT_LOCK), vérifie le verrou, puis la remet à l'heure réelle
(aussi en cas d'interruption) et vérifie l'écart. Les jetons ne sont jamais affichés ; celui
d'appareil est copié dans le conteneur puis effacé après installation. Attention : les accusés
de l'essai sont enregistrés dans la base locale.
