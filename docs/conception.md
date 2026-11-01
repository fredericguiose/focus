# Conception — Focus v2.0

Document de référence pour le code. Il décrit **quoi** faire ; le pourquoi des décisions est
dans le cahier des charges privé. Les exemples utilisent des horaires fictifs
(`config/exemple.yaml`).

## 1. Vue d'ensemble

```
focus-config (privé) ──push──▶ GitHub Actions ──POST /v1/config──▶ API (Workers + D1)
                                                                     │  ▲
Todoist ◀──── tâche planifiée chaque minute (faits mis en cache) ────┘  │
                                                                        │ GET /v1/planning (chaque minute)
             web app (React) ── /v1/statut, /v1/exceptions, /v1/sessions ┤
             extension (interface) ─────────────────────────────────────┤
             client PC (Go, service + agent) ───────────────────────────┘
```

- **L'API calcule, les clients appliquent.** Aucun client ne calcule de mode.
- Le moteur (`core/`) est du TypeScript pur : aucune entrée/sortie, aucune horloge système
  (l'instant est un paramètre), aucune dépendance à Cloudflare. Il est testé seul.
- Toutes les heures échangées sont des instants **UTC en ISO 8601** (`2026-11-03T09:30:00Z`).
  Le fuseau ne sert qu'à lire les heures locales de la config et à afficher.
- **Une colonne `utilisateur`** dans chaque table ; une seule valeur au départ.

## 2. La configuration

Écrite en YAML 1.2 (paquet `yaml`), heures toujours entre guillemets. Validée par un schéma
(`zod`) : un fichier faux est refusé en entier. Exemple complet : `config/exemple.yaml`.

### 2.1 Durées et heures
- Heure locale : `"HH:MM"` (24 h).
- Durée : `"8h"`, `"30min"`, `"1h30"`. Un nombre seul = minutes (pour `preparation`).
- Expression d'heure relative : `"$coucher"`, `"$lever"`, `"$coucher - 2h"`,
  `"$lever + 30min"`. Seuls `$coucher` et `$lever` existent.

### 2.2 Sommeil
```yaml
sommeil:
  cible: "8h"            # coucher prévu = réveil du lendemain − cible
  minimum: "7h"          # plafond de l'exception « décaler le coucher » avant l'ouverture
  plancher_nuit: "6h"    # plafond de la décision de nuit (après l'ouverture)
  lever_plancher: "04:30" # sans engagement, jamais de lever avant cette heure
```

### 2.3 Engagements
Une raison de se lever. Deux formes :
```yaml
engagements:
  salle: { heure: "05:00", preparation: 30, annulable: true, decalable: true } # réveil 04:30
  cours: { reveil: "06:00", annulable: true, decalable: true }
```
- Réveil d'un engagement = `reveil`, sinon `heure − preparation`.
- Une routine peut surcharger un engagement (`heure: libre` = engagement sans heure : il ne
  donne pas de réveil, il sert seulement au suivi).

### 2.4 Catalogue, groupes, appareils
```yaml
apps:
  youtube: { nom: YouTube, domaines: [youtube.com, www.youtube.com, m.youtube.com], iphone: com.google.ios.youtube }
groupes:
  divertissement: [youtube, x]
appareils:
  pc_linux:   { type: pc_linux,   comptes_de_travail: [alice] }
  pc_windows: { type: pc_windows, comptes_de_travail: [] }
  iphone:     { type: iphone }
```
- Une app a des `domaines` (PC) et/ou un `iphone` (identifiant de bundle). Un appareil ignore
  le champ qu'il ne sait pas appliquer.
- `tout` désigne toutes les apps du catalogue.
- **Comptes** : tout compte d'un PC absent de `comptes_de_travail` est un **compte libre**.

### 2.5 Modes
```yaml
modes:
  NIGHT_LOCK:
    quand: { heure: { apres: "$coucher" } }        # jusqu'à la fin de la journée (= lever suivant)
    effets: { bloque: tout, sauf: [claude_code], verrouiller_session: true }
    sessions: interdites
  MORNING_LOCK:
    quand: { pas: planning_fait }
    appareils: [pc_linux, pc_windows]               # facultatif ; défaut : tous
    effets: { bloque: tout, fermer_comptes_hors_travail: true }
    sessions: interdites
  EVENING_FREE:
    quand:
      tous:
        - { heure: { apres: "$ouverture", decale_par: prix_du_report } }
        - prioritaires_faites
        - recap_fait
    effets: {}
  WORK:
    quand: toujours
    effets: { bloque: [ia_conversationnelle, divertissement], fermer_comptes_hors_travail: true }
    sessions: autorisees
```
- Une routine liste les modes **dans l'ordre** : le premier dont la condition est vraie gagne ;
  le dernier sert de défaut. Pas de fusion entre modes.
- `sessions` : `autorisees` (défaut) ou `interdites`.
- `effets` : `bloque` (`tout` ou liste de groupes/apps), `sauf` (apps jamais bloquées par ce
  mode), `verrouiller_session` (PC : session verrouillée, tous comptes), `fermer_comptes_hors_travail`.

### 2.6 Conditions (vocabulaire fermé)
| Condition | Vraie quand |
|---|---|
| `toujours` | toujours |
| `heure: { apres, avant }` | l'instant est ≥ `apres` et < `avant` (bornes facultatives), dans la journée courante (§3.1). `decale_par: prix_du_report` ajoute le prix du report à `apres`. Les expressions `$…` et les **paramètres** du mode (`$ouverture`) sont résolus. |
| `planning_fait` | aucune tâche non terminée portant l'étiquette `todoist.etiquette_planning` avec une échéance ≤ jour courant |
| `recap_fait` | aucune tâche non terminée portant l'étiquette `todoist.etiquette_recap` avec une échéance ≤ jour courant − `todoist.recap_tolerance_jours` (défaut 1) |
| `prioritaires_faites` | aucune tâche non terminée, échéance **≤ jour courant** (du jour **et en retard** : une P1/P2 en retard bloque la soirée, décision du propriétaire), priorité dans `todoist.prioritaires` (défaut `[p1, p2]`), hors étiquettes `todoist.etiquettes_exclues` et hors tâches non assignées à l'utilisateur |
| `aucun_retard` | toutes les tâches de la **photo des retards** du jour courant sont terminées (§4.4) |
| `nombre_de_taches: { filtre, au_plus }` | forme générale : `filtre = { jour: aujourd_hui \| retard \| les_deux, priorites, etiquettes_incluses, etiquettes_exclues }` |
| `tous: [...]`, `un_parmi: [...]`, `pas: c` | combinaisons |

### 2.7 Routines et calendrier
```yaml
routines:
  cours:
    fuseau: America/Cayenne
    modes: [NIGHT_LOCK, MORNING_LOCK, EVENING_FREE, WORK]
    parametres: { EVENING_FREE: { ouverture: "$coucher - 2h" } }
    jours:
      lun: { engagements: [salle, cours] }
      ven: { engagements: [salle, cours], parametres: { EVENING_FREE: { ouverture: "18:00" } } }
      dim: { parametres: { EVENING_FREE: { ouverture: "14:00" } }, conditions_en_plus: { EVENING_FREE: [aucun_retard] } }
      # retirer: [MORNING_LOCK]  → retire un mode ce jour-là
  vacances:
    fuseau: America/Cayenne
    reveil_libre: "08:00"                   # surcharge
    engagements: { salle: { heure: libre } } # surcharge d'engagement
    ...
reveil_libre: "07:00"                       # global, surchargé par la routine
routine_par_defaut: cours
calendrier:
  - { routine: vacances, du: "2026-12-19", au: "2027-01-01" }   # jours inclus, dates locales
```
- Routine d'un jour D : la première plage du `calendrier` qui contient D, sinon
  `routine_par_defaut`.
- Surcharge en couches : défaut du mode → `parametres` de la routine → `jours.<j>.parametres`
  → exceptions.

### 2.8 Todoist et prix du report
```yaml
todoist:
  etiquette_planning: planning
  etiquette_recap: recap
  recap_tolerance_jours: 1
  prioritaires: [p1, p2]
  etiquettes_exclues: [planning, recap]
prix_du_report:
  par_report: "20min"
  plafond: "90min"
  commentaire_min: 15          # report documenté par un commentaire ≥ 15 caractères = gratuit
  deadline: { reports_max: 3, jours_minimum: 2 }
```
⚠ Dans l'API Todoist, `priority: 4` = P1 et `priority: 1` = P4. Le moteur ne connaît que
`p1…p4` ; l'adaptateur Todoist convertit.

## 3. Le moteur

### 3.1 Journée
- **Lever(D)** pour un jour local D :
  1. engagements du jour D = ceux de la routine de D pour ce jour de semaine, plus les
     exceptions `ajoute`, moins `retire`, avec `decale` appliqué ;
  2. si au moins un engagement donne un réveil : lever = min(réveils, `reveil_libre`) ;
  3. sinon lever = `reveil_libre` ;
  4. si la nuit D−1 porte une exception **avancer le coucher** et que D n'a aucun engagement
     avec réveil : lever = borne(coucher appliqué(D−1) + cible, `lever_plancher`, `reveil_libre`).
- **Coucher prévu(D)** = lever(D+1) − cible (routine de D+1 pour le lever).
- **Coucher appliqué(D)** = coucher prévu, modifié par les exceptions de la nuit D (§3.4).
- **Journée courante d'un instant t** = le jour D tel que lever(D) ≤ t < lever(D+1).
  `$lever` = lever(D), `$coucher` = coucher appliqué(D). (Une nuit appartient au jour du soir.)
- **Ouverture(D)** = le paramètre `ouverture` d'EVENING_FREE résolu pour D, plus le prix du
  report du jour (plafonné) ; sans EVENING_FREE dans la routine : ouverture = coucher. Toujours
  bornée à ≤ coucher appliqué(D).
- **Dette prévue de la nuit D** = cible − (lever(D+1) − coucher appliqué(D)) (négative si
  on dort plus que la cible).

### 3.2 Choix du mode
À l'instant t, pour un appareil A : parcourir les modes de la routine du jour courant (moins
`retirer`), ignorer ceux dont `appareils` n'inclut pas A, prendre le premier dont la condition
(plus `conditions_en_plus`) est vraie.

