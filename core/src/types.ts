// Contrats du moteur (docs/conception.md). Le moteur est pur : aucune entrée/sortie, aucune
// horloge système ; l'instant et les faits sont des paramètres.

/** Instant UTC en ISO 8601, ex. "2026-11-03T09:30:00Z". */
export type Instant = string;
/** Date locale "YYYY-MM-DD" (dans le fuseau de la routine). */
export type DateLocale = string;
/** Heure locale "HH:MM". */
export type HeureLocale = string;
export type Priorite = 'p1' | 'p2' | 'p3' | 'p4';
export type JourSemaine = 'lun' | 'mar' | 'mer' | 'jeu' | 'ven' | 'sam' | 'dim';
export type TypeAppareil = 'pc_linux' | 'pc_windows' | 'iphone';

// ─── Configuration (après validation et normalisation) ───────────────────────

/** Durées normalisées en minutes. */
export interface ConfigSommeil {
  cibleMin: number;
  minimumMin: number;
  plancherNuitMin: number;
  /** Plancher du lever d'un jour sans engagement à heure. */
  leverPlancher: HeureLocale;
  /** Délai d'endormissement : coucher = lever − cible − endormissement (défaut 0). */
  endormissementMin: number;
  /** Écart maximal entre les levers de deux jours d'une même fenêtre de 7 jours (défaut 2 h). */
  ecartLeverMaxMin: number;
}

/** Types de mesure que les sources (adaptateurs de l'API) rangent dans `mesures`. */
export const TYPES_DE_MESURE = ['sommeil', 'seance'] as const;
export type TypeMesure = (typeof TYPES_DE_MESURE)[number];

export interface Engagement {
  /** Réveil donné directement, ou calculé = heure − préparation. Absent = sans heure. */
  reveil?: HeureLocale;
  heure?: HeureLocale;
  preparationMin?: number;
  /** Obligatoire : le retirer ou le repousser est un desserrage (raison exigée). Facultatif : libre. */
  obligatoire: boolean;
  /** Fait vérifié par une mesure de ce type le jour même ; absent = engagement non vérifié. */
  verification?: { mesure: TypeMesure };
}

export interface App {
  nom: string;
  domaines: string[];
  iphone?: string;
}

export interface Appareil {
  type: TypeAppareil;
  comptesDeTravail: string[];
}

export type Condition =
  | 'toujours'
  | 'planning_fait'
  | 'recap_fait'
  | 'prioritaires_faites'
  | 'aucun_retard'
  | { heure: { apres?: string; avant?: string; decalePar?: 'prix_du_report' } }
  | { nombreDeTaches: { filtre: FiltreTaches; auPlus: number } }
  | { tous: Condition[] }
  | { unParmi: Condition[] }
  | { pas: Condition };

export interface FiltreTaches {
  jour: 'aujourd_hui' | 'retard' | 'les_deux';
  priorites?: Priorite[];
  etiquettesIncluses?: string[];
  etiquettesExclues?: string[];
}

export interface Effets {
  /** 'tout' ou liste d'identifiants de groupes ou d'apps. */
  bloque?: 'tout' | string[];
  sauf?: string[];
  verrouillerSession?: boolean;
  fermerComptesHorsTravail?: boolean;
}

export interface Mode {
  quand: Condition;
  effets: Effets;
  /** Absent = tous les appareils. */
  appareils?: string[];
  sessions: 'autorisees' | 'interdites';
  /** Valeurs par défaut des paramètres ($ouverture…). */
  parametres?: Record<string, string>;
}

export interface JourRoutine {
  engagements?: string[];
  parametres?: Record<string, Record<string, string>>;
  conditionsEnPlus?: Record<string, Condition[]>;
  retirer?: string[];
}

export interface Routine {
  fuseau: string;
  modes: string[];
  reveilLibre?: HeureLocale;
  engagements?: Record<string, Partial<Engagement> | { sansHeure: true; obligatoire?: boolean }>;
  parametres?: Record<string, Record<string, string>>;
  jours: Partial<Record<JourSemaine, JourRoutine>>;
}

export interface PlageCalendrier {
  routine: string;
  du: DateLocale;
  au: DateLocale;
}

export interface ConfigTodoist {
  etiquettePlanning: string;
  etiquetteRecap: string;
  recapToleranceJours: number;
  prioritaires: Priorite[];
  etiquettesExclues: string[];
}

export interface ConfigPrixReport {
  parReportMin: number;
  plafondMin: number;
  commentaireMin: number;
  deadline: { reportsMax: number; joursMinimum: number };
}

