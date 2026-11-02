# Mise en ligne — deux hôtes et Cloudflare Access

Focus tourne dans **un seul Worker** (API + web app) sur le domaine `fredericguiose.com`, géré
par Cloudflare sur le même compte que wrangler. Deux noms d'hôte :

| Hôte | Pour qui | Protection |
|---|---|---|
| `focus.fredericguiose.com` | la web app et les appels qu'elle fait (sans jeton : identité = e-mail vérifié par Access) | **Cloudflare Access** (connexion de l'utilisateur seul), vérifié aussi par le Worker |
| `api-focus.fredericguiose.com` | les clients : PC (Go), extension, raccourcis iPhone, GitHub Action d'envoi de la config | jetons `appareil` et `config`, sans Access |

L'adresse `*.workers.dev` et les URL de prévisualisation sont désactivées (`workers_dev: false`,
`preview_urls: false`) : elles permettraient de contourner Access.

## Ce que vérifie le Worker (défense en profondeur)

Access filtre devant le Worker, mais le Worker ne lui fait pas une confiance aveugle
(`api/src/acces.ts`) :

- **Hôte web** : toute requête, fichiers statiques compris (`run_worker_first: true`), doit porter
  un JWT Access valide — en-tête `Cf-Access-Jwt-Assertion`, ou cookie `CF_Authorization` en
  repli. Vérifiés : signature RS256 avec les clés publiques de
  `<ACCES_EQUIPE>/cdn-cgi/access/certs` (gardées 1 h, relues si le `kid` est inconnu, au plus une
  fois par minute), `aud` = `ACCES_AUD`, `iss` = `ACCES_EQUIPE`, `exp`/`nbf` (tolérance 60 s),
  e-mail autorisé (voir ci-dessous). Refus : **403** `acces_refuse` ; certificats injoignables :
  **503** `acces_indisponible`.