### 3.3 Actions par appareil
- PC : `bloquer_domaines` = domaines des apps bloquées (moins `sauf`), dédoublonnés et triés ;
  `verrouiller_session`, `fermer_comptes_hors_travail`.
- iPhone : `bloquer_apps` = identifiants `iphone` des apps bloquées.

### 3.4 Exceptions
Types : `ajoute` (date, libellé, `heure` + `preparation` ou `reveil`), `retire` (date,
engagement — refusé si non `annulable`), `decale` (date, engagement, nouvelle heure — refusé si
non `decalable`), `coucher` (nuit, nouvelle heure de coucher), `avancer_coucher` (nuit, heure =
maintenant : « je vais dormir »).
- **Resserrer** (coucher plus tôt, engagement ajouté ou avancé) : toujours permis, sans
  friction, à toute heure.
- **Desserrer** (coucher plus tard, engagement retiré ou repoussé) — pour la nuit D :
  | Moment de la demande | Friction | Plafond de sommeil | Limite |
  |---|---|---|---|
  | avant ouverture(D) | aucune | sommeil prévu ≥ `minimum` | aucune |
  | après ouverture(D), avant lever(D+1) | `raison` ≥ 50 caractères + `phrase` exacte `JE NE PEUX PAS DECALER` | sommeil ≥ `plancher_nuit` | **1 fois** par nuit |