export interface Config {
  version: 1;
  utilisateur: string;
  sommeil: ConfigSommeil;
  reveilLibre: HeureLocale;
  engagements: Record<string, Engagement>;
  apps: Record<string, App>;
  groupes: Record<string, string[]>;
  appareils: Record<string, Appareil>;
  modes: Record<string, Mode>;
  routines: Record<string, Routine>;
  routineParDefaut: string;
  calendrier: PlageCalendrier[];
  todoist: ConfigTodoist;
  prixDuReport: ConfigPrixReport;
  sessions: {
    plafondQuotidienMin: number;
    attentesS: number[];
    delaiNouvelleTacheMin: number;
    expirationQuestionS: number;
    intervalleQuestionMin: { pc: number; iphone: number };
  };
}

export type ResultatValidation =
  | { ok: true; config: Config }
  | { ok: false; erreurs: string[] };

// ─── Faits venus de l'extérieur ──────────────────────────────────────────────

export interface Tache {
  id: string;
  contenu: string;
  priorite: Priorite;
  etiquettes: string[];
  echeance: DateLocale | null;
  deadline: DateLocale | null;
  terminee: boolean;
  termineeLe: Instant | null;
  creeeLe: Instant;
  assigneeAMoi: boolean;
}

export interface Report {
  tacheId: string;
  priorite: Priorite;
  le: Instant;
  de: DateLocale;
  vers: DateLocale;
  deadline: DateLocale | null;
  deadlinePoseeLe: Instant | null;
  reportsPrecedents: number;
  /** Un commentaire ≥ commentaire_min caractères dans les 3 jours avant le report. */
  documente: boolean;
}

export interface FaitsTodoist {
  recupereLe: Instant;
  taches: Tache[];
  reports: Report[];
  /** Photo des retards prise à 00:00 locale, par date. */
  photosRetards: Record<DateLocale, string[]>;
}

// ─── Exceptions et sessions ──────────────────────────────────────────────────

export type DemandeException =
  | { type: 'ajoute'; date: DateLocale; libelle: string; heure?: HeureLocale; preparationMin?: number; reveil?: HeureLocale; obligatoire?: boolean }
  | { type: 'retire'; date: DateLocale; engagement: string }
  /** `preparationMin` ne sert que pour un engagement sans heure (défaut : celle de la config, sinon 30). */
  | { type: 'decale'; date: DateLocale; engagement: string; heure: HeureLocale; preparationMin?: number }
  | { type: 'coucher'; nuit: DateLocale; heure: HeureLocale }
  | { type: 'avancer_coucher'; nuit: DateLocale; a: Instant };

export interface Exception {
  id: string;
  demande: DemandeException;
  creeeLe: Instant;
  raison?: string;
  /** Vrai si demandée après l'ouverture de la soirée (décision de nuit). */
  pendantNuit: boolean;
}

export interface FrictionFournie {
  raison?: string;
  phrase?: string;
}

export interface PrixException {
  admissible: boolean;
  motifRefus?: string;
  /** 'raison' : desserrer avant l'ouverture ; 'raison_phrase' : décision de nuit. */
  friction: 'aucune' | 'raison' | 'raison_phrase';
  /** Vrai si seule la friction manque : tout le reste est admissible. */
  frictionManquante?: boolean;
  resserre: boolean;
  coucherAvant: Instant;
  coucherApres: Instant;
  leverAvant: Instant;
  leverApres: Instant;
  detteAvantMin: number;
  detteApresMin: number;
}

// ─── Contexte et résultats ───────────────────────────────────────────────────

export interface Contexte {
  config: Config;
  maintenant: Instant;
  faits: FaitsTodoist;
  exceptions: Exception[];
  /**
   * Levers mesurés (fin de la nuit principale, montre), rangés par date du lever. Un jour mesuré
   * a pour lever sa mesure ; elle borne aussi les levers prévus des jours suivants (§3.1).
   */
  leversMesures?: Record<DateLocale, Instant>;
}

export interface Journee {
  date: DateLocale;
  routine: string;
  fuseau: string;
  engagements: string[];
  lever: Instant;
  leverSuivant: Instant;
  coucherPrevu: Instant;
  coucherApplique: Instant;
  ouverture: Instant;
  prixDuReportMin: number;
  detteNuitMin: number;
  decisionDeNuitPrise: boolean;
}

/** Engagement d'un jour, exceptions appliquées (un décalage garde l'origine `routine`). */
export interface EngagementPrevu {
  id: string;
  /** Libellé pour une exception `ajoute`, sinon l'identifiant avec une majuscule. */
  nom: string;
  reveil: Instant | null;
  heure: Instant | null;
  obligatoire: boolean;
  origine: 'routine' | 'exception';
}

export interface ActionsPc {
  bloquer_domaines: string[];
  verrouiller_session: boolean;
  fermer_comptes_hors_travail: boolean;
}

export interface ActionsIphone {
  bloquer_apps: string[];
}

export interface EtatAppareil {
  journee: Journee;
  mode: string;
  sessions: 'autorisees' | 'interdites';
  actions: ActionsPc | ActionsIphone;
  /** Phrase lisible : pourquoi ce mode. */
  raison: string;
}