- **Identité sur l'hôte web = e-mail Access** (depuis le 01/11) : le secret `ACCES_UTILISATEURS`
  (`email=utilisateur`, séparés par des virgules, ex. `alice@example.com=alice`) donne
  l'utilisateur Focus de l'e-mail vérifié. Un e-mail autorisé sans correspondance : **403**
  `utilisateur_inconnu`, partout. Sur `/v1/*`, une requête **sans** en-tête `Authorization` vaut
  jeton `interface` de cet utilisateur (mêmes droits qu'avant : statut, exceptions, sessions,
  tâches, blocage, version de config). La web app n'a donc plus de jeton en ligne.
  Un `Bearer` envoyé quand même est vérifié comme avant **et** doit appartenir au même
  utilisateur, sinon **403** `jeton_non_autorise` ; invalide, **401**. Un Bearer ne change donc
  jamais l'identité : il peut seulement donner les droits de son propre type (un jeton `appareil`
  du même utilisateur sur `/v1/planning`, par exemple). Les routes sans `interface` (planning,
  accusés, événements, `POST /v1/config`) exigent toujours leur jeton.
  Pas de « dernier ping » pour cette interface sans jeton : aucune ligne dans `appareils`, aucun
  `vu_le` écrit (le statut n'affiche de toute façon que celui des jetons `appareil`).
  `ACCES_EMAILS`, s'il est posé, restreint encore la liste (un e-mail doit être dans les deux) ;
  absent, les e-mails d'`ACCES_UTILISATEURS` sont les e-mails autorisés.
- **Hôte API** : seulement `/v1/*` (sinon **404**). Les routes réservées au jeton `interface`
  (`GET /v1/statut`, `POST /v1/actualiser`, `POST /v1/exceptions/prix`, `POST /v1/exceptions`,
  `POST /v1/dev/horloge`)
  y répondent **404** (elles n'existent pas sur cet hôte). Le jeton `interface` y est refusé
  partout (**403** `jeton_non_autorise`) : sans cela, un jeton d'interface volé ouvrirait des
  sessions sans passer par Access.
- **Pages publiques** (02/11, écran de consentement Google) : `GET`/`HEAD` sur exactement
  `/confidentialite` et `/conditions` de l'hôte web passent **sans JWT** (`estPagePublique`) ;
  pages HTML statiques sans aucune donnée d'utilisateur (`api/src/pages-publiques.ts`), adresse de
  contact lue dans `CONTACT_EMAIL` (secret, jamais dans le dépôt ; absente : pas de ligne de
  contact). Rien d'autre n'est exempté : barre finale, sous-chemin, autre méthode → JWT exigé.
  Sur l'hôte API : **404**. Access doit aussi les laisser passer (étape 8).
- **Tout autre hôte** (workers.dev, IP…) : **403** `hote_inconnu`.
- **Fail closed** : en production, si `ACCES_EQUIPE`, `ACCES_AUD` ou `ACCES_UTILISATEURS` manque
  (ou vaut encore `A-REMPLIR`, ou une entrée d'`ACCES_UTILISATEURS` est mal formée), l'hôte web refuse tout (**403** `acces_non_configure`) et les journaux
  du Worker disent quelle variable manque. Sans `HOTE_WEB` ou `HOTE_API`, tout est refusé.
- **En local** (`FOCUS_ENVIRONNEMENT=local`, posé par `npm run local`) : rien de tout cela, un
  seul hôte `127.0.0.1:8799` sert tout. Sans `Authorization`, `/v1/*` vaut interface de
  `FOCUS_UTILISATEUR_LOCAL` (posée par `npm run local`) ; sans cette variable, jeton exigé
  (docs/essai-local.md).

Routes par hôte (jeton accepté) :

Sur l'hôte web, « interface » = sans en-tête `Authorization` (identité Access) ou jeton
`interface` du même utilisateur ; tout jeton d'un autre utilisateur est refusé.

| Route | Hôte web (Access) | Hôte API (jeton seul) |
|---|---|---|
| `GET /v1/planning`, `POST /v1/accuses`, `POST /v1/evenements` | appareil | appareil |
| `GET /v1/taches`, `GET /v1/blocage`, `POST /v1/sessions`, `POST /v1/sessions/:id/apps`, `…/reponse`, `…/fermer` | interface, appareil | appareil |
| `POST /v1/config` | config | config |
| `GET /v1/config/version` | tous | appareil, config |
| `GET /v1/statut`, `POST /v1/actualiser`, `POST /v1/exceptions/prix`, `POST /v1/exceptions` | interface | — (404) |
| web app (fichiers statiques) | oui | — (404) |
| `GET /confidentialite`, `GET /conditions` | public, sans JWT | — (404) |

## Mise en service, pas à pas

Rien de ceci n'est fait tant que tu ne le fais pas. Ordre conseillé : Access d'abord, déploiement
ensuite, pour que la web app ne soit jamais en ligne sans protection (le Worker la fermerait de
toute façon, voir « fail closed »).

### 1. Activer Zero Trust (offre gratuite)

1. Tableau de bord Cloudflare → **Zero Trust**.
2. Choisir un **nom d'équipe** (team name) : il donne le domaine d'équipe
   `https://<équipe>.cloudflareaccess.com`. Le nom se retrouve ensuite dans **Zero Trust →
   Settings**.
3. Choisir l'offre **Zero Trust Free** (jusqu'à 50 utilisateurs). **Un moyen de paiement est
   demandé même pour l'offre gratuite**, sans débit (doc Cloudflare « Get started », vérifiée le
   01/11/2026).

### 2. Méthode de connexion

**Par défaut : code à usage unique par e-mail (« One-time PIN »).** Pas de compte tiers : Access
envoie un code à l'adresse saisie, valable 10 minutes ; seules les adresses autorisées par la
politique (étape 3) peuvent entrer. Il n'est **pas** activé d'office :

- **Zero Trust → Integrations → Identity providers → Add new identity provider → One-time PIN**.

**Alternative : Google.** Connexion en un clic avec le compte Google, mais il faut créer un client
OAuth dans Google Cloud (identifiant et secret à coller dans Cloudflare ; adresse de retour
`https://<équipe>.cloudflareaccess.com/cdn-cgi/access/callback`) : **Identity providers → Add new
identity provider → Google**. Choix pas encore tranché ; le code e-mail suffit pour commencer et
Google peut s'ajouter plus tard sans toucher au Worker (seul l'e-mail du jeton compte).

### 3. Créer l'application Access de la web app

1. **Zero Trust → Access controls → Applications → Create new application → Self-hosted and
   private**.
