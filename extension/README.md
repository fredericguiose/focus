# Extension Focus (Chrome, Manifest V3)

Le blocage réseau est fait par le client PC (fichier hosts). L'extension affiche, à la place d'un
site bloqué, une page qui dit quelle app, quel mode, jusqu'à quand, ce qui manque pour en sortir,
et permet d'ouvrir une session si le mode l'autorise.

## Fonctionnement

1. **Planning.** Le service worker lit le planning de l'appareil (`GET /v1/planning`, jeton
   `appareil`) à son démarrage puis toutes les minutes (`chrome.alarms`), et le garde dans
   `chrome.storage.session` avec son heure de réception et le décalage d'horloge
   (`heure_serveur` − horloge locale, comme le client PC).
2. **Décision locale.** Sur `webNavigation.onBeforeNavigate`, `onCommitted` et
   `onHistoryStateUpdated` (cadre principal, http/https, hors prérendu), `src/regles.ts` applique
   la règle du client PC (`clients/pc/internal/planning/regles.go`) : segment en vigueur (début
   inclus, fin exclue), domaines de `bloquer_domaines`, libérés par les sessions valides (question
   non expirée, `fin_au_plus_tard` non atteinte) si le segment autorise les sessions et ne
   verrouille pas l'écran. Correspondance **exacte** du nom d'hôte, comme le fichier hosts
   (`music.youtube.com` n'est bloqué que s'il est listé). L'hôte de l'API n'est jamais bloqué. Si
   le domaine est bloqué, l'onglet passe sur `bloque.html`. Cela marche aussi quand la page vient
   du cache du service worker du site (YouTube) : aucune erreur réseau n'a lieu dans ce cas.
3. **Bascule récente.** Si le domaine n'était pas bloqué à la réception du planning et l'est
   devenu par le seul passage du temps (segment suivant, question expirée), le planning est relu
   (3 s au plus) avant d'afficher : `focusd` a pu recevoir entre-temps un « continue ».
4. **Planning trop vieux** (au-delà de `valable_jusqua`, ou plus de 10 min sans rafraîchissement
   réussi) : il ne décide plus rien, pas de faux blocage. Repli : sur une erreur de navigation qui
   ressemble au blocage hosts (`ERR_CONNECTION_REFUSED`, `ERR_NAME_NOT_RESOLVED`,
   `ERR_ADDRESS_INVALID`, `ERR_CONNECTION_RESET`), l'extension demande
   `GET /v1/blocage?appareil=…&domaine=…`.
5. **Page de blocage.** Logo de l'app depuis le cache d'icônes de Chrome (`_favicon`, aucune
   requête réseau, aucun service tiers ; initiale sinon). Détails par `GET /v1/blocage`, tâches
   par `GET /v1/taches`, session par `POST /v1/sessions` (10 s d'attente). « Réessayer » relit le
   planning tout de suite et rouvre la page si le domaine n'est plus bloqué. Après l'ouverture
   d'une session, le planning est relu aussitôt ; le PC, lui, l'applique dans la minute.
6. **Options.** « Enregistrer et vérifier » enregistre les réglages puis demande au service
   worker de lire le planning avec eux (`chrome.runtime.sendMessage`) : vert seulement s'il l'a
   reçu (mode actuel, nombre de sites bloqués), sinon l'erreur exacte.

## Vie privée

Aucune URL visitée n'est envoyée à l'API pour décider : la décision est locale. Partent vers
l'API : le nom d'hôte d'un site **déjà jugé bloqué**, quand sa page de blocage s'affiche (détails
et session) ; et, en repli sans planning frais, le nom d'hôte d'un site dont la navigation échoue
comme sous le blocage hosts. Jamais de chemin ni de paramètres d'URL.

## Permissions

- `webNavigation` : voir les navigations du cadre principal.
- `storage` : réglages (`chrome.storage.local`) et planning (`chrome.storage.session`).
- `alarms` : rafraîchir le planning chaque minute.
- `favicon` : logo de l'app sur la page de blocage, depuis le cache du navigateur.
- `host_permissions` : `https://api-focus.fredericguiose.com/*`, fixe.
- `optional_host_permissions` : `localhost` et `127.0.0.1` (HTTP ou HTTPS), demandés à
  l'enregistrement des options pour l'essai local. Aucun autre hôte n'est accepté.

## Réglages

Adresse de l'API (`https://api-focus.fredericguiose.com`, sans Cloudflare Access), jeton
`appareil` au nom du PC (`npm run jeton:creer -- appareil pc_linux`, distinct de celui de
`focusd` ; l'hôte de l'API refuse le jeton `interface`), nom de l'appareil tel qu'écrit dans la
config (ex. `pc_linux`). Le jeton doit être celui de cet appareil : `/v1/planning` répond pour
l'appareil du jeton, et l'extension refuse un planning d'un autre appareil.

## Construire et tester

```sh
npm ci
npm run typecheck    # sources + tests
npm test             # node:test sur la règle locale et les libellés (Node ≥ 22.18, types effacés)
npm run build        # tsc vers dist/, puis copie de statique/ (manifest, pages, icônes, police)
```

`@types/node` (même version que `core/`) sert seulement à typer les tests ; pas de lanceur de
tests ajouté, `node --test` suffit.

## Charger en mode développeur

1. `chrome://extensions` → activer **Mode développeur**.
2. **Charger l'extension non empaquetée** → le dossier `extension/dist/` (ou sa copie stable).
3. La page d'options s'ouvre : renseigner les trois champs, « Enregistrer et vérifier ».

Après une modification : `npm run build`, puis le bouton ↻ de l'extension.

Police : Inter (SIL OFL 1.1, `statique/polices/`), la même que la web app.
