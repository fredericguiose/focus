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
  cible: "8h"            # coucher prévu = lever du lendemain − cible − endormissement
  minimum: "7h"          # plafond de l'exception « décaler le coucher » avant l'ouverture
  plancher_nuit: "6h"    # plafond de la décision de nuit (après l'ouverture)
  lever_plancher: "04:30" # sans engagement à heure, jamais de lever avant cette heure
  endormissement: "30min" # facultatif, défaut 0 : délai entre le coucher et l'endormissement
  ecart_lever_max: "2h"  # facultatif, défaut 2h : écart maximal entre deux levers d'une même semaine
```
`minimum` et `plancher_nuit` sont des durées de **sommeil**, comptées depuis l'endormissement :
le coucher le plus tardif admissible est lever − minimum − endormissement (resp. plancher_nuit).
`reveil_libre` (global, surchargé par routine, §2.7) est le **plafond** du lever : jamais plus
tard, même sans engagement (§3.1).

### 2.3 Engagements
Une raison de se lever. Un engagement répond à **trois questions indépendantes** :
```yaml
engagements:
  salle: { heure: "05:00", preparation: 30, verification: { mesure: seance } }  # réveil 04:30
  cours: { reveil: "06:00" }
  lecture: { obligatoire: false }   # sans heure, facultatif