2. Nom : `Focus`. **Add public hostname** : sous-domaine `focus`, domaine `fredericguiose.com`,
   **sans chemin** (toute l'adresse, fichiers statiques compris). Ne **pas** ajouter
   `api-focus` : les clients n'ont pas de navigateur pour se connecter.
3. **Policy** : action **Allow**, règle **Include → Emails →** ton adresse, **une seule**.
   (Access refuse par défaut tout ce qui n'est autorisé par aucune politique.)
4. **Login methods** : One-time PIN (et Google si ajouté). Avec une seule méthode, **Apply
   instant authentication** saute la page de choix.
5. **Session Duration** : durée avant de devoir se reconnecter. Proposition : **1 semaine**
   (appareils personnels ; plus court = plus de codes à saisir). À trancher.
6. **Create**.
7. Rouvrir l'application → **Configure → Additional settings** : copier l'**Application Audience
   (AUD) Tag**. Il ne change pas tant que l'application n'est pas supprimée.

### 4. Variables du Worker

Dans `api/wrangler.jsonc`, `vars` (non secrets ; le tag AUD figure de toute façon dans chaque
JWT) :

```jsonc
"HOTE_WEB": "focus.fredericguiose.com",
"HOTE_API": "api-focus.fredericguiose.com",
"ACCES_EQUIPE": "https://<équipe>.cloudflareaccess.com",   // remplacer A-REMPLIR
"ACCES_AUD": "<tag AUD de l'étape 3>"                       // remplacer A-REMPLIR
```

L'e-mail autorisé n'est **pas** écrit dans le dépôt (public) : la correspondance e-mail →
utilisateur est un secret du Worker, à passer par l'entrée standard pour qu'elle n'apparaisse
nulle part :

```sh
cd api
printf '%s' 'alice@example.com=alice' | npx wrangler secret put ACCES_UTILISATEURS
```

Format : `email=utilisateur`, plusieurs séparés par des virgules ; `utilisateur` = champ
`utilisateur` de la config. Mettre la **même** adresse que dans la politique Access : le Worker
refuse un JWT dont l'e-mail n'est pas dans cette liste, même si Access l'a laissé passer.
`ACCES_EMAILS` (première mise en ligne, liste d'e-mails seule) reste lu s'il est posé : il
restreint alors encore la liste. Il peut rester ou être supprimé
(`npx wrangler secret delete ACCES_EMAILS`) ; ACCES_UTILISATEURS suffit.

### 5. Domaines personnalisés et déploiement

`api/wrangler.jsonc` déclare déjà les deux hôtes en domaines personnalisés
(`"custom_domain": true`) et `workers_dev: false`. Cloudflare crée les enregistrements DNS au
déploiement ; **aucun CNAME ne doit déjà exister** sur `focus` ni `api-focus`
(**DNS → Records** de `fredericguiose.com`, sinon le supprimer d'abord).

```sh
cd web && npm run build          # la web app servie par le Worker
cd ../api && npx wrangler deploy
```

(La base D1 distante, ses migrations et les autres secrets — Todoist, Xiaomi, Hevy,
`CLE_CHIFFREMENT` — sont à poser comme indiqué dans `api/wrangler.jsonc` et docs/conception.md.)

### 6. Vérifier

Dans un navigateur privé :

1. `https://focus.fredericguiose.com` → page de connexion Access ; code reçu par e-mail ; la web
   app s'ouvre directement sur le statut, sans écran de jeton.
2. Sans connexion : `curl -s -o /dev/null -w '%{http_code}\n' https://focus.fredericguiose.com/`
   → `302` vers `<équipe>.cloudflareaccess.com` (Access, devant le Worker).
3. Hôte API : `curl -s -o /dev/null -w '%{http_code}\n' https://api-focus.fredericguiose.com/v1/config/version`
   → `401` (jeton absent : l'API répond, sans Access). `…/v1/statut` → `404` ; `…/` → `404`.
4. **workers.dev ne répond plus** : `https://focus-api.<sous-domaine>.workers.dev/` ne doit plus
   rien servir (erreur Cloudflare, pas la web app). **Workers & Pages → focus-api → Settings →
   Domains & Routes** : `workers.dev` et les URL de prévisualisation doivent être désactivés,
   seuls les deux domaines personnalisés listés. Si le tableau de bord les réactive à la main, le
   prochain `wrangler deploy` les coupe de nouveau, et le Worker refuse de toute façon cet hôte
   (`hote_inconnu`).
5. Journaux du Worker (**Observability**) : aucune ligne `Access : variable(s) manquante(s)`.

### 7. Clients

- **PC** : `"api": "https://api-focus.fredericguiose.com"` dans `client.json`
  (clients/pc/README.md).
- **Extension** : même adresse, avec un jeton **`appareil`** au nom du PC (le jeton `interface`
  est refusé sur cet hôte, extension/README.md).
- **GitHub Action** du dépôt de config : secret `FOCUS_API_URL` =
  `https://api-focus.fredericguiose.com`.
- **Web app** : rien à régler, elle appelle l'API en relatif (même origine, cookie
  `CF_Authorization` joint), sans jeton. Au démarrage, elle lit `/v1/statut` sans jeton : seul un
  **401** `jeton_absent` (local lancé sans `FOCUS_UTILISATEUR_LOCAL`) ramène à l'écran de jeton ;
  le jeton éventuellement gardé (`focus.jeton`) est effacé sinon. Mode simulé inchangé.

### 8. Pages publiques : application Access « Bypass »

Access filtre **devant** le Worker : sans règle, il redirige `/confidentialite` et `/conditions`
vers sa page de connexion, et Google (écran de consentement) ne peut pas les lire. Il faut une
**seconde application Access**, limitée à ces deux chemins, qui les laisse passer. Le chemin le
plus précis l'emporte sur l'application `Focus` (doc Cloudflare « Application paths » : « the
more specific rule takes precedence »).

1. **Zero Trust → Access controls → Applications → Create new application → Self-hosted and
   private** (ancien libellé : *Access → Applications → Add an application → Self-hosted*).
2. Nom : `Focus — pages publiques`.
3. **Add public hostname** : sous-domaine `focus`, domaine `fredericguiose.com`, chemin
   `confidentialite`. Puis **Add public hostname** une seconde fois : même domaine, chemin
   `conditions`. (Aucun autre chemin.)
4. **Policy** : nom `Public`, action **Bypass**, règle **Include → Everyone**.
5. **Create**.

Access couvre aussi les sous-chemins (`/conditions/x`) : le Worker, lui, n'exempte que les
chemins exacts et y exige toujours le JWT (403). Les pages ne contiennent rien de personnel.

Adresse de contact affichée sur les deux pages (facultative, secret pour qu'elle n'apparaisse pas
dans le dépôt public) :

```sh
cd api
printf '%s' '<adresse de contact>' | npx wrangler secret put CONTACT_EMAIL
```

Vérifier, en navigation privée : `curl -s -o /dev/null -w '%{http_code}\n'
https://focus.fredericguiose.com/confidentialite` → `200` (et `…/conditions`) ; `…/` → toujours
`302` vers Access ; `https://api-focus.fredericguiose.com/confidentialite` → `404`.

### 9. Google Agenda : bloc « Dormir » (02/11)

Le Worker écrit un événement « Dormir » par nuit dans l'agenda principal (docs/conception.md
§4.4). Il lui faut un client OAuth Google, puis une connexion depuis la page **Connecteurs** de
la web app (flux OAuth web, étape g). L'ancienne voie (client « Desktop app », script local
`google:autoriser` et secret `GOOGLE_REFRESH_TOKEN`, étapes c à e) reste prise en charge mais
devient **facultative** ; une connexion faite depuis la page prend le pas sur elle.

**a. Projet et API** (console Google Cloud, compte Google de l'agenda) :
1. Créer (ou choisir) un projet `Focus`.
2. **APIs & Services → Library → Google Calendar API → Enable**.

**b. Écran de consentement** (**Google Auth Platform**, ancien « OAuth consent screen ») :
1. **Branding** : nom `Focus`, adresse d'assistance ; **Privacy policy** :
   `https://focus.fredericguiose.com/confidentialite` ; **Terms of service** :
   `https://focus.fredericguiose.com/conditions` ; **Authorized domains** : `fredericguiose.com`
   (pages publiques de l'étape 8 en ligne d'abord).
2. **Audience** : type **External**. **Publishing status : passer en « In production »**
   (bouton **Publish app**). En mode Test, le refresh token **expire au bout de 7 jours** : doc
   Google « Using OAuth 2.0 to Access Google APIs », section *Refresh token expiration* : « A
   Google Cloud Platform project with an OAuth consent screen configured for an external user type
   and a publishing status of "Testing" is issued a refresh token expiring in 7 days, unless the
   only OAuth scopes requested are a subset of name, email address, and user profile » (vérifié le
   02/11/2026). Autres causes de perte du jeton (même page) : accès révoqué, jeton inutilisé
   pendant 6 mois.
3. **Data access** : ajouter la seule portée `https://www.googleapis.com/auth/calendar.events`.
4. Pas de demande de vérification : pour un usage personnel, l'avertissement **« Google n'a pas
   validé cette application »** est acceptable (**Paramètres avancés → Accéder à Focus (non
   sécurisé)** à l'autorisation).

**c. Client OAuth** : **Clients → Create client → Desktop app** (type « installed »), nom
`Focus PC`. Télécharger le JSON et l'enregistrer en `~/.config/focus/prod/google-client.json`
(mode 600). Le script utilise l'adresse de retour « loopback » `http://127.0.0.1:<port libre>`,
méthode recommandée par Google pour les applications de bureau (doc « OAuth 2.0 for iOS &
Desktop Apps », *Loopback IP address* ; le port n'a pas à être déclaré), avec PKCE S256.

**d. Autorisation, une fois** (sur le PC, avec le navigateur) :

```sh
cd api
npm run google:autoriser   # ouvre Google ; « Autorisation enregistrée » → ~/.config/focus/prod/google-refresh-token (600)
```

Rien de secret n'est affiché. Relancer le script remplace le jeton (après une révocation par
exemple, puis reposer `GOOGLE_REFRESH_TOKEN`).

**e. Secrets du Worker** (valeurs lues dans les fichiers, jamais affichées) :

```sh
cd api
node -e 'process.stdout.write(require(process.env.HOME + "/.config/focus/prod/google-client.json").installed.client_id)' | npx wrangler secret put GOOGLE_CLIENT_ID
node -e 'process.stdout.write(require(process.env.HOME + "/.config/focus/prod/google-client.json").installed.client_secret)' | npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN < ~/.config/focus/prod/google-refresh-token
printf '%s' '<utilisateur de la config>' | npx wrangler secret put GOOGLE_UTILISATEUR
```

`CLE_CHIFFREMENT` (déjà posé pour Xiaomi) sert aussi à garder chiffré un refresh token que Google
renverrait. Sans l'un des quatre secrets `GOOGLE_*`, la synchro de l'agenda est simplement
désactivée. Pas de migration D1 (cache et verrous existants).

**f. Déployer** (`cd web && npm run build && cd ../api && npx wrangler deploy`), puis vérifier :
au plus 15 min après (ou à la minute suivante après une exception), l'événement « Dormir » de ce
soir et de demain apparaît dans Google Agenda ; `/v1/statut` → `agenda.erreur` à `null`.
Journaux du Worker : lignes `Google Agenda (…)` en cas d'échec (code seul, jamais de jeton).
Révocation : <https://myaccount.google.com/permissions> → la web app affiche « La connexion à
Google Agenda a expiré » dans la carte Sommeil.

**g. Connexion depuis la page Connecteurs** (flux OAuth web, recommandé) :
1. Console Google Cloud, même projet : **Clients → Create client → Web application**, nom
   `Focus web`. **Authorized redirect URIs**, exactement :
   `https://focus.fredericguiose.com/v1/connecteurs/google/retour` (et, pour un essai local,
   `http://127.0.0.1:8799/v1/connecteurs/google/retour`). Pas d'origine JavaScript à déclarer.
2. Secrets du Worker (valeurs collées à l'invite, jamais dans l'historique du shell) :
   ```sh
   cd api
   npx wrangler secret put GOOGLE_WEB_CLIENT_ID
   npx wrangler secret put GOOGLE_WEB_CLIENT_SECRET
   ```
   Absents : repli sur `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (un client « Desktop app »
   n'accepte pas cette adresse de retour : le client web est nécessaire en pratique).
   `CLE_CHIFFREMENT` est obligatoire (le refresh token est gardé chiffré en base).
3. Déployer, puis web app → **Connecteurs → Google Agenda → Connecter** : Google, consentement
   (cocher l'accès à l'agenda), retour sur la page avec « Google Agenda connecté ». Le bloc
   « Dormir » est réécrit au passage suivant de la tâche planifiée.
4. Ensuite, `GOOGLE_REFRESH_TOKEN` et `GOOGLE_UTILISATEUR` peuvent être supprimés
   (`npx wrangler secret delete …`) ; tant qu'ils restent, ils ne servent que si la page n'a pas
   de connexion. **Déconnecter** révoque l'accès chez Google et efface le jeton ; avec le même
   client OAuth, la révocation peut aussi invalider le jeton du secret. Les événements déjà
   écrits restent dans l'agenda.

## Limites connues

- **Session Access expirée** pendant que la web app est ouverte : ses appels à `/v1/*` sont
  redirigés par Access vers la page de connexion, ce que `fetch` ne suit pas ; la web app affiche
  « API injoignable ». Recharger la page relance la connexion.
- **PWA** : le manifeste est demandé avec le cookie (`crossorigin="use-credentials"` dans
  `web/index.html`), sinon Access le bloquerait et l'installation échouerait. Non essayé sur
  iPhone.
- **Extension avec un jeton `appareil` au nom du PC** : le « dernier ping » de l'appareil
  (`MAX(vu_le)` de ses jetons) compte aussi les appels de l'extension ; elle n'appelle l'API que
  sur un site bloqué, donc quand `focusd` a posé ses blocages.