export interface Segment {
  debut: Instant;
  fin: Instant;
  mode: string;
  sessions: 'autorisees' | 'interdites';
  actions: ActionsPc | ActionsIphone;
}

export type TypeConditionExpliquee = 'toujours' | 'heure' | 'planning' | 'recap' | 'prioritaires' | 'retard' | 'taches';

/** Une condition d'un mode, jugée à l'instant du contexte. Libellé lisible, sans identifiant. */
export interface ConditionExpliquee {
  type: TypeConditionExpliquee;
  libelle: string;
  vraie: boolean;
  /** Ce qui reste, ex. « 2 restantes » ; null si rien à signaler. */
  detail: string | null;
  /** Condition d'heure : l'instant où le fait (plage horaire) devient vrai (null sinon). */
  a: Instant | null;
  /** Le mode exige le contraire du fait (`pas`) : `vraie` reste l'état du fait. */
  niee: boolean;
}

/** Un mode de la routine du jour, dans l'ordre de priorité, et pourquoi il gagne ou non. */
export interface ModeExplique {
  mode: string;
  nom: string;
  /** Faux si `appareils` exclut l'appareil ou si `retirer` l'enlève ce jour. */
  applicable: boolean;
  actif: boolean;
  conditions: ConditionExpliquee[];
  /** `pas` : le mode s'applique tant que ses conditions (faits positifs, `niee`) ne sont pas vraies. */
  logique: 'tous' | 'un_parmi' | 'pas' | 'simple';
}

/** Comment on sort du mode actuel. */
export interface SortieMode {
  texte: string;
  /** Vrai seulement si la sortie ne dépend que de l'heure. */
  certaine: boolean;
  /** Le prochain changement certain (coucher, lever, ou heure d'un mode prioritaire). */
  auPlusTard: Instant;
}

// ─── Vérification des engagements ────────────────────────────────────────────

/** Une mesure venue d'une source (séance, sommeil…), réduite à ce que le moteur juge. */
export interface Mesure {
  type: TypeMesure;
  debut: Instant;
  fin: Instant | null;
}

export type StatutEngagement = 'fait' | 'saute_declare' | 'saute_non_declare' | 'facultatif_non_fait' | 'a_faire';

export interface EngagementVerifie {
  date: DateLocale;
  engagement: string;
  nom: string;
  statut: StatutEngagement;
}

// ─── Journal des levers ──────────────────────────────────────────────────────

export interface LeverJournalise {
  /** Date du lever. */
  date: DateLocale;
  /** Lever prévu : celui du plan de la veille au soir. */
  prevu: Instant;
  /** Vrai si le prévu a été figé la veille au soir ; faux s'il est recalculé. */
  prevuFige: boolean;
  mesure: Instant | null;
  /** Mesuré − prévu, en minutes (positif : levé plus tard que prévu) ; null sans mesure. */
  ecartMin: number | null;
}

export interface JournalDesLevers {
  jours: LeverJournalise[];
  /** Lever mesuré le plus tôt et le plus tard de la période (heures locales) ; null sous 2 mesures. */
  amplitude: { plusTot: Instant; plusTard: Instant; ecartMin: number; mesures: number } | null;
  /** sommeil.ecart_lever_max, en minutes. */
  limiteMin: number;
}

// ─── Fonctions exposées par le moteur (core/src/index.ts) ─────────────────────

export interface Moteur {
  validerConfig(yaml: string): ResultatValidation;
  journee(contexte: Contexte, date: DateLocale): Journee;
  journeeCourante(contexte: Contexte): Journee;
  engagementsPrevus(contexte: Contexte, date: DateLocale): EngagementPrevu[];
  etat(contexte: Contexte, appareil: string): EtatAppareil;
  planifier(contexte: Contexte, appareil: string, horizonH?: number): Segment[];
  /** Les modes du jour et leurs conditions jugées maintenant (§3.7). */
  expliquer(contexte: Contexte, appareil: string): ModeExplique[];
  sortie(contexte: Contexte, appareil: string): SortieMode;
  prixException(contexte: Contexte, demande: DemandeException, friction?: FrictionFournie): PrixException;
  /** Engagements vérifiables prévus de `du` à `au` (dates incluses) et leur statut (§3.8). */
  verifierEngagements(contexte: Contexte, mesures: Mesure[], du: DateLocale, au: DateLocale): EngagementVerifie[];
  /** Levers prévus et mesurés des jours finissant à `jusqua`, et leur écart (§3.1). */
  journalDesLevers(contexte: Contexte, jusqua: DateLocale, prevusFiges?: Record<DateLocale, Instant>, nbJours?: number): JournalDesLevers;
  /** Secondes d'attente exigées pour le n-ième « continue » (n commence à 0). */
  attenteContinue(config: Config, n: number): number;
}