- **« Je vais dormir »** (`avancer_coucher`, `a` = maintenant) n'est admissible que si
  `a` < coucher appliqué de la nuit ; sinon refus « la nuit a déjà commencé à HH:MM » (heure
  locale du coucher appliqué), sans friction demandée. Elle ne peut jamais repousser le coucher :
  pour coucher plus tard, c'est une exception `coucher` (desserrage, règles ci-dessus).
- `prixException(contexte, demande)` renvoie : admissible ou non (et pourquoi), friction
  exigée, coucher avant/après, lever avant/après, dette de la nuit avant/après.
- Plusieurs exceptions de la même nuit s'appliquent dans l'ordre de création.

### 3.5 Prix du report (jour D)
Pour chaque report de la liste `faits.reports` daté du jour D (local), d'une tâche de priorité
dans `todoist.prioritaires`, dont l'ancienne échéance est ≤ D et la nouvelle > D : coût
`par_report`, sauf si
- un commentaire ≥ `commentaire_min` caractères a été ajouté à la tâche dans les 3 jours
  précédant le report, ou
- la tâche a une deadline, la nouvelle échéance est avant la deadline, la tâche a été reportée
  moins de `reports_max` fois, la deadline est à plus de `jours_minimum` jours, et la deadline
  n'a pas été posée le jour du report.
Total = min(n × `par_report`, `plafond`).

### 3.6 Planning
`planifier(contexte, appareil, horizon = 36 h)` : découpe [maintenant, maintenant + horizon]
en segments de mode constant, **en supposant les faits Todoist inchangés**. Points de rupture
candidats : levers, couchers, ouvertures, toutes les heures `apres`/`avant` résolues. Segments
contigus de même mode et mêmes actions fusionnés.
Les segments sont une projection, pas une promesse : un mode conditionnel (MORNING_LOCK,
EVENING_FREE) y apparaît avec des bornes horaires qui ne tiennent que si personne ne touche à
Todoist. Pour l'interface, c'est `expliquer` et `sortie` (§3.7) qui font foi.

### 3.7 Explication de la décision
`expliquer(contexte, appareil)` : pour chaque mode de la routine du jour courant, **dans l'ordre
de priorité** (modes retirés compris) :
```ts
{ mode, nom,            // nom : Nuit, Matin verrouillé, Soirée libre, Travail ; sinon l'identifiant
  applicable,           // faux si `appareils` exclut l'appareil ou si `retirer` l'enlève ce jour
  actif,                // le mode choisi (§3.2)
  logique: 'tous' | 'un_parmi' | 'pas' | 'simple',
  conditions: [{ type: 'toujours'|'heure'|'planning'|'recap'|'prioritaires'|'retard'|'taches',
                 libelle,  // le fait, court et positif
                 vraie,    // état réel du fait maintenant
                 detail,   // le reste : « à faire », « en retard depuis le 8 oct. », « +20 min de report », ou null
                 a,        // condition d'heure : instant où le fait devient vrai, sinon null
                 niee }] } // le mode exige le contraire du fait (`pas`)
```
- `quand` + `conditions_en_plus` forment une conjonction (`tous`), aplatie d'un niveau. Une
  combinaison imbriquée tient sur une ligne, libellé composé.
