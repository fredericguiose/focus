# Essai d'ensemble en local

## `npm run local` fait tout

Depuis la racine du dépôt (Node ≥ 22) :

```sh
npm run local                    # prépare tout et lance l'API + la web app sur http://127.0.0.1:8799
npm run local -- --exemple       # force config/exemple.yaml au lieu de ../focus-config/focus.yaml
npm run local:heure -- 18:00     # horloge locale : HH:MM (fuseau de la journée), +3h, -90min, reel
npm run local:reset              # efface la base locale et les jetons locaux (Focus arrêté)
```

La commande est idempotente : relancée, elle ne refait que ce qui manque ou a changé.

1. `npm ci` dans `core`, `api`, `web` si `node_modules` manque ; construit `web/dist` si les
   sources sont plus récentes.
2. Applique les migrations dans la base locale dédiée `api/.wrangler/local`.
3. Crée, s'ils n'existent pas, un jeton `interface` et un jeton `config` pour l'utilisateur de la
   config chargée, gardés dans `~/.config/focus/local/` (dossier 700, fichiers 600), et inscrit
   leur empreinte dans la base locale.
4. Config : `../focus-config/focus.yaml` s'il existe, sinon `config/exemple.yaml` ; renvoyée à
   l'API seulement si le fichier a changé (empreinte gardée dans `~/.config/focus/local/`).
5. Si `~/.config/focus/secrets.env` contient `TODOIST_TOKEN` et/ou les lignes `XIAOMI_*`
   remplies (`XIAOMI_USER_ID`, `XIAOMI_PASS_TOKEN`, `XIAOMI_REGION`) et que git ignore
   `api/.dev.vars`, recopie ces lignes dans ce fichier en 600, sans les afficher (lecture
   Todoist et sommeil Xiaomi réels) ; sinon lance sans eux. Pour Xiaomi, ajoute
   `XIAOMI_UTILISATEUR` (celui de `secrets.env`, sinon l'utilisateur de la config privée : seul
   synchronisé) et `CLE_CHIFFREMENT` (clé aléatoire créée une fois dans
   `~/.config/focus/local/cle-chiffrement`, 600) ; `XIAOMI_DEPUIS` est recopié s'il est posé.
   `HEVY_API_KEY` (séances Hevy) est recopié de même, avec `HEVY_UTILISATEUR` (même règle que
   `XIAOMI_UTILISATEUR`).
6. Lance `wrangler dev --local` sur le port 8799 avec `FOCUS_ENVIRONNEMENT=local` (horloge
   réglable), puis déclenche une première tâche planifiée. À côté, `vite build --watch`
   reconstruit `web/dist` à chaque modification du code de la web app (ou de `core/src`) :
   recharger la page suffit, sans relancer l'instance (« Web app reconstruite » dans le terminal).