```
1. **Fixe-t-il le réveil ?** `heure` (+ `preparation`) ou `reveil` : réveil = `reveil`, sinon
   `heure − preparation`. Sans heure (aucun des deux, ou `heure: libre` dans une routine) : il ne
   fixe rien, il sert au suivi. Une exception `decale` peut lui **donner une heure** pour un jour
   (§3.4) : il fixe alors le réveil ce jour-là.
2. **Est-il obligatoire ?** `obligatoire` (défaut `true`). Obligatoire : le retirer ou le
   repousser est un desserrage (raison exigée, §3.4). Facultatif (`false`) : le retirer ou le
   repousser est libre ; seul le plafond de sommeil s'applique. L'avancer ou en ajouter un reste
   libre dans les deux cas.
3. **Comment sait-on qu'il est fait ?** `verification` (facultatif) : l'engagement est **vérifié**
   par une mesure du type donné le jour même (§3.8). Types connus : `sommeil`, `seance` ; un autre
   type est refusé. Sans ce champ (ex. `cours`), l'engagement n'est jamais vérifié. Le moteur ne
   connaît aucune source : ce sont les adaptateurs de l'API (§4.4) qui rangent les mesures par type.
- Tout engagement peut être retiré, et décalé s'il a une heure (ou pour lui en donner une).
  `annulable` et `decalable` n'existent plus : la config qui les porte est refusée avec un message
  qui dit de les retirer.
- Une routine peut surcharger un engagement : `heure`, `preparation`, `reveil`, `obligatoire` ;
  `heure: libre` (engagement sans heure ce jour-là) ne se combine qu'avec `obligatoire`, ex.
  `engagements: { salle: { heure: libre, obligatoire: false } }` pour les vacances.

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
reveil_libre: "07:00"                       # plafond du lever, global, surchargé par la routine
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

### 2.9 Cadences de synchronisation (facultatif)
```yaml
synchro: { todoist: "2min", xiaomi: "15min", hevy: "1h" }   # valeurs par défaut
```
Planchers : 1 min (Todoist), **10 min (Xiaomi, API non officielle)**, 10 min (Hevy) ; 24 h au
plus. Une seule source lourde par minute (§4.4).

## 3. Le moteur

### 3.1 Journée
- **Lever(D)** pour un jour local D = le **lever prévu** de D, toujours (CDC §4, 01/11 : « la
  montre ne raccourcit jamais la nuit en cours »). Un réveil mesuré plus tôt (nuit coupée à 01:00,
  montre mal lue) ne finit pas la nuit, n'avance pas le début de la journée et ne déverrouille
  rien. Le lever **mesuré** de D (fin de la nuit principale D−1, §4.4, §4.6) ne sert qu'aux jours
  suivants (régularité, étape 3), à la dette réelle et aux journaux.
- **Lever prévu(D)** :
  1. engagements du jour D = ceux de la routine de D pour ce jour de semaine, plus les
     exceptions `ajoute`, moins `retire`, avec `decale` appliqué (un engagement sans heure
     décalé reçoit l'heure demandée et réveil = heure − préparation) ;
  2. **borne** B(D) = min(réveils des engagements à heure, `reveil_libre` de la routine de D) ;
     sans engagement à heure : B(D) = `reveil_libre` (plafond absolu) ;
  3. **régularité** : pour deux jours i, j à 6 jours ou moins d'écart (fenêtre de 7 jours),
     lever(i) ≤ lever(j) + `ecart_lever_max` (heures locales). On ne fait que baisser :
     L(D) = min(L(D), L(j) + X) pour |j − D| ≤ 6, jusqu'à stabilité (point fixe), en partant de
     B. Les jours **mesurés avant D** sont fixes (leur mesure) ; les autres bougent. Le plan d'un
     jour n'utilise donc que les mesures d'avant lui : c'est le plan de la veille au soir.
     **Décalage horaire** (CDC §4, 01/11) : vu du fuseau F de la routine de D, la mesure d'un
     jour j ne fixe rien (j est calculé comme un jour sans mesure) si (a) j est dans un autre
     fuseau (écart non nul à sa date), ou (b) j suit de N jours ou moins un jour E dans un autre
     fuseau, N = écart horaire entre le fuseau de E et F à la date de E (Intl), arrondi à l'heure.
     (b) est testé sur les 26 jours avant j : avec plusieurs séjours, le plus contraignant gagne.
     Ex. séjour à Paris du 09 au 30/10, vu de Cayenne (4 h fin octobre) : mesures du 09/10 au
     03/11 ignorées, dès le 04/11 utilisées (`mesureIgnoree`, `core/test/levers.test.ts`) ;
  4. **plancher** : un jour sans engagement à heure ne descend jamais sous `lever_plancher`…
     sauf si la borne qui l'y pousse vient d'un engagement (directement ou par la régularité) :
     l'engagement gagne (ex. réveil 02:00 un samedi → dimanche 04:00, pas 04:30). Une borne venue
     d'une mesure ou d'un plafond ne passe jamais sous le plancher ;
  5. si la nuit D−1 porte une exception **avancer le coucher** et que D n'a aucun engagement
     avec réveil : lever = borne(coucher appliqué(D−1) + cible + endormissement, `lever_plancher`,
     lever calculé aux étapes 1-4).

  Les engagements gagnent toujours : un engagement tôt n'est jamais repoussé, un engagement
  tardif est ramené à la limite (samedi 09:00, préparation 30 min, à moins de 7 jours d'un lever
  à 04:30 → lever 06:30). Retirer un engagement recalcule le lever du jour selon la même règle.
  Calcul : la série est calculée une fois par bloc de 21 jours (blocs fixes depuis le lundi
  03/01/2000), avec 21 jours de marge de chaque côté, et gardée en mémoire tant que la config,
  les exceptions et les mesures du contexte sont les mêmes objets (pas de récursion jour par jour).
  Exemple fictif (`core/test/levers.test.ts` : sport 05:00 − 30 min = 04:30 lun/mar/jeu/ven,
  travail réveil 06:00, plafond 07:00) : mer 06:00, sam et dim 06:30. Congés (plafond 08:00 du
  19 au 31/12, puis plafond 06:30 du 01 au 03/01, reprise lun 04/01 à 04:30) : 19 → 24/12 06:30,
  25 → 28/12 08:00, 29/12 → 03/01 06:30.
- **Coucher prévu(D)** = lever calculé(D+1) (étapes 1-4, sans la mesure de D+1) − cible −
  endormissement (routine de D+1 pour le lever).
- **Coucher appliqué(D)** = coucher prévu, modifié par les exceptions de la nuit D (§3.4).
- **Journée courante d'un instant t** = le jour D tel que lever(D) ≤ t < lever(D+1) (levers
  prévus : la mesure n'y entre jamais).
  `$lever` = lever(D), `$coucher` = coucher appliqué(D). (Une nuit appartient au jour du soir.)
- **Ouverture(D)** = le paramètre `ouverture` d'EVENING_FREE résolu pour D, plus le prix du
  report du jour (plafonné) ; sans EVENING_FREE dans la routine : ouverture = coucher. Toujours
  bornée à ≤ coucher appliqué(D).
- **Dette prévue de la nuit D** = cible − (lever prévu(D+1) − coucher appliqué(D) −
  endormissement) (négative si on dort plus que la cible). Elle se calcule sur le plan, même
  quand le lever de D+1 est mesuré. Le sommeil prévu d'une exception (§3.4) = cible − dette.
- **Journal des levers** (`journalDesLevers`, information seulement, ne bloque rien) : pour
  chacun des 7 jours finissant à J, lever prévu (figé la veille au soir par la photo de la nuit,
  §4.4 ; à défaut, recalculé avec les seules mesures d'avant ce jour), lever mesuré et écart en
  minutes (mesuré − prévu), `ignore: 'decalage_horaire'` si la mesure est ignorée (étape 3, vu
  du fuseau de J) ; sur la période, l'amplitude des levers mesurés non ignorés (le plus tard − le
  plus tôt, en heures locales ; null sous 2 mesures) face à `ecart_lever_max`.
- **Journal des couchers** (`journalDesCouchers`, **affichage seul** : aucune règle, aucune
  contrainte ; le coucher prévu reste déduit du lever, une deuxième contrainte entrerait en
  conflit avec lui) : pour chacune des 7 nuits d'avant J (J−7 à J−1, celles des levers du
  journal), coucher prévu (figé par la photo de la nuit, §4.4 ; à défaut, `coucherPrevu` du
  moteur, `prevuFige: false`), endormissement mesuré (fourni par l'API, §4.6) et écart en minutes
  (mesuré − prévu) ; `ignore: 'decalage_horaire'` selon la règle des levers appliquée au soir de
  la nuit (`mesureIgnoree(nuit)`, vu du fuseau de J). Amplitude des endormissements non ignorés
  comptés **en minutes depuis midi du soir** (23:30 et 00:30 font 1 h, pas 23 h), face au même
  `ecart_lever_max`, donné comme simple repère.

### 3.2 Choix du mode
À l'instant t, pour un appareil A : parcourir les modes de la routine du jour courant (moins
`retirer`), ignorer ceux dont `appareils` n'inclut pas A, prendre le premier dont la condition
(plus `conditions_en_plus`) est vraie.

### 3.3 Actions par appareil
- PC : `bloquer_domaines` = domaines des apps bloquées (moins `sauf`), dédoublonnés et triés ;
  `verrouiller_session`, `fermer_comptes_hors_travail`.
- iPhone : `bloquer_apps` = identifiants `iphone` des apps bloquées.

### 3.4 Exceptions
Types : `ajoute` (date, libellé, `heure` + `preparation` ou `reveil`, `obligatoire` facultatif,
défaut vrai), `retire` (date, engagement), `decale` (date, engagement, nouvelle heure ; pour un
engagement sans heure, `preparation` facultative, défaut celle de la config, sinon 30 min),
`coucher` (nuit, nouvelle heure de coucher), `avancer_coucher` (nuit, heure = maintenant :
« je vais dormir »). Retirer ou décaler un engagement absent ce jour-là est refusé.
- **Resserrer ou desserrer se juge sur l'effet** (revue du 01/11). Chaque nuit touchée est
  comparée avant / après : de la nuit courante à la nuit de l'exception + 7 (fenêtre de
  régularité des levers : retirer un engagement de jeudi peut reculer le lever de demain, donc le
  coucher de ce soir ; au-delà de 60 nuits, seules la semaine qui suit maintenant et celle autour
  de l'exception). Une nuit est **desserrée** si son coucher appliqué recule, ou si elle a
  commencé (maintenant ≥ coucher) et que son lever avance (la nuit en cours finirait plus tôt).
  Une exception est un **resserrement** si elle ne desserre aucune nuit et n'est pas par nature
  un renoncement (retirer, ou repousser, un engagement obligatoire : raison toujours exigée).
- **Refus nets** (sans friction possible) : réveil d'un engagement ajouté ou décalé avant
  `lever_plancher` (ou la veille au soir : « 00:00 + 600 min » donnait un lever à 14:00 la veille
  et finissait la nuit en cours) ; un lever à venir qui deviendrait un instant passé (« le lever du
  3 nov. passerait à 04:35, déjà passé ») ; `preparation` hors de 0 à 240 min.
- **Resserrer** (coucher plus tôt, engagement ajouté ou avancé le soir, heure donnée à un
  engagement sans heure, sans effet sur la nuit en cours) : toujours permis, sans friction.
- **Engagement facultatif** retiré ou repoussé : libre (friction `aucune`, pas de décision de
  nuit consommée), avant comme après l'ouverture ; refusé seulement si le sommeil prévu passe sous
  `minimum` (avant l'ouverture) ou `plancher_nuit` (après).
- **Desserrer** (coucher plus tard, engagement obligatoire retiré ou repoussé, nuit en cours
  raccourcie) — la friction est celle de la **première nuit desserrée** D (la plus chère ; à
  défaut d'effet, la nuit de l'exception), le plafond de sommeil s'applique à chaque nuit
  desserrée :
  | Moment de la demande | Friction | Plafond de sommeil | Limite |
  |---|---|---|---|
  | avant ouverture(D) | `raison` ≥ 50 caractères (sans phrase) | sommeil prévu ≥ `minimum` | aucune |
  | après ouverture(D), avant lever(D+1) | `raison` ≥ 50 caractères + `phrase` exacte `JE NE PEUX PAS DECALER` | sommeil ≥ `plancher_nuit` | **1 fois** par nuit |

  La décision de nuit est comptée pour la nuit D qu'elle desserre (`nuitDecision` du prix,
  colonne `exceptions.nuit_decision`), pas forcément celle de l'exception. Une seule par nuit,
  garantie aussi par la base (§4.2).
  Pas de desserrage sans raison (décision du 01/11, remplace « sans friction avant
  l'ouverture » du 24/10). La raison est enregistrée avec l'exception. Raison trop courte :
  refus « raison d'au moins 50 caractères exigée (N fournis) » (préfixé « décision de nuit : »
  après l'ouverture).
- **« Je vais dormir »** (`avancer_coucher`, `a` = maintenant) n'est admissible que si
  `a` < coucher appliqué de la nuit ; sinon refus « la nuit a déjà commencé à HH:MM » (heure
  locale du coucher appliqué), sans friction demandée. Elle ne peut jamais repousser le coucher :
  pour coucher plus tard, c'est une exception `coucher` (desserrage, règles ci-dessus).
  Se coucher plus tôt ne déplace jamais le lever (lever fixe, 01/11) : la nuit s'allonge et
  réduit la dette. La popup « rattraper le sommeil » (§4.6) envoie une exception `coucher` plus
  tôt (resserrement, sans friction), car `avancer_coucher` prend toujours l'heure du serveur.
- `prixException(contexte, demande, friction?)` renvoie : admissible ou non (et pourquoi),
  friction exigée (`aucune` | `raison` | `raison_phrase`), `frictionManquante` si seule la
  friction manque (tout le reste est admissible), coucher avant/après, lever avant/après, dette
  de la nuit avant/après (nuit de l'exception), `nuitDecision` (décision de nuit acceptée : la
  nuit consommée ; API : `nuit_decision`). L'API l'expose en `friction_manquante` : l'interface demande l'aperçu
  sans la raison et n'affiche pas ce cas comme un refus.
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

### 3.8 Vérification des engagements
`verifierEngagements(contexte, mesures, du, au)` (mesures : `{ type, debut, fin }`) : pour chaque
jour D de `du` à `au` et chaque engagement vérifiable **prévu** par la routine de D (après exceptions,
plus ceux qu'une exception `retire` a enlevés ce jour-là) → `{ date, engagement, nom, statut }` :
1. `fait` s'il existe au moins une mesure du type déclaré qui commence le jour local D (fuseau de la
   routine de D) ;
2. sinon, s'il est **facultatif** ce jour-là (config ou surcharge de la routine) :
   `facultatif_non_fait` s'il a été retiré ou si D est passé, `a_faire` sinon ;
3. sinon `saute_declare` si une exception `retire` le concernait ce jour-là ;
4. sinon `saute_non_declare` si D est passé (date locale de maintenant > D) ;
5. sinon `a_faire`.
Un engagement sans heure (`heure: libre`) reste vérifiable. `facultatif_non_fait` n'est jamais
compté parmi les sautés. Une exception `ajoute` n'est jamais
vérifiée (pas de champ `verification`).

## 4. L'API

### 4.1 Authentification
`Authorization: Bearer <jeton>`. Jetons stockés **hachés** (SHA-256) dans `appareils`. Types de
jeton : `appareil` (un par appareil ; l'extension prend un jeton `appareil` au nom du PC),
`interface` (web app), `config` (GitHub Actions). Chaque jeton appartient à un utilisateur.
Création par un script local (`npm run jeton:creer -- <appareil|interface|config> <nom>`) qui
affiche le jeton une fois.

Production (01/11) : deux hôtes servis par le même Worker. `focus.fredericguiose.com` (web app et
ses appels, jeton `interface`) est derrière **Cloudflare Access**, et le Worker revérifie le JWT
Access sur toute requête, fichiers statiques compris ; `api-focus.fredericguiose.com` (clients)
n'a pas d'Access, refuse le jeton `interface` (403) et n'a ni les routes réservées à l'interface
ni la web app (404). Tout autre hôte, workers.dev compris, est refusé ; workers.dev est
désactivé. En local, un seul hôte sert tout. Détails, routes par hôte et mise en service :
[mise-en-ligne.md](mise-en-ligne.md).

### 4.2 Points d'entrée v2.0
| Méthode | Chemin | Jeton | Rôle |
|---|---|---|---|
| GET | `/v1/planning` | appareil | planning de l'appareil (§4.3) ; vaut ping (met à jour `vu_le`) |
| POST | `/v1/accuses` | appareil | `{ action, pose_le }` : verrou posé ; `pose_le` à plus de 2 jours de l'heure du serveur : 400 |
| POST | `/v1/evenements` | appareil | lot : `{ type: reconnexion \| acces, ... }` |
| GET | `/v1/statut` | interface | mode par appareil et raison, journée (lever, coucher, ouverture), phase, actions possibles, engagements de demain, dette des 7 dernières nuits, régularité des couchers et des levers, sessions, dernier ping (§4.6) |
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

Décision de nuit (revue du 01/11) : une seule par nuit, garantie par la base — index unique
partiel `exceptions (utilisateur, nuit_decision) WHERE pendant_nuit = 1 AND annulee_le IS NULL`
(migration 0003). `jour` ne convenait pas : c'est la date de l'engagement pour
`ajoute`/`retire`/`decale`, et la nuit consommée peut être celle de ce soir. Deux décisions
simultanées : la seconde reçoit 422 `exception_refusee` (« décision de nuit déjà prise… »).

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
      "question": { "id": "q_07", "posee_a": "…Z", "attente_s": 3, "expire_a": "…Z" },
      "fin_au_plus_tard": "…Z" | null }
  ],
  "raison": "WORK — tâches prioritaires restantes : 2"
}
```
Règles côté client :
- Se caler sur `heure_serveur` (décalage = heure_serveur − horloge locale à la réception).
- Segment en vigueur = celui qui contient l'instant. Au-delà de `valable_jusqua` : tout est
  levé (chaque verrou porte son échéance).