- **Toujours le fait positif**, jamais une formulation niée : sous `pas`, `libelle` reste
  « Planning du matin », `vraie` est l'état du planning (faux tant qu'il n'est pas fait) et
  `niee` = vrai. Le mode `pas` s'applique tant que son fait n'est pas vrai (l'interface titre la
  liste « Se lève quand c'est fait : »).
- **Libellé court, le fait seul ; le reste en détail.** Libellés : « Planning du matin »,
  « Récap d'hier » (selon `recap_tolerance_jours`), « Tâches P1/P2 faites » (priorités de
  `todoist.prioritaires`), « Retards rattrapés », « Par défaut ».
- Heure : **une seule mention**, l'heure effective (report compris, comme `journee.ouverture`) :
  « Ouverture à 20:50 », détail « +20 min de report » s'il y a un report ; `$coucher` s'écrit
  « Coucher à 22:30 », `$lever` « Lever à 06:30 » ; deux bornes « De 14:00 à 18:00 », une borne
  `avant` « Avant 18:00 ».
- Détails : `planning` et `recap` ne donnent **jamais un compte** mais la plus ancienne échéance
  non faite : « à faire » si c'est l'échéance attendue (aujourd'hui pour le planning ; jour − 
  `recap_tolerance_jours` pour le récap, ex. le récap d'hier), sinon « en retard depuis le 8 oct. ».
  `prioritaires` : « 3 restantes », « 3 restantes, dont 2 en retard depuis le 12 oct. » (date de la
  plus ancienne échéance), « 2 restantes, en retard depuis le 12 oct. » si toutes le sont.
  `retard` : « 1 restante (en retard à minuit) ». Dates au format court français (« 1er nov. »).

`sortie(contexte, appareil)` → `{ texte, certaine, auPlusTard }` : comment on quitte le mode
actif. Chemins examinés : une condition vraie du mode actif qui cessera de l'être (heure `avant`,
ou tâches faites pour une condition niée), et chaque mode prioritaire applicable dont les
conditions fausses peuvent devenir vraies (heure future, ou tâches à faire ; jamais une régression
comme l'ajout d'une tâche). `auPlusTard` = le plus tôt des changements certains : coucher (ou
lever suivant si la nuit a commencé), ou heure d'un mode prioritaire qui ne dépend que de l'heure.
S'il existe un chemin dépendant d'une action et possible avant `auPlusTard`, il donne le texte
(« dès que le planning du matin est fait », « quand les tâches P1/P2 seront faites et
après 20:30 ») et `certaine` = faux ; sinon le texte est celui du changement certain (« au
coucher, 22:30 », « au lever, 06:30 », « à 20:30 ») et `certaine` = vrai.

## 4. L'API

### 4.1 Authentification
`Authorization: Bearer <jeton>`. Jetons stockés **hachés** (SHA-256) dans `appareils`. Types de
jeton : `appareil` (un par appareil), `interface` (web app, extension), `config` (GitHub
Actions). Chaque jeton appartient à un utilisateur. Création par un script local
(`npm run jeton:creer -- <appareil|interface|config> <nom>`) qui affiche le jeton une fois.

### 4.2 Points d'entrée v2.0
| Méthode | Chemin | Jeton | Rôle |
|---|---|---|---|
| GET | `/v1/planning` | appareil | planning de l'appareil (§4.3) ; vaut ping (met à jour `vu_le`) |
| POST | `/v1/accuses` | appareil | `{ action, pose_le }` : verrou posé |
| POST | `/v1/evenements` | appareil | lot : `{ type: reconnexion \| acces, ... }` |
| GET | `/v1/statut` | interface | mode par appareil et raison, journée (lever, coucher, ouverture), phase, actions possibles, engagements de demain, dette des 7 dernières nuits, sessions, dernier ping (§4.6) |
| GET | `/v1/taches` | interface, appareil | tâches du jour éligibles à une session (`eligible_le` : création + 15 min) |
| GET | `/v1/blocage?appareil=<nom>&domaine=<d>` | interface, appareil | pour l'extension : `{ bloque, app, mode, raison, sessions: autorisees \| interdites }` (`bloque` tient compte des sessions ouvertes ; un jeton appareil ne lit que son appareil) |
| POST | `/v1/sessions` | interface, appareil | ouvrir : `{ appareil, tache_id, apps: [id] }` ; `apps` accepte des identifiants d'apps **ou de groupes** du catalogue (§4.5) |
| POST | `/v1/sessions/:id/apps` | interface, appareil | ajouter une app (gratuit) : `{ app }` ou `{ apps: [id] }`, groupes acceptés |
| POST | `/v1/sessions/:id/reponse` | interface, appareil | `{ question_id, reponse: continue \| arrete }` |
| POST | `/v1/sessions/:id/fermer` | interface, appareil | fermer |
| POST | `/v1/exceptions/prix` | interface | aperçu, sans rien enregistrer |
| POST | `/v1/exceptions` | interface | enregistrer (mêmes règles) |
| POST | `/v1/config` | config | `{ yaml, commit }` : valide, enregistre une nouvelle version |
| GET | `/v1/config/version` | tous | version active |
| POST | `/v1/dev/horloge` | interface | **local seulement** (`FOCUS_ENVIRONNEMENT=local`, sinon 404) : `{ horloge: "+3h" \| instant \| null }` règle l'horloge de l'API (docs/essai-local.md) |