7. Copie le jeton `interface` dans le presse-papiers (`wl-copy`, sinon l'affiche) et ouvre le
   navigateur. `--discret` : ni presse-papiers, ni navigateur.
8. Ctrl-C arrête wrangler et la reconstruction automatique, et efface `api/.dev.vars`.

La suite détaille les mêmes étapes à la main (base `api/.wrangler/essai`, à part), plus le
client PC et les sessions de bout en bout.

## À la main

Fait tourner l'API (Worker + D1 en local), la web app, le client PC et, si on le veut, la vraie
lecture Todoist, sans aucune ressource Cloudflare distante ni effet sur la machine : le client
écrit dans un fichier hosts de test et ne verrouille rien.

Pré-requis : Node ≥ 22, Go, `curl`. Les étapes 2 à 4 se font dans `api/`, les suivantes depuis
la racine du dépôt, dans un second terminal. `ESSAI` désigne un dossier de travail jetable, hors
du dépôt (à exporter dans les deux terminaux) :

```sh
export ESSAI=$(mktemp -d) && chmod 700 "$ESSAI"
```

## 1. Construire

```sh
for d in core api web; do (cd $d && npm ci); done
(cd web && npm run build)          # → web/dist, servi par le Worker
```

## 2. Base locale et API

Une base à part (`--persist-to`) pour ne pas mélanger avec d'autres essais :

```sh
cd api
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/essai
```

## 3. Jetons (base locale seulement)

```sh
for spec in "interface web" "appareil pc_linux" "config github"; do
  set -- $spec
  npm run -s jeton:creer -- $1 $2 --sortie "$ESSAI/$1.sql" | grep -o 'focus_[A-Za-z0-9_-]*' > "$ESSAI/$1.jeton"
  npx wrangler d1 execute DB --local --persist-to .wrangler/essai --file "$ESSAI/$1.sql"
done
chmod 600 "$ESSAI"/*.jeton
```

## 4. Lancer l'API

Facultatif, pour lire le vrai Todoist (lecture seule, GET uniquement) : le jeton va dans
`api/.dev.vars`, ignoré par git. Le vérifier, puis le créer en 600 sans l'afficher :

```sh
git check-ignore .dev.vars         # doit répondre « .dev.vars »
(umask 077; grep '^TODOIST_TOKEN=' ~/.config/focus/secrets.env > .dev.vars)
```

Même chose pour le sommeil mesuré (montre Xiaomi) : ajouter les lignes `XIAOMI_*` à
`.dev.vars` (`(umask 077; grep '^XIAOMI_' ~/.config/focus/secrets.env >> .dev.vars)`), plus
`XIAOMI_UTILISATEUR=<utilisateur de la config>` s'il n'y est pas (sans lui, pas de synchro) et,
pour garder le passToken tournant, `CLE_CHIFFREMENT=<clé aléatoire>`.

Sans `.dev.vars`, la tâche planifiée saute Todoist et le sommeil, et l'API travaille sur le cache
de la base.

```sh
npx wrangler dev --local --persist-to .wrangler/essai --port 8799 --show-interactive-dev-session=false
```

Contrôles (autre terminal) :

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8799/            # 200 : web app
curl -s http://127.0.0.1:8799/v1/statut                                      # 401 jeton_absent
```

## 5. Envoyer la config d'exemple

Depuis la racine, second terminal :

```sh
node -e 'const fs=require("fs");process.stdout.write(JSON.stringify({yaml:fs.readFileSync("config/exemple.yaml","utf8"),commit:"essai-local"}))' > "$ESSAI/config.json"
curl -s -X POST http://127.0.0.1:8799/v1/config \
  -H "Authorization: Bearer $(cat "$ESSAI/config.jeton")" -H 'Content-Type: application/json' --data @"$ESSAI/config.json"
```

L'exemple est à l'heure de Paris : la nuit, tout est en NIGHT_LOCK et les sessions sont
interdites. Pour essayer les sessions à toute heure, envoyer une variante dont le fuseau tombe
en journée, par exemple `sed 's#fuseau: Europe/Paris#fuseau: Pacific/Honolulu#' config/exemple.yaml`.

## 6. Tâche planifiée

Wrangler ne lance pas le cron tout seul en local, et la route `/__scheduled` est captée par les
fichiers statiques (repli SPA). Passer par l'explorateur local de wrangler :

```sh
curl -s -X POST 'http://127.0.0.1:8799/cdn-cgi/local/explorer/api/local/scheduled?worker=focus-api' \
  -H 'Content-Type: application/json' -d '{"cron":"* * * * *"}'
```

Le résultat (`outcome: ok`) et les avertissements (étiquettes absentes…) s'affichent dans le
terminal de wrangler. Pour vérifier ce qui a été lu sans afficher de contenu :

```sh
(cd api && npx wrangler d1 execute DB --local --persist-to .wrangler/essai --command \
  "SELECT cle, json_type(valeur) t, CASE json_type(valeur) WHEN 'array' THEN json_array_length(valeur) END n, maj_le FROM cache_todoist")
```

Sommeil Xiaomi (une lecture par heure au plus ; pour relire tout de suite, effacer
`synchro_xiaomi` du cache avant de déclencher la tâche) : comptes et état, sans contenu :

```sh
(cd api && npx wrangler d1 execute DB --local --persist-to .wrangler/essai --command \
  "SELECT COUNT(*) n, MIN(debut) premier, MAX(fin) dernier FROM mesures WHERE type = 'sommeil' AND source = 'xiaomi'")
(cd api && npx wrangler d1 execute DB --local --persist-to .wrangler/essai --command \
  "SELECT json_extract(valeur, '$.erreur') erreur, json_extract(valeur, '$.sessions') n FROM cache_todoist WHERE cle = 'synchro_xiaomi'")
```

`erreur = jeton_xiaomi_expire` : passToken à renouveler dans `secrets.env`.

**Faux Todoist** (sans `.dev.vars`) : écrire directement le cache, puis `GET /v1/taches`.

```sh
(cd api && npx wrangler d1 execute DB --local --persist-to .wrangler/essai --command "
INSERT OR REPLACE INTO cache_todoist (utilisateur, cle, valeur, maj_le) VALUES
 ('alice','taches','[{\"id\":\"fictive-1\",\"contenu\":\"Tâche fictive\",\"priorite\":\"p1\",\"etiquettes\":[],\"echeance\":\"$(date +%F)\",\"deadline\":null,\"terminee\":false,\"termineeLe\":null,\"creeeLe\":\"2026-01-01T00:00:00Z\",\"assigneeAMoi\":true}]','2026-01-01T00:00:00Z'),
 ('alice','reports','[]','2026-01-01T00:00:00Z')")
```

(L'échéance doit être la date du jour dans le fuseau de la routine.)

## 7. Client PC

```sh
(cd clients/pc && go build -o "$ESSAI/focusd" ./cmd/focusd)
cp "$ESSAI/appareil.jeton" "$ESSAI/jeton-pc" && chmod 600 "$ESSAI/jeton-pc"
printf '127.0.0.1 localhost\n' > "$ESSAI/hosts"
mkdir -p "$ESSAI/etat"
cat > "$ESSAI/client.json" <<EOF
{"api":"http://127.0.0.1:8799","jeton_fichier":"$ESSAI/jeton-pc","appareil":"pc_linux",
 "etat_dossier":"$ESSAI/etat","ecoute_locale":"127.0.0.1:47699"}
EOF
"$ESSAI/focusd" --config "$ESSAI/client.json" --sans-effet --hosts-fichier "$ESSAI/hosts" --rafraichir 5s
```

Attendu dans le journal : `planning reçu`, `segment en vigueur` (une fois par segment, pas à
chaque rafraîchissement), `fichier hosts mis à jour`. Le bloc `# >>> focus … # <<< focus` de
`$ESSAI/hosts` liste les domaines du segment. Le vrai `/etc/hosts` n'est pas touché.

`--sans-effet` n'envoie pas d'accusés. Pour vérifier leur format côté API :

```sh
curl -s -X POST http://127.0.0.1:8799/v1/accuses -H "Authorization: Bearer $(cat "$ESSAI/appareil.jeton")" \
  -H 'Content-Type: application/json' -d '{"action":"bloquer_domaines","pose_le":"2026-10-31T23:05:35.923456789-03:00"}'
```

Le dernier ping de `pc_linux` apparaît dans `GET /v1/statut` (précision 5 min).

## 8. Session de bout en bout

```sh
I=$(cat "$ESSAI/interface.jeton"); API=http://127.0.0.1:8799
curl -s $API/v1/taches -H "Authorization: Bearer $I"
curl -s -X POST $API/v1/sessions -H "Authorization: Bearer $I" -H 'Content-Type: application/json' \
  -d '{"appareil":"pc_linux","tache_id":"fictive-1","apps":["chatgpt"]}'
```

Au rafraîchissement suivant, `chatgpt.com` et `chat.openai.com` sortent de `$ESSAI/hosts`.
Réponses : `POST /v1/sessions/<id>/reponse` avec `{"question_id": "...", "reponse": "continue" | "arrete"}`.
Avant `posee_a`, « continue » → 409 `question_pas_encore_posee` ; pendant l'attente → 409
`continue_trop_tot` ; « arrete » ferme la session et les domaines reviennent dans le fichier
hosts. Pour ne pas attendre 25 min, avancer la question dans la base locale :

```sh
(cd api && npx wrangler d1 execute DB --local --persist-to .wrangler/essai --command \
  "UPDATE questions SET posee_a = strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 seconds'), expire_a = strftime('%Y-%m-%dT%H:%M:%SZ','now','+59 seconds') WHERE id = '<question_id>'")
```

## 9. Web app

Ouvrir `http://127.0.0.1:8799/`, coller le jeton `interface`. L'écran Statut doit afficher la
version de config envoyée (pas le mode simulé, qui n'existe qu'avec `npm run dev:simule`).
L'onglet Sessions liste les apps de `apps_bloquees` sans appeler `/v1/blocage`.

## 10. Changer l'heure (journée, soirée, nuit)

Avec `npm run local` : `npm run local:heure -- 18:00` (ou `+3h`, `-90min`, `reel`).

L'API a une horloge réglable, **en local seulement** : elle n'est prise en compte que si
`FOCUS_ENVIRONNEMENT=local`. Avec toute autre valeur (ou sans la variable), l'horloge est la vraie,
`FOCUS_HORLOGE` est ignorée avec un avertissement dans le journal, et `POST /v1/dev/horloge`
répond 404. Rien n'est écrit dans la base : le réglage vit dans la mémoire du Worker local.

Au lancement (étape 4), ajouter les variables :

```sh
npx wrangler dev --local --persist-to .wrangler/essai --port 8799 --show-interactive-dev-session=false \
  --var FOCUS_ENVIRONNEMENT:local --var FOCUS_HORLOGE:+3h
```

`FOCUS_HORLOGE` accepte un décalage (`+3h`, `-90min`, `+1h30`) appliqué à l'heure réelle, ou un
instant ISO 8601 (`2026-11-03T21:49:00Z`) : l'heure est alors **figée** (les questions de session
n'arrivent jamais ; préférer un décalage pour elles).

À chaud, sans relancer :

```sh
I=$(cat "$ESSAI/interface.jeton"); API=http://127.0.0.1:8799
curl -s -X POST $API/v1/dev/horloge -H "Authorization: Bearer $I" -H 'Content-Type: application/json' -d '{"horloge":"+5h"}'
curl -s -X POST $API/v1/dev/horloge -H "Authorization: Bearer $I" -H 'Content-Type: application/json' -d '{"horloge":null}'  # heure réelle
```

Réponse : `{ environnement: "local", reglage, heure_serveur }`. Le réglage à chaud l'emporte sur
`FOCUS_HORLOGE` jusqu'au redémarrage de wrangler. Le client PC et la web app se calent sur
`heure_serveur` : tout suit (segment en vigueur, `phase` et `actions` de `/v1/statut`). Avec
l'exemple (Paris, mardi) : avant 19:30 `journee`, de 19:30 à 21:30 `soiree`, ensuite `nuit`
(« je vais dormir » refusé). La tâche planifiée (étape 6) utilise la même horloge : une photo de
nuit ou de retards prise à une heure simulée reste dans la base locale ; repartir d'une base
propre (étape 11) après l'essai.

Ne jamais poser `FOCUS_ENVIRONNEMENT` en production.

## 11. Ranger

Avec `npm run local` : Ctrl-C, puis `npm run local:reset` pour repartir d'une base propre.

À la main, arrêter wrangler et focusd (Ctrl-C), puis :

```sh
rm -f api/.dev.vars
rm -rf api/.wrangler/essai "$ESSAI"
```
