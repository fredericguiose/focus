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
  leverPlancher: HeureLocale;
}

export interface Engagement {
  /** Réveil donné directement, ou calculé = heure − préparation. Absent = sans heure. */
  reveil?: HeureLocale;
  heure?: HeureLocale;
  preparationMin?: number;
  annulable: boolean;
  decalable: boolean;
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
  engagements?: Record<string, Partial<Engagement> | { sansHeure: true }>;
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
  | { type: 'ajoute'; date: DateLocale; libelle: string; heure?: HeureLocale; preparationMin?: number; reveil?: HeureLocale }
  | { type: 'retire'; date: DateLocale; engagement: string }
  | { type: 'decale'; date: DateLocale; engagement: string; heure: HeureLocale }
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
  friction: 'aucune' | 'raison_phrase';
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
  annulable: boolean;
  decalable: boolean;
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

// ─── Fonctions exposées par le moteur (core/src/index.ts) ─────────────────────

export interface Moteur {
  validerConfig(yaml: string): ResultatValidation;
  journee(contexte: Contexte, date: DateLocale): Journee;
  journeeCourante(contexte: Contexte): Journee;
  engagementsPrevus(contexte: Contexte, date: DateLocale): EngagementPrevu[];
  etat(contexte: Contexte, appareil: string): EtatAppareil;
  planifier(contexte: Contexte, appareil: string, horizonH?: number): Segment[];
  prixException(contexte: Contexte, demande: DemandeException, friction?: FrictionFournie): PrixException;
  /** Secondes d'attente exigées pour le n-ième « continue » (n commence à 0). */
  attenteContinue(config: Config, n: number): number;
}