Erreurs : `{ erreur: code, message }` en français, codes HTTP usuels.

### 4.3 Format du planning (PC)
```json
{
  "version": 1,
  "appareil": "pc_linux",
  "heure_serveur": "2026-11-03T21:00:00Z",
  "config_version": "3f2a9c1",
  "valable_jusqua": "2026-11-05T09:00:00Z",
  "comptes_de_travail": ["alice"],
  "segments": [
    { "debut": "2026-11-03T21:00:00Z", "fin": "2026-11-03T23:30:00Z", "mode": "WORK",
      "sessions": "autorisees",
      "actions": { "bloquer_domaines": ["youtube.com"], "verrouiller_session": false,
                   "fermer_comptes_hors_travail": true } }
  ],
  "sessions": [
    { "id": "s_01", "tache": { "id": "123", "nom": "DM de maths" }, "apps": ["chatgpt"],
      "domaines": ["chatgpt.com"], "ouverte_le": "…Z",
      "question": { "id": "q_07", "posee_a": "…Z", "attente_s": 3, "expire_a": "…Z" } }
  ],
  "raison": "WORK — tâches prioritaires restantes : 2"
}
```
Règles côté client :
- Se caler sur `heure_serveur` (décalage = heure_serveur − horloge locale à la réception).
- Segment en vigueur = celui qui contient l'instant. Au-delà de `valable_jusqua` : tout est
  levé (chaque verrou porte son échéance).
- Domaines bloqués = segment − domaines des sessions valides. Une session est valide tant que
  `question.expire_a` n'est pas passé, ou après un « continue » accepté. Pendant un segment avec
  `verrouiller_session: true`, les sessions ne comptent pas.

