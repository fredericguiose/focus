// Champs que GET /v1/statut renvoie (premier niveau, journée, appareil). Un test API vérifie cette
// liste sur une réponse réelle (test/statut.test.ts) ; la web app vérifie qu'elle reprend chacun de
// ces champs dans sa conversion (web/src/api/http.test.ts). Un champ ajouté à l'API sans être
// repris par l'interface fait donc échouer un test, au lieu de disparaître en silence.

export const CLES_STATUT = [
  'heure_serveur',
  'config_version',
  'journee',
  'phase',
  'actions',
  'engagements_demain',
  'nuits',
  'dette_cumulee_min',
  'dette_semaine',
  'bilans_semaines',
  'siestes_total_min',
  'siestes_du_jour',
  'siestes_du_jour_min',
  'sieste_tardive',
  'objectif_sommeil_min',
  'sommeil_mesure',
  'levers',
  'couchers',
  'aujourdhui',
  'engagements_verifies',
  'sautes_semaine',
  'seances_mesurees',
  'agenda',
  'appareils',
  'appareil_principal',
  'sessions',
  'sessions_du_jour',
  'todoist',
  'taches_bloquantes',
] as const;

export const CLES_JOURNEE = [
  'date',
  'routine',
  'fuseau',
  'engagements',
  'lever',
  'lever_suivant',
  'coucher_prevu',
  'coucher_applique',
  'ouverture',
  'prix_du_report_min',
  'dette_nuit_min',
  'decision_de_nuit_prise',
] as const;

export const CLES_APPAREIL = [
  'nom',
  'type',
  'mode',
  'sessions',
  'session_possible',
  'session_motif',
  'raison',
  'actions',
  'apps_bloquees',
  'groupes_bloques',
  'dernier_ping',
  'jusqua',
  'parcours',
  'sortie',
] as const;
