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
| `prioritaires_faites` | aucune tâche non terminée, échéance = jour courant, priorité dans `todoist.prioritaires` (défaut `[p1, p2]`), hors étiquettes `todoist.etiquettes_exclues` et hors tâches non assignées à l'utilisateur |
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
| GET | `/v1/statut` | interface | mode par appareil et raison, journée (lever, coucher, ouverture), sessions, dette, dernier ping |
| GET | `/v1/taches` | interface, appareil | tâches du jour éligibles à une session (`eligible_le` : création + 15 min) |
| GET | `/v1/blocage?appareil=<nom>&domaine=<d>` | interface, appareil | pour l'extension : `{ bloque, app, mode, raison, sessions: autorisees \| interdites }` (`bloque` tient compte des sessions ouvertes ; un jeton appareil ne lit que son appareil) |
| POST | `/v1/sessions` | interface, appareil | ouvrir : `{ appareil, tache_id, apps: [id] }` |
| POST | `/v1/sessions/:id/apps` | interface, appareil | ajouter une app (gratuit) |
| POST | `/v1/sessions/:id/reponse` | interface, appareil | `{ question_id, reponse: continue \| arrete }` |
| POST | `/v1/sessions/:id/fermer` | interface, appareil | fermer |
| POST | `/v1/exceptions/prix` | interface | aperçu, sans rien enregistrer |
| POST | `/v1/exceptions` | interface | enregistrer (mêmes règles) |
| POST | `/v1/config` | config | `{ yaml, commit }` : valide, enregistre une nouvelle version |
| GET | `/v1/config/version` | tous | version active |

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

### 4.5 Sessions
- Ouverture refusée si le mode en vigueur sur l'appareil a `sessions: interdites`, si la tâche
  est terminée ou créée il y a moins de 15 min, ou si le plafond quotidien (3 h, toutes
  sessions de la journée) est atteint.
- Questions : la première à ouverture + intervalle (25 min PC, 10 min iPhone, réglable) ; puis
  après chaque « continue », + intervalle. `expire_a` = `posee_a` + 60 s (+ `attente_s`).
- **Attente progressive** : le n-ième « continue » de la même tâche dans la journée exige
  `[0, 3, 5, 10, 15, 20][min(n, 5)]` secondes. L'API refuse un « continue » arrivé avant
  `posee_a + attente_s`.
- Pas de réponse avant `expire_a`, ou « arrête » : session fermée. Tâche terminée : session
  fermée.

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
- Extension (Manifest V3, Chrome) : **interface seulement**, ne bloque rien. Quand un onglet
  échoue sur un domaine bloqué, elle demande la raison à l'API et affiche une page avec la
  raison et un bouton pour ouvrir une session.