### 4.4 Tâches planifiées (une seule entrée cron `* * * * *`)
Chaque minute : rafraîchir les faits Todoist en cache (réécrits seulement s'ils changent).
À 00:00 locale (fuseau de la routine du jour qui commence) : **photo des retards** (tâches en
retard à cet instant, toutes priorités, hors exclusions). Au coucher appliqué : photo de la
nuit (table `nuits`, pour l'historique). Une fois par jour : vérifier que les étiquettes de la
config existent dans Todoist.
Une fois par heure, si les secrets `XIAOMI_USER_ID`, `XIAOMI_PASS_TOKEN` et `XIAOMI_UTILISATEUR`
sont posés (`XIAOMI_REGION` : `de` pour un compte européen, vide = Chine) : **sommeil mesuré**.
Le compte Xiaomi appartient à **un seul utilisateur** : `XIAOMI_UTILISATEUR` (identifiant
`utilisateur` de sa config) ; les autres utilisateurs de la base ne sont jamais synchronisés
(variable plutôt que champ YAML : le compte est un secret du Worker, pas de la config). Les sessions
de sommeil des 3 derniers jours sont lues dans le cloud Mi Fitness (`api/src/xiaomi.ts`, lecture
seule) et écrites dans `mesures` (`type = sommeil`, `source = xiaomi`, `cle` = identifiant de la
session chez Xiaomi, `valeur` = minutes endormi, `details` = éveil, phases, score, sieste, et ce
que la montre donne en plus : chronologie des phases en instants UTC (`state` 2 profond, 3 léger,
4 REM, 5 éveil, correspondance vérifiée sur la réponse : chaque somme de tranches = le champ
`sleep_*_duration` du même nom), nombre de réveils, pouls et SpO2 (moyenne, min, max), qualité
de respiration, nuit incomplète, `timezone` et version d'algorithme bruts) :
insérée, mise à jour si elle a changé, effacée si Xiaomi l'a supprimée. Secrets absents : étape
sautée. Chaque requête porte un User-Agent : sans lui, le compte refuse le passToken (code
70016, cas du `fetch` des Workers). passToken refusé : erreur `jeton_xiaomi_expire` notée dans le cache (`synchro_xiaomi`),
renvoyée par le statut et relancée l'heure suivante ; le jeton n'est jamais journalisé.

**Rattrapage de l'historique.** Lancé au premier passage (pas d'état de rattrapage dans
`synchro_xiaomi`, ou aucune mesure Xiaomi pour l'utilisateur et dernier rattrapage lancé il y a plus
d'un jour) depuis `XIAOMI_DEPUIS` (date `AAAA-MM-JJ`, UTC) ou, à défaut, 60 jours en arrière ; et
quand des nuits récentes manquent (dernière lecture réussie des 3 jours antérieure au début de la
fenêtre : la synchro n'a pas tourné pendant plus de 3 jours), depuis cette lecture moins un jour.
Lecture du plus récent au plus ancien, par morceaux de 10 jours (recouvrement de 12 h), 3 morceaux
au plus par passage, une seule connexion par passage : environ 2 + 3 × (pages) sous-requêtes, loin
des 50 du Worker. Tant qu'il reste des morceaux et que le dernier passage a réussi, la tâche
reprend à la minute suivante ; le curseur (`rattrapage.curseur`) n'avance qu'après un morceau
écrit, donc une panne reprend là où elle s'est arrêtée, une heure plus tard. Les 3 derniers jours
restent lus une fois par heure (`recente_le`).

**passToken tournant.** Xiaomi renvoie un passToken à chaque connexion (champ `passToken` de la
réponse, sinon cookie). Si le secret `CLE_CHIFFREMENT` est posé, le plus récent est gardé dans le
cache (clé `jeton_xiaomi`) chiffré en AES-GCM 256 (Web Crypto ; clé dérivée par HKDF-SHA-256 du
secret ; IV aléatoire de 12 octets ; données associées `jeton_xiaomi:<utilisateur>:<userId>`), et
il sert de préférence au secret `XIAOMI_PASS_TOKEN`. Refusé (`jeton_xiaomi_expire`) : il est
effacé et le passage reprend avec le secret ; le jeton reçu ensuite le remplace. Sans
`CLE_CHIFFREMENT` : rien n'est gardé, le secret sert toujours. Ni le jeton ni la clé ne sont
journalisés ou renvoyés par l'API.

### 4.5 Sessions
- **Session possible** sur un appareil seulement si (1) le mode en vigueur sur l'appareil a
  `sessions: autorisees`, (2) ce mode bloque au moins une app sur l'appareil (domaines pour un
  PC, identifiants pour l'iPhone) et (3) pour un PC, l'appareil a au moins un compte de travail.
  Sinon, motif dans cet ordre : « aucun compte de travail sur ce PC » ; mode qui interdit les
  sessions, nommé (jamais son identifiant) : pour un mode `pas`, le fait qui manque (« Matin
  verrouillé : planning du matin à faire », « … en retard depuis le 8 oct. »), sinon la fin si elle
  est certaine (« Nuit jusqu'à 05:30 », heure de `sortie`, jamais du planning qui suppose Todoist
  figé), sinon « <mode> : fin <sortie.texte> » ; « rien n'est bloqué en ce moment ». Ex. :
  `pc_windows` (aucun compte de travail) n'a jamais de session possible.
- **Apps et groupes** : `apps` contient des identifiants d'apps ou de groupes du catalogue
  (`groupes`) ; un groupe est déplié en ses apps, le tout dédoublonné, et la session enregistre
  des apps. Un identifiant inconnu des deux : 422 `app_inconnue`. Une app prime sur un groupe de
  même identifiant.
- Ouverture et ajout d'une app à une session refusés (409 `session_impossible`, avec `appareil`,
  `mode`, `motif`) si la session n'est pas possible sur l'appareil. Ouverture refusée aussi si
  la tâche est terminée ou créée il y a moins de 15 min, ou si le plafond quotidien (3 h, toutes
  sessions de la journée) est atteint.
- Questions : la première à ouverture + intervalle (25 min PC, 10 min iPhone, réglable) ; puis
  après chaque « continue », + intervalle. `expire_a` = `posee_a` + 60 s (+ `attente_s`).
- **Attente progressive** : le n-ième « continue » de la même tâche dans la journée exige
  `[0, 3, 5, 10, 15, 20][min(n, 5)]` secondes. L'API refuse un « continue » arrivé avant
  `posee_a + attente_s`.
- Pas de réponse avant `expire_a`, ou « arrête » : session fermée. Tâche terminée : session
  fermée.

### 4.6 Statut (`GET /v1/statut`)
Champs calculés à partir de la journée courante J (contrat partagé avec la web app) :
```jsonc
{
  "heure_serveur": "…Z", "config_version": "…",
  "journee": { "date", "routine", "fuseau", "engagements", "lever", "lever_suivant", "coucher_prevu",
               "coucher_applique", "ouverture", "prix_du_report_min", "dette_nuit_min", "decision_de_nuit_prise" },
  "phase": "journee" | "soiree" | "nuit",
  "actions": {
    "je_vais_dormir":  { "disponible": bool, "motif": string | null },
    "decaler_coucher": { "mode": "libre" | "decision_de_nuit" | "indisponible", "motif": string | null }
  },
  "engagements_demain": [
    { "id": "sport", "nom": "Sport", "reveil": "…Z" | null, "heure": "…Z" | null,
      "annulable": bool, "decalable": bool, "origine": "routine" | "exception" }
  ],
  "nuits": [ { "nuit": "YYYY-MM-DD", "dette_min": number, "dette_reelle_min": number | null,
               "endormi_min": number | null, "incomplete": bool,
               "phases": { "legere", "profonde", "rem", "eveil" } | null,
               "siestes_min": number, "siestes": [ { "debut": "…Z", "fin": "…Z", "minutes": number } ] } ],
  "dette_cumulee_min": number, "dette_cumulee_reelle_min": number | null,
  "siestes_total_min": number, "siestes_du_jour": [ { "debut", "fin", "minutes" } ], "siestes_du_jour_min": number,
  "sieste_tardive": { "fin": "…Z", "coucher": "…Z" } | null,
  "objectif_sommeil_min": number,
  "sommeil_mesure": { "derniere_synchro": "…Z" | null, "erreur": string | null } | null,
  "appareils": [ { "nom", "type", "mode", "sessions", "session_possible": bool,
                   "session_motif": string | null, "raison", "actions", "apps_bloquees",
                   "groupes_bloques": [ { "id", "nom", "apps": [id] } ],
                   "dernier_ping", "jusqua": "…Z",
                   "parcours": [ /* expliquer(), §3.7 */ ],
                   "sortie": { "texte": string, "certaine": bool, "au_plus_tard": "…Z" } } ],
  "appareil_principal": "pc_linux" | null,
  "sessions": [ … ], "sessions_du_jour": { "cumul_min", "plafond_min" }, "todoist": { … }
}
```
- `phase` : `nuit` si maintenant ≥ coucher appliqué(J) ; `soiree` si ≥ ouverture(J) ; sinon `journee`.
- `je_vais_dormir` : disponible si maintenant < coucher appliqué(J) ; sinon motif « la nuit a
  déjà commencé à HH:MM » (même règle que le moteur, §3.4).
- `decaler_coucher` : `libre` avant l'ouverture ; `decision_de_nuit` après, si elle n'a pas été
  prise pour la nuit J (motif « soirée ouverte depuis HH:MM ») ; `indisponible` sinon (motif
  « décision de nuit déjà prise pour la nuit du 3 nov. (une seule par nuit) »). Indicatif : le prix exact passe par
  `/v1/exceptions/prix`.
- `engagements_demain` : `engagementsPrevus(contexte, J + 1)` du moteur, exceptions appliquées
  (un engagement décalé garde l'origine `routine`). `nom` : libellé pour une exception `ajoute`,
  sinon l'identifiant avec une majuscule.
- `nuits` : les 7 nuits terminées J−7 … J−1, de la plus ancienne à la plus récente, `dette_min` =
  `journee(D).detteNuitMin` recalculée par le moteur avec la config active et les exceptions
  enregistrées ; `dette_cumulee_min` = leur somme.
- **Dette réelle** (sommeil mesuré, §4.4) : `dette_reelle_min` = cible − temps endormi de la nuit
  (somme des sessions de la nuit, siestes exclues ; null sans mesure). Une session appartient à
  la nuit du jour du soir : date locale de son milieu moins 12 h. `phases` : minutes par phase,
  cumulées sur la nuit. `dette_cumulee_reelle_min` = somme sur les seules nuits mesurées, moins
  `siestes_total_min` (null si aucune nuit mesurée).
  `sommeil_mesure` : dernière synchro réussie et code d'erreur de la dernière tentative
  (null si jamais tentée). `endormi_min` : minutes dormies de la nuit (null sans mesure) ;
  `incomplete` : une session de la nuit est marquée incomplète par la montre (`is_uncomplete`).
  `objectif_sommeil_min` : `sommeil.cible` de la config.
- **Siestes** : une session est une sieste si Xiaomi la marque comme telle (`is_nap`), ou si elle
  tient entièrement dans la journée de veille d'un jour D, entre `lever(D)` et `coucher_applique(D)`
  du moteur (le cloud Xiaomi renvoie souvent une sieste comme une session ordinaire). Elle
  appartient alors à la journée D, sinon à une nuit (règle ci-dessus). Une sieste marquée par
  Xiaomi hors de toute journée connue appartient à la date locale de son milieu. `nuits[].siestes`
  / `siestes_min` : siestes de la journée D (prises avant la nuit D) ; `siestes_du_jour` /
  `siestes_du_jour_min` : celles de la journée courante J ; `siestes_total_min` : somme des
  journées J−7 … J (toutes celles que la carte montre). Une sieste rattrape la dette mais n'entre
  jamais dans `endormi_min` ni `dette_reelle_min` d'une nuit. `sieste_tardive` : la dernière sieste
  de J finie moins de 4 h avant `coucher_applique(J)`, avec ce coucher ; null sinon, et null une fois
  le coucher passé (information seulement, rien n'est bloqué).
- **Carte « Sommeil »** de la web app : temps dormi de la dernière nuit mesurée (« Cette nuit »
  si c'est J−1, sinon « Nuit du … »), écart à l'objectif en mots (« 29 min de moins que
  l'objectif », « … de plus … », « objectif atteint » à 5 min près), phases léger → REM → profond
  et éveil à part ; puis les 7 nuits en barres (heures dormies, trait de l'objectif, pas de barre
  sans mesure, barre pâle si incomplète) et l'écart total sur les nuits mesurées. Elle ne montre
  plus la dette prévue (`dette_min`, toujours renvoyée) ; le coucher prévu est dans « Ce soir ».
  Siestes : le chiffre de la dernière nuit reste la nuit seule ; dessous, si la nuit manque
  l'objectif et que la journée qui la suit a une sieste (`siestes_du_jour` pour « Cette nuit »,
  sinon `siestes` de la nuit suivante) : « 29 min de moins que l'objectif, dont 20 min rattrapées
  en sieste », plafonné à l'écart (« …, rattrapées en sieste » si la sieste le couvre). Dans le
  graphique, la sieste de la journée D est un segment vert empilé au-dessus de la barre de la
  nuit D (légende « sieste », infobulle « 7 h 12 de nuit + 1 h 05 de sieste »). Écart total =
  Σ nuits + `siestes_total_min` − objectif × nuits mesurées, dit « 5 h 47 de moins au total, dont
  1 h rattrapée en siestes » (« dont … » omis sans sieste). `sieste_tardive` : note discrète
  « Sieste tardive : vous endormir à 21:30 pourrait être plus difficile. »
- `appareils[].jusqua` : fin du segment en cours du planning de l'appareil (`planifier(…)[0].fin`).
  **Suppose les faits Todoist constants** : pour MORNING_LOCK ou WORK, c'est une borne, pas une
  heure de sortie. L'interface affiche `sortie` (et ne présente jamais un mode conditionnel
  comme un créneau horaire).
- `appareils[].parcours` : sortie de `expliquer(contexte, nom)` telle quelle (§3.7).
- `appareils[].groupes_bloques` : groupes que le mode en vigueur bloque (cités dans `bloque`, ou
  tous pour `tout`), réduits aux apps bloquées sur l'appareil (`apps_bloquees`, `sauf` compris) ;
  un groupe sans app bloquée ici n'apparaît pas. `nom` lisible (table de l'API, sinon
  l'identifiant mis en forme : `jeux_video` → « Jeux video »). Tri par nom. La web app les propose
  d'abord à l'ouverture d'une session (case « tout le groupe », apps dépliables), puis les apps
  bloquées hors groupe.
- `appareils[].sortie` : `sortie(contexte, nom)` ; `certaine` est vrai seulement si la sortie ne
  dépend que de l'heure ; `au_plus_tard` = le prochain changement certain.
- `appareil_principal` : le premier PC (`pc_linux`, `pc_windows`) qui a au moins un compte de
  travail, sinon le premier appareil de la config (null s'il n'y en a aucun).
- `appareils[].session_possible` / `session_motif` : la règle de §4.5 ; `session_motif` est null
  quand la session est possible. À l'ouverture, la web app montre **tous** les appareils ; ceux où
  la session est impossible sont désactivés, leur motif sous le nom.

## 5. Client PC (Go)

Deux exécutables, un seul code : `focusd` (service, root/SYSTEM) et `focus-agent` (session de
l'utilisateur, affiche les questions et l'ouverture de session). Ils se parlent en local.
- Boucle de `focusd` : toutes les 60 s, `GET /v1/planning` ; garder le dernier planning en cache
  sur disque ; appliquer le segment en vigueur ; envoyer les accusés.
- Fichier hosts : bibliothèque `txn2/txeh` ; lignes gérées entre deux balises
  (`# >>> focus` / `# <<< focus`) ; le reste du fichier n'est jamais touché ; vidage du cache DNS
  si nécessaire.
- Verrouillage : Linux `loginctl lock-session` sur **toutes** les sessions graphiques et texte
  de tous les comptes, surveillance de `LockedHint` (D-Bus) ; déverrouillage pendant un segment
  verrouillé → reverrouillage immédiat + événement `reconnexion`. Windows : API de session (WTS).
- Comptes libres : Linux, fermer/verrouiller leurs sessions ; Windows, désactiver le compte.
- Service : `kardianos/service`. Questions : `ncruces/zenity` (sous Linux, le programme
  `zenity` doit être installé).
- Règle : une bibliothèque multi-plateforme d'abord ; sinon une fonction en deux fichiers
  (`_linux.go`, `_windows.go`) derrière la même interface. Bibliothèques vérifiées avant ajout.

## 6. Web app et extension
- Web app (React + Vite, composants shadcn/ui), servie comme fichiers statiques par le Worker.
  Écrans v2.0 : statut, exceptions (avec aperçu du prix), décision de nuit, sessions, dernier
  ping. Installable en PWA. Jeton `interface` saisi une fois.
- Une seule règle de couleurs pour un fait (parcours, carte du mode, tableau des appareils) :
  ✓ vert = fait ; ✗ orange = à faire, c'est ce qui bloque ; horloge grise = heure pas encore
  atteinte (rien à faire). Les motifs de l'API (minuscule initiale, sans point) prennent une
  majuscule quand ils sont affichés seuls.
- Extension (Manifest V3, Chrome) : **interface seulement**, ne bloque rien. Quand un onglet
  échoue sur un domaine bloqué, elle demande la raison à l'API et affiche une page avec la
  raison et un bouton pour ouvrir une session.
