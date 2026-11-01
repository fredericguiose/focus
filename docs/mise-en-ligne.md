# Mise en ligne — deux hôtes et Cloudflare Access

Focus tourne dans **un seul Worker** (API + web app) sur le domaine `fredericguiose.com`, géré
par Cloudflare sur le même compte que wrangler. Deux noms d'hôte :

| Hôte | Pour qui | Protection |
|---|---|---|
| `focus.fredericguiose.com` | la web app et les appels qu'elle fait (jeton `interface`) | **Cloudflare Access** (connexion de l'utilisateur seul) **+** jeton |
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
  e-mail dans `ACCES_EMAILS`. Refus : **403** `acces_refuse` ; certificats injoignables : **503**
  `acces_indisponible`. Le jeton `interface` reste exigé en plus sur `/v1/*`.
- **Hôte API** : seulement `/v1/*` (sinon **404**). Les routes réservées au jeton `interface`
  (`GET /v1/statut`, `POST /v1/exceptions/prix`, `POST /v1/exceptions`, `POST /v1/dev/horloge`)
  y répondent **404** (elles n'existent pas sur cet hôte). Le jeton `interface` y est refusé
  partout (**403** `jeton_non_autorise`) : sans cela, un jeton d'interface volé ouvrirait des
  sessions sans passer par Access.
- **Tout autre hôte** (workers.dev, IP…) : **403** `hote_inconnu`.
- **Fail closed** : en production, si `ACCES_EQUIPE`, `ACCES_AUD` ou `ACCES_EMAILS` manque (ou
  vaut encore `A-REMPLIR`), l'hôte web refuse tout (**403** `acces_non_configure`) et les journaux
  du Worker disent quelle variable manque. Sans `HOTE_WEB` ou `HOTE_API`, tout est refusé.
- **En local** (`FOCUS_ENVIRONNEMENT=local`, posé par `npm run local`) : rien de tout cela, un
  seul hôte `127.0.0.1:8799` sert tout, comme avant.

Routes par hôte (jeton accepté) :

| Route | Hôte web (Access + jeton) | Hôte API (jeton seul) |
|---|---|---|
| `GET /v1/planning`, `POST /v1/accuses`, `POST /v1/evenements` | appareil | appareil |
| `GET /v1/taches`, `GET /v1/blocage`, `POST /v1/sessions`, `POST /v1/sessions/:id/apps`, `…/reponse`, `…/fermer` | interface, appareil | appareil |
| `POST /v1/config` | config | config |
| `GET /v1/config/version` | tous | appareil, config |
| `GET /v1/statut`, `POST /v1/exceptions/prix`, `POST /v1/exceptions` | interface | — (404) |
| web app (fichiers statiques) | oui | — (404) |

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

L'e-mail autorisé n'est **pas** écrit dans le dépôt (public) : c'est un secret du Worker.

```sh
cd api
npx wrangler secret put ACCES_EMAILS     # coller l'adresse (plusieurs : séparées par des virgules)
```

Exemple de valeur : `alice@example.com`. Mettre la **même** adresse que dans la politique Access :
le Worker refuse un JWT dont l'e-mail n'est pas dans cette liste, même si Access l'a laissé
passer.

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
   app s'ouvre, demande le jeton `interface`.
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
- **Web app** : rien à régler, elle appelle l'API en relatif (même origine).

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