- Domaines bloqués = segment − domaines des sessions valides. Une session est valide tant que
  `question.expire_a` n'est pas passé, ou après un « continue » accepté, et **jamais** à partir de
  `fin_au_plus_tard` (plafond quotidien atteint, ou début du premier mode qui interdit les
  sessions sur l'appareil, dans l'horizon ; null si rien ne la ferme d'ici là), même après un
  « continue ». Pendant un segment avec `verrouiller_session: true` **ou** `sessions:
  "interdites"`, les sessions ne comptent pas (le client applique ces fins lui-même, planning en
  cache compris ; l'API ne renvoie plus de session ouverte quand le mode les interdit).

### 4.4 Tâches planifiées (une seule entrée cron `* * * * *`)
**Cadences** (revue du 01/11, plan gratuit de Workers : 10 ms de CPU et 50 sous-requêtes par
invocation, **D1 compris**, un `db.batch` comptant pour une) : réglables dans le YAML, bloc
facultatif `synchro: { todoist: "2min", xiaomi: "15min", hevy: "1h" }` (valeurs par défaut ;
planchers 1 min, **10 min pour Xiaomi** — API non officielle — et 10 min pour Hevy ; 24 h au plus ;
`cadencesDeSynchro`, défauts appliqués aussi à une config normalisée plus ancienne). Chaque
minute, la tâche ne lance **qu'une seule source lourde** (Todoist, Xiaomi ou Hevy) : parmi celles
qui sont dues (dernier passage tenté il y a au moins la cadence, à 30 s près ; un rattrapage en
cours est dû chaque minute), la plus en retard en temps absolu, à égalité Todoist puis Xiaomi
puis Hevy (`choisirSource`) ; les autres passent à la minute suivante (au plus une minute de
décalage, Todoist toutes les 2 min ne les affame pas). Dernier passage Todoist tenté : clé de
cache `synchro_todoist`. Bornes par passage : Todoist 20 requêtes (au-delà, faits abandonnés,
cache précédent gardé), Xiaomi 16 requêtes de données + 2 de connexion (morceaux de rattrapage :
2 par passage), Hevy 10 pages (rattrapage initial en plusieurs passes, une par minute, reprise à
la page suivante ; une lecture partielle n'efface rien). Les étapes légères (fermeture des
sessions, photos) tournent à chaque minute ; la vérification des étiquettes (2 requêtes, une
fois par jour) jamais avec Xiaomi ni Hevy.
Jeton Todoist : il n'appartient qu'à **un** utilisateur, `TODOIST_UTILISATEUR` (comme Xiaomi et
Hevy) ; sans cette variable, pas de synchro Todoist.
À sa cadence : rafraîchir les faits Todoist en cache (réécrits seulement s'ils changent).
À 00:00 locale (fuseau de la routine du jour qui commence) : **photo des retards** (tâches en
retard à cet instant, toutes priorités, hors exclusions). Au coucher appliqué : photo de la
nuit (table `nuits`, pour l'historique ; sa colonne `lever` = lever du lendemain que le plan
donnait au coucher : c'est le **lever prévu figé** du journal des levers, §3.1). Une fois par jour : vérifier que les étiquettes de la
config existent dans Todoist.
À sa cadence (15 min par défaut), si les secrets `XIAOMI_USER_ID`, `XIAOMI_PASS_TOKEN` et `XIAOMI_UTILISATEUR`
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
renvoyée par le statut et relancée à la cadence suivante ; le jeton n'est jamais journalisé.
**Verrou** : chaque passage prend le verrou `xiaomi:<utilisateur>` (table `verrous`, échéance
5 min) ; un second passage simultané (deux crons) ne fait rien. Sans lui, les deux feraient
tourner le passToken en même temps et l'un garderait un jeton déjà périmé.

**Rattrapage de l'historique.** Lancé au premier passage (pas d'état de rattrapage dans
`synchro_xiaomi`, ou aucune mesure Xiaomi pour l'utilisateur et dernier rattrapage lancé il y a plus
d'un jour) depuis `XIAOMI_DEPUIS` (date `AAAA-MM-JJ`, UTC) ou, à défaut, 60 jours en arrière ; et
quand des nuits récentes manquent (dernière lecture réussie des 3 jours antérieure au début de la
fenêtre : la synchro n'a pas tourné pendant plus de 3 jours), depuis cette lecture moins un jour.
Lecture du plus récent au plus ancien, par morceaux de 10 jours (recouvrement de 12 h), 2 morceaux
au plus par passage, une seule connexion par passage, 16 requêtes de données au plus. Tant qu'il reste des morceaux et que le dernier passage a réussi, la tâche
reprend à la minute suivante ; le curseur (`rattrapage.curseur`) n'avance qu'après un morceau
écrit, donc une panne reprend là où elle s'est arrêtée, à la cadence suivante. Les 3 derniers jours
restent lus à la cadence (`recente_le`).

**passToken tournant.** Xiaomi renvoie un passToken à chaque connexion (champ `passToken` de la
réponse, sinon cookie). Si le secret `CLE_CHIFFREMENT` est posé, le plus récent est gardé dans le
cache (clé `jeton_xiaomi`) chiffré en AES-GCM 256 (Web Crypto ; clé dérivée par HKDF-SHA-256 du
secret ; IV aléatoire de 12 octets ; données associées `jeton_xiaomi:<utilisateur>:<userId>`), et
il sert de préférence au secret `XIAOMI_PASS_TOKEN`. Refusé (`jeton_xiaomi_expire`) : il est
effacé et le passage reprend avec le secret ; le jeton reçu ensuite le remplace. Sans
`CLE_CHIFFREMENT` : rien n'est gardé, le secret sert toujours. Ni le jeton ni la clé ne sont
journalisés ou renvoyés par l'API.

À sa cadence (1 h par défaut), si les secrets `HEVY_API_KEY` et `HEVY_UTILISATEUR` sont posés : **séances
mesurées** (`api/src/hevy.ts`, lecture seule ; API publique officielle de Hevy, comptes Pro,
doc https://api.hevyapp.com/docs/, clé dans l'en-tête `api-key`). Même règle de compte que Xiaomi :
seul `HEVY_UTILISATEUR` est synchronisé. `GET /v1/workouts` est paginé (10 au plus) et n'a pas de
filtre de date : lecture de la page 1 jusqu'à la première page qui contient une séance antérieure
à la période (les séances arrivent de la plus récente à la plus ancienne ; 10 pages par passage :
au-delà, l'état `rattrapage: { depuis, page }` reprend au passage suivant, sans rien effacer).
Période : les 7 derniers jours ; au premier passage (aucune synchro réussie), 60 jours ; après une
panne, depuis la dernière réussite moins un jour (60 jours au plus). Chaque séance, normalisée en
`{ id, debut, fin, titre }`, est rangée dans `mesures` (`type = seance`, `source = hevy`, `cle` =
identifiant Hevy, `valeur` = durée en minutes, `details` = `{ titre }`) : insérée, mise à jour si
elle a changé ; une séance de la période absente de la réponse (supprimée chez Hevy) est effacée.
État dans le cache (`synchro_hevy`) ; clé refusée (HTTP 401/403) : erreur `cle_hevy_refusee`,
relancée à la cadence suivante. La clé n'est jamais journalisée. Secrets absents : étape sautée.

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
- **Fins imposées** (revue du 01/11) : une session est fermée, même gardée en vie par des
  « continue », (1) quand le mode de son appareil passe à `sessions: interdites` (nuit, matin
  verrouillé) — `motif_fin = mode_interdit`, `fermee_le` = début de l'interdiction — et (2) quand
  le plafond quotidien est atteint — `motif_fin = plafond_atteint`, `fermee_le` = l'instant où le
  cumul du jour atteint le plafond (le cumul avance d'autant de secondes par seconde qu'il y a de
  sessions de travail ouvertes). La fermeture a lieu à chaque lecture (`cloturerEchues`) et à
  chaque minute par la tâche planifiée. Un « continue » sur une session ainsi fermée : 409
  `session_fermee` avec `motif_fin`. Chaque session ouverte porte `fin_au_plus_tard` = min(fin
  par le plafond, début du premier segment qui interdit les sessions dans les 36 h), pour que le
  client l'applique hors ligne (§4.3).

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
    "decaler_coucher": { "mode": "raison" | "decision_de_nuit" | "indisponible", "motif": string | null }
  },
  "engagements_demain": [
    { "id": "sport", "nom": "Sport", "reveil": "…Z" | null, "heure": "…Z" | null,
      "obligatoire": bool, "sans_heure": bool, "origine": "routine" | "exception" }
  ],
  "nuits": [ { "nuit": "YYYY-MM-DD", "dette_min": number, "dette_reelle_min": number | null,
               "endormi_min": number | null, "incomplete": bool,
               "phases": { "legere", "profonde", "rem", "eveil" } | null,
               "siestes_min": number, "siestes": [ { "debut": "…Z", "fin": "…Z", "minutes": number } ] } ],
  "dette_cumulee_min": number,
  "dette_semaine": { "debut": "YYYY-MM-DD", "fin": "YYYY-MM-DD", "dette_min": number, "rattrape_min": number,
                     "reste_min": number, "nuits_restantes": number, "nuits_mesurees": number, "nuits_total": number },
  "bilans_semaines": [ { "debut", "fin", "dette_min", "rattrape_min", "non_rattrape_min",
                         "nuits_mesurees", "nuits_total" } ],
  "siestes_total_min": number, "siestes_du_jour": [ { "debut", "fin", "minutes" } ], "siestes_du_jour_min": number,
  "sieste_tardive": { "fin": "…Z", "coucher": "…Z" } | null,
  "objectif_sommeil_min": number,
  "levers": { "jours": [ { "date": "YYYY-MM-DD", "prevu": "…Z", "prevu_fige": bool,
                           "mesure": "…Z" | null, "ecart_min": number | null,
                           "ignore"?: "decalage_horaire" } ],
              "amplitude": { "plus_tot": "…Z", "plus_tard": "…Z", "ecart_min": number, "mesures": number } | null,
              "limite_min": number },
  "couchers": { "nuits": [ { "nuit": "YYYY-MM-DD", "prevu": "…Z", "prevu_fige": bool,
                             "mesure": "…Z" | null, "ecart_min": number | null,
                             "ignore"?: "decalage_horaire" } ],
                "amplitude": { "plus_tot": "…Z", "plus_tard": "…Z", "ecart_min": number, "mesures": number } | null,
                "limite_min": number },
  "sommeil_mesure": { "derniere_synchro": "…Z" | null, "erreur": string | null } | null,
  "aujourdhui": "YYYY-MM-DD",
  "engagements_verifies": [ { "date", "engagement", "nom",
                              "statut": "fait" | "saute_declare" | "saute_non_declare"
                                        | "facultatif_non_fait" | "a_faire" } ],
  "sautes_semaine": number,
  "seances_mesurees": { "derniere_synchro": "…Z" | null, "erreur": string | null } | null,
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
- `decaler_coucher` : `raison` avant l'ouverture (desserrer demande une raison, resserrer reste
  libre) ; `decision_de_nuit` après, si elle n'a pas été
  prise pour la nuit J (motif « soirée ouverte depuis HH:MM ») ; `indisponible` sinon (motif
  « décision de nuit déjà prise pour la nuit du 3 nov. (une seule par nuit) »). Indicatif : le prix exact passe par
  `/v1/exceptions/prix`.
- `engagements_demain` : `engagementsPrevus(contexte, J + 1)` du moteur, exceptions appliquées
  (un engagement décalé garde l'origine `routine`). `nom` : libellé pour une exception `ajoute`,
  sinon l'identifiant avec une majuscule. `obligatoire` : retirer ou repousser demande une raison ;
  `sans_heure` (= `reveil` null) : il ne fixe pas le réveil. La web app propose **tous** les
  engagements de demain à « Retirer » et « Décaler » ; pour un engagement sans heure, « Décaler »
  devient « Donner une heure ». « Ajouter » a un interrupteur « Facultatif » (défaut obligatoire).
- `nuits` : les 7 nuits terminées J−7 … J−1, de la plus ancienne à la plus récente, `dette_min` =
  `journee(D).detteNuitMin` recalculée par le moteur avec la config active et les exceptions
  enregistrées ; `dette_cumulee_min` = leur somme.
- **Dette réelle** (sommeil mesuré, §4.4) : `dette_reelle_min` = cible − temps endormi de la nuit
  (somme des sessions de la nuit, siestes exclues ; null sans mesure). Une session appartient à
  la nuit du jour du soir : date locale de son milieu moins 12 h. **Rendormissement** (01/11) :
  une session qui commence moins d'une heure après la fin d'une session de nuit prolonge cette
  nuit (même rattachement), même si elle tombe après le lever prévu ou que la montre la marque
  sieste ; une session plus d'une heure après reste une sieste. `phases` : minutes par phase,
  cumulées sur la nuit.
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
- **Dette hebdomadaire** (CDC §4, 01/11 ; règle comptable, pas biologique : la récupération
  réelle est partielle, d'où « objectif du soir atteint » et jamais « dette remboursée ») :
  semaine du lundi au dimanche en dates locales ; une nuit appartient à la semaine du **matin**
  où elle se termine : la nuit D compte pour la semaine de D + 1 (`lundiDeLaNuit`). La nuit de
  dimanche à lundi ouvre donc la semaine, celle de samedi à dimanche la clôt : la semaine se clôt
  vraiment le dimanche (règle validée par Frédéric, « c'est mieux et plus compréhensif »). Par
  semaine, sur les nuits finies :
  `dette_min` = Σ (cible − endormi) > 0 des nuits mesurées ; `rattrape_min` = Σ (endormi − cible)
  > 0 + les siestes rangées sur les nuits de la semaine, une sieste rattrapant la nuit d'avant :
  celle de la journée D + 1 compte pour la nuit D, donc pour la même semaine (la sieste du lundi
  rattrape la nuit de dimanche à lundi : nouvelle semaine, comme dans le graphique) ; reste = max(0, dette − rattrapé). Une nuit
  non mesurée ne compte ni en dette ni en surplus (sa sieste du lendemain compte) ; elle se voit
  dans `nuits_mesurees` / `nuits_total`. `dette_semaine` : semaine de la nuit de ce soir (J → J +
  1 ; le dimanche soir, c'est déjà la semaine suivante, encore vide : pas de dette, pas de
  popup), nuits finies (du dimanche soir d'ouverture à J − 1) et siestes jusqu'à aujourd'hui ;
  `nuits_restantes` = de la nuit J (ce soir) à celle de samedi à dimanche, incluses (7 le
  dimanche soir, 6 le lundi, 1 le samedi). `bilans_semaines` : les 4 semaines closes, la
  plus récente d'abord (`non_rattrape_min` = reste). Rien n'est stocké : tout est recalculé à
  chaque statut à partir des mesures (le sommeil est relu jusqu'au dimanche soir qui ouvre la
  plus ancienne semaine close, `nuitsALire`, et
  `moteur.journee` pour chaque jour sert à reconnaître les siestes). Conséquence assumée : changer
  `sommeil.cible` ou réimporter des mesures réécrit les bilans passés. Calcul pur dans
  `core/src/dette.ts` (`lundiDeLaNuit`, `compteSemaine`, `dettesHebdomadaires`), partagé par l'API et le mode
  simulé de la web app. Remplace `dette_cumulee_reelle_min` (fenêtre glissante de 7 nuits, qui
  oubliait une dette au bout de 7 jours), supprimé.
- **Popup « rattraper le sommeil »** (web app, facultative, CDC §4 01/11) : une fois par soir, à
  la première ouverture du tableau de bord après l'ouverture de la soirée (phase `soiree`, avant
  le coucher appliqué, coucher pas déjà avancé, pas de décision de nuit, au moins un quart d'heure
  à gagner), si `dette_semaine.reste_min` > 5 min. Objectif du soir = reste ÷ `nuits_restantes`,
  arrondi au quart d'heure supérieur, entre 15 min et 1 h. Titre « Ce soir : 45 min de sommeil en
  plus », sous-titre « Cette semaine : 3 h à rattraper, sur 4 nuits » (« sur cette dernière
  nuit » le samedi). Le curseur (heures de quart d'heure en quart d'heure, du coucher appliqué
  à maintenant arrondi) démarre sur l'heure suggérée : la plus tardive qui atteint l'objectif
  (coucher − objectif), sinon la plus tôt ; il se déplace dans les deux sens. Barre verte :
  progression vers l'objectif du soir (0 → 100 %, pleine au-delà) ; texte « +30 min · objectif du
  soir 45 min », puis « +45 min · objectif du soir atteint » (icône check). « Je me couche à
  HH:MM » envoie l'exception `coucher` ; « Me coucher maintenant » = « Je vais dormir ».
- **Carte « Sommeil »** de la web app : temps dormi de la dernière nuit mesurée (« Cette nuit »
  si c'est J−1, sinon « Nuit du … »), écart à l'objectif en mots (« 29 min de moins que
  l'objectif », « … de plus … », « objectif atteint » à 5 min près), phases léger → REM → profond
  et éveil à part ; puis « Cette semaine » (`dette_semaine`, si une nuit de la semaine est
  mesurée) en pastilles : « 3 h 10 manquées » moins « 1 h 05 rattrapées » (infobulle « Nuits
  plus longues et siestes ») = « 2 h 05 à rattraper », ou « tout rattrapé » / « objectif atteint »
  en vert (à 5 min près), « n/total mesurées » si une nuit finie n'est pas mesurée ; dessous, une
  ligne de tendance face à la semaine close la plus récente (`bilans_semaines[0]`), comparée par
  nuit mesurée (manque net moyen) : flèche + « 10 min de manque en plus/en moins par nuit que la
  semaine dernière » ou « comme la semaine dernière » (à 5 min près) ; puis « 7 dernières nuits »
  en barres (heures dormies, trait de l'objectif, pas de barre sans mesure, barre pâle si
  incomplète). Pas de tableau des semaines passées (01/11 : « pas besoin de les afficher », juste
  plus ou moins que la dernière) ; `bilans_semaines` reste dans l'API. Participes accordés à la durée, jamais de
  signe collé aux chiffres. Elle ne montre plus la dette prévue (`dette_min`, toujours renvoyée) ; le coucher prévu est dans « Ce soir ».
  Siestes : le chiffre de la dernière nuit reste la nuit seule ; dessous, si la nuit manque
  l'objectif et que la journée qui la suit a une sieste (`siestes_du_jour` pour « Cette nuit »,
  sinon `siestes` de la nuit suivante) : « 29 min de moins que l'objectif, dont 20 min rattrapées
  en sieste », plafonné à l'écart (« …, rattrapées en sieste » si la sieste le couvre). Dans le
  graphique, la sieste de la journée D + 1 est un segment vert empilé au-dessus de la barre de la
  nuit D, qu'elle rattrape (légende « sieste », infobulle « 7 h 12 de nuit + 1 h 05 de sieste »).
  `sieste_tardive` : note discrète
  « Sieste tardive : vous endormir à 21:30 pourrait être plus difficile. »
- **Levers mesurés** : à chaque chargement du contexte, l'API lit les sessions de sommeil des
  15 derniers jours, écarte les siestes (même règle que ci-dessus, avec les journées du **plan**
  sans mesure, pour que le lever ne dépende pas de lui-même) et prend, pour chaque nuit D−1, la
  fin de sa dernière session : c'est le lever mesuré de D (`contexte.leversMesures`). Une nuit
  marquée incomplète par la montre ne donne pas de lever (sa fin n'est pas un réveil sûr), ni
  une session qui finit après maintenant, ni une nuit dont la dernière session a fini il y a
  moins d'une heure (un rendormissement peut encore suivre). La nuit = de la première session au
  dernier réveil qui n'est pas suivi d'un rendormissement dans l'heure. Ce lever mesuré ne finit
  jamais la nuit en cours (§3.1) : il ne sert qu'aux jours suivants, à la dette et aux journaux.
- **Endormissements mesurés** : pour chaque nuit D, celle de la dette réelle (mêmes sessions,
  siestes écartées de la même façon), le début de sa **première session** ; si la chronologie
  Xiaomi est gardée, le début de sa première tranche de sommeil (léger, profond ou REM) : la
  montre ouvre parfois la session sur une tranche d'éveil, qui n'est pas encore le sommeil. Une
  nuit marquée incomplète ne donne pas d'endormissement (comme pour le lever : montre mise en
  retard, début peu sûr).
- `couchers` : `journalDesCouchers(contexte, J, endormissements, prévus figés)` (§3.1) ; prévus
  figés = colonne `coucher_prevu` des photos de la table `nuits` (le prévu, pas l'appliqué :
  un coucher décalé par exception compte donc comme un écart).
- `levers` : `journalDesLevers(contexte, J, prévus figés)` (§3.1) ; prévus figés = colonne
  `lever` des photos de la table `nuits` (nuit D−1 → lever de D). Carte **« Régularité »** de la
  web app, onglets « Couchers » (ouvert par défaut) et « Levers », même présentation : pour les
  couchers, « Endormissements sur 7 nuits : de 22:10 à 01:12 · écart 3 h 02 (repère 2 h) »
  (orange au-delà du repère, sans phrase de plus : ce n'est pas une règle ; « · 2 nuits
  exclues » en cas de décalage horaire), puis une ligne par nuit (date du soir) : heure
  d'endormissement et « 3 h 12 plus tard que prévu (22:00) », « comme prévu », « prévu 22:00, pas
  de mesure » ou « décalage horaire, non compté ». Sans `couchers` (API plus ancienne), les
  levers seuls, sans onglets. Pour les levers : « Levers sur 7 jours : de 04:32 à 06:10 · écart 1 h 38 (limite
  2 h) » (« écart 2 h 20, au-dessus de la limite de 2 h » en orange ; « pas encore assez de
  mesures » sous 2 mesures), puis une ligne par jour : heure mesurée, et « comme prévu » (à 5 min
  près), « 20 min plus tard que prévu (05:50) », « 8 min plus tôt que prévu (04:30) », ou
  « prévu 04:30, pas de mesure » (« pas encore mesuré » aujourd'hui), ou « décalage horaire, non
  compté » (heure grisée) ; le résumé finit alors par « · 2 jours exclus ».
- **Engagements vérifiés** (§3.8) : `aujourdhui` = date civile de maintenant dans le fuseau de la
  journée courante ; `engagements_verifies` = `verifierEngagements` sur les séances mesurées, des 7
  derniers jours à la fin de la semaine en cours (dimanche) : les jours après aujourd'hui sont
  `a_faire` (« à venir » pour l'interface). `sautes_semaine` = nombre de `saute_declare` +
  `saute_non_declare` du lundi à aujourd'hui (information seulement, rien n'est bloqué ;
  `facultatif_non_fait` n'y entre jamais).
  `seances_mesurees` : dernière synchro Hevy réussie et code d'erreur (null si jamais tentée).
- **Carte « Engagements »** de la web app : pour aujourd'hui, chaque engagement vérifiable et son
  état (✓ vert fait, ✗ orange à faire, gris annulé à l'avance) ; puis la semaine lun → dim en cases
  pour les jours prévus (fait, annulé à l'avance, sauté sans l'annuler en rouge, non faite
  (facultative) en gris pointillé, à venir) et « N séances sautées cette semaine ». Clé Hevy refusée : avertissement.
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

### 4.7 Résultats gardés 60 s (statut, planning) et CPU

Plan gratuit de Workers (vérifié le 01/11 sur developers.cloudflare.com/workers/platform/limits) :
10 ms de CPU par requête HTTP comme par cron, 50 sous-requêtes par invocation, D1 compris (un
`db.batch` compte pour une ; 50 requêtes D1 par invocation). Décision de Frédéric : « toutes les
minutes ça suffit ».
- **Cache** : table `cache_calculs (utilisateur, cle, valeur, calcule_le, expire_le)` (migration
  0003). `GET /v1/statut` est gardé par utilisateur (`statut`), `GET /v1/planning` par appareil
  (`planning:<appareil>`), au plus 60 s **et jamais au-delà de leur prochaine bascule** (fin du
  premier segment, ouverture, coucher, lever, échéance d'une question ou fin d'une session).
  `heure_serveur` n'est jamais gardée : recalculée à chaque requête (décalage d'horloge des
  clients). Le cache n'est actif que dans le Worker (`cacheCalculs: true` dans `src/index.ts`) ;
  les tests l'activent explicitement (`test/revue.test.ts`).
- **Invalidation** : toute écriture qui change l'état efface les lignes de l'utilisateur et
  incrémente un compteur de génération (ligne `~generation`) dans le même `db.batch` : exception,
  ouverture / « continue » / « arrête » / ajout d'app / fermeture de session, fermeture
  automatique (`cloturerEchues`), config reçue, synchro Todoist qui change les faits, sommeil ou
  séances qui changent des lignes, photo des retards, photo de la nuit ; l'horloge de
  développement efface tout. Un résultat calculé pendant une écriture n'est pas gardé : il n'est
  écrit que si la génération lue avant le calcul n'a pas changé. Les accusés ne changent rien de
  ce que lisent statut et planning : pas d'invalidation.
- **CPU** (mesure : moteur seul, script `cpu.ts` de la revue — mêmes calculs que le statut
  complet, contexte reparsé à chaque appel, Node 22, médiane de 20 appels après 5 de chauffe ; et
  durée murale de bout en bout dans miniflare, `perf.test.ts`) : le temps passait à 70 % dans
  `Intl.DateTimeFormat.formatToParts` (décalage des fuseaux). Le décalage est maintenant gardé
  par quart d'heure UTC (`temps.ts`, exact : les changements d'heure tombent sur un quart d'heure
  UTC ; test minute par minute autour des changements d'heure de Paris, Lord Howe, Katmandou…).
  Statut, moteur seul : 11,5 ms → 3,7 ms (4,7 ms cache des fuseaux vide) ; planning : 1,1 →
  0,5 ms. Bout en bout dans miniflare (I/O D1 locale comprise, après le premier appel) : statut
  15-19 → 10-14 ms, planning 3-5 → 2-5 ms. Le statut non gardé reste proche de la limite (JSON
  de la config, sommeil, 17 journées des levers mesurés) : le cache en fait un calcul par minute
  au plus.

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
- Comptes libres : Linux, fermer/verrouiller leurs sessions ; Windows, déconnecter leurs sessions
  (jamais de compte désactivé, 01/11 : pas de risque d'être enfermé dehors si le service plante).
- Service : `kardianos/service`. Questions : `ncruces/zenity` (sous Linux, le programme
  `zenity` doit être installé).
- Règle : une bibliothèque multi-plateforme d'abord ; sinon une fonction en deux fichiers
  (`_linux.go`, `_windows.go`) derrière la même interface. Bibliothèques vérifiées avant ajout.

## 6. Web app et extension
- Web app (React + Vite, composants shadcn/ui), servie comme fichiers statiques par le Worker,
  derrière Cloudflare Access (§4.1) ; elle appelle l'API en relatif (même origine).
  Écrans v2.0 : statut, exceptions (avec aperçu du prix), décision de nuit, sessions, dernier
  ping. Installable en PWA. Jeton `interface` saisi une fois.
- Une seule règle de couleurs pour un fait (parcours, carte du mode, tableau des appareils) :
  ✓ vert = fait ; ✗ orange = à faire, c'est ce qui bloque ; horloge grise = heure pas encore
  atteinte (rien à faire). Les motifs de l'API (minuscule initiale, sans point) prennent une
  majuscule quand ils sont affichés seuls.
- Extension (Manifest V3, Chrome) : **interface seulement**, ne bloque rien. Quand un onglet
  échoue sur un domaine bloqué, elle demande la raison à l'API et affiche une page avec la
  raison et un bouton pour ouvrir une session.
  Elle appelle l'hôte des clients (`api-focus.…`) avec un jeton `appareil` au nom du PC.
