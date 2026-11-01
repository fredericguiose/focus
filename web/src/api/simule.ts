// API simulée en mémoire (VITE_API_SIMULEE=1), pour développer et tester sans serveur.
// Horaires fictifs repris de config/exemple.yaml. Le fuseau est celui du navigateur, pour que la
// journée simulée suive celle de la personne qui développe. Ce n'est pas le moteur : seules les
// règles visibles par l'interface (§3.4 exceptions, §4.5 sessions) sont reproduites, simplifiées.
import { dateCourte } from '../../../core/src/temps';
import type { DateLocale, HeureLocale } from '../../../core/src/types';
import { PHRASE_NUIT, RAISON_MIN, longueurRaison } from '@/lib/decisionNuit';
import { ajouterJours, dateLocale, formaterDuree, formaterHeure, heureLocale, instantLocal, jourDeSemaine, versInstant } from '@/lib/temps';
import type {
  ActionsStatut,
  ApiFocus,
  AppBloquee,
  CorpsException,
  DemandeException,
  EngagementDemain,
  EngagementVerifie,
  EtapeParcours,
  Exception,
  Journee,
  Phase,
  PrixException,
  ReponseStatut,
  ReponseTaches,
  SessionOuverte,
  SortieMode,
  StatutAppareil,
  StatutEngagement,
  TacheSession,
  TypeAppareil,
} from './contrat';
import { ErreurFocus } from './erreur';

const MINUTE = 60_000;
const CIBLE_MIN = 8 * 60;
const MINIMUM_MIN = 7 * 60;
const PLANCHER_NUIT_MIN = 6 * 60;
const REVEIL_LIBRE = '07:00';
const PRIX_DU_REPORT_MIN = 20;
const ATTENTES_S = [0, 3, 5, 10, 15, 20];
const EXPIRATION_QUESTION_S = 60;
const DELAI_NOUVELLE_TACHE_MIN = 15;
const PLAFOND_SESSIONS_MIN = 180;
/** Dettes fictives des sept dernières nuits, en minutes (négatif = avance). */
const DETTES_FICTIVES = [35, -10, 50, 0, 75, 20, -25];
/** Sommeil mesuré fictif (montre) : la plus ancienne nuit n'a pas de mesure. */
const MESURES_FICTIVES: (null | { legere: number; profonde: number; rem: number; eveil: number })[] = [
  null,
  { legere: 250, profonde: 95, rem: 105, eveil: 25 },
  { legere: 230, profonde: 70, rem: 85, eveil: 40 },
  { legere: 255, profonde: 100, rem: 110, eveil: 20 },
  { legere: 210, profonde: 65, rem: 80, eveil: 35 },
  { legere: 240, profonde: 85, rem: 95, eveil: 30 },
  { legere: 262, profonde: 92, rem: 104, eveil: 18 },
];
/** Sieste fictive : journée (indice dans les sept nuits), début local et minutes dormies. */
const SIESTE_FICTIVE = { indice: 3, debut: '15:00', minutes: 60 } as const;
/** Sieste fictive du jour, visible une fois finie (13:00–13:50, 45 min dormies). */
const SIESTE_DU_JOUR = { debut: '13:00', duree: 50, minutes: 45 } as const;
/** Nuit fictive que la montre a marquée incomplète. */
const INCOMPLETE_FICTIVE = 4;
// La vraie API pose la question après 25 min (PC) ou 10 min (iPhone) ; 30 s suffisent pour essayer.
const INTERVALLE_QUESTION_SIMULE_S = 30;

const CATALOGUE: Record<string, { nom: string; domaines: string[]; iphone?: string }> = {
  youtube: { nom: 'YouTube', domaines: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'], iphone: 'com.google.ios.youtube' },
  x: { nom: 'X', domaines: ['x.com', 'twitter.com', 'www.x.com'], iphone: 'com.atebits.Tweetie2' },
  chatgpt: { nom: 'ChatGPT', domaines: ['chatgpt.com', 'chat.openai.com'], iphone: 'com.openai.chat' },
  gemini: { nom: 'Gemini', domaines: ['gemini.google.com'], iphone: 'com.google.gemini' },
  claude_ai: { nom: 'Claude', domaines: ['claude.ai'], iphone: 'com.anthropic.claude' },
  gmail: { nom: 'Gmail', domaines: ['mail.google.com', 'gmail.com'], iphone: 'com.google.Gmail' },
  safari: { nom: 'Safari', domaines: [], iphone: 'com.apple.mobilesafari' },
};
const BLOQUEES_WORK = ['chatgpt', 'gemini', 'claude_ai', 'youtube', 'x', 'safari'];
/** Groupes du catalogue, comme dans l'exemple de config (noms tels que l'API les donne). */
const GROUPES: { id: string; nom: string; apps: string[] }[] = [
  { id: 'divertissement', nom: 'Divertissement', apps: ['youtube', 'x'] },
  { id: 'ia_conversationnelle', nom: 'IA conversationnelle', apps: ['chatgpt', 'gemini', 'claude_ai'] },
  { id: 'navigateurs', nom: 'Navigateurs', apps: ['safari'] },
];

interface EngagementSimule {
  nom: string;
  heure: HeureLocale;
  preparationMin: number;
  annulable: boolean;
  decalable: boolean;
}
const ENGAGEMENTS: Record<string, EngagementSimule> = {
  sport: { nom: 'Sport', heure: '06:00', preparationMin: 30, annulable: true, decalable: true },
  travail: { nom: 'Travail', heure: '06:30', preparationMin: 0, annulable: false, decalable: false },
};
/** Engagements vérifiés par une séance mesurée (salle). */
const VERIFIES = ['sport'];
/** Jours prévus passés sans séance, comptés à rebours depuis hier (1 = le plus récent). */
const SEANCES_MANQUEES = [2];
/** Index = jour de semaine (0 = dimanche). */
const ENGAGEMENTS_PAR_JOUR: string[][] = [['sport'], ['sport', 'travail'], ['travail'], ['sport', 'travail'], ['travail'], ['sport', 'travail'], []];
/** null = « $coucher - 2h ». */
const OUVERTURE_PAR_JOUR: (HeureLocale | null)[] = ['14:00', null, null, null, null, '18:00', '14:00'];

const APPAREILS: { appareil: string; type: TypeAppareil }[] = [
  { appareil: 'pc_linux', type: 'pc_linux' },
  { appareil: 'pc_windows', type: 'pc_windows' },
  { appareil: 'iphone', type: 'iphone' },
];

interface TacheSimulee {
  id: string;
  nom: string;
  priorite: TacheSession['priorite'];
  creeeLe: number;
}

interface SessionInterne {
  session: SessionOuverte;
  prochaineQuestion: number | null;
}

export interface OptionsSimulation {
  maintenant?: () => number;
  fuseau?: string;
  /** Délai artificiel de chaque réponse, pour voir les états de chargement. */
  latenceMs?: number;
  /**
   * Place l'horloge simulée dans cette phase de la journée en cours (`?phase=nuit` dans l'URL en
   * mode simulé) : utile pour les captures. L'horloge avance ensuite normalement. Chaque phase
   * vient avec ses faits (voir FAITS_PAR_PHASE), sauf si `faits` les précise.
   */
  phase?: Phase;
  faits?: Partial<FaitsSimules>;
}

/** Faits Todoist que les conditions des modes lisent (§2.6), figés dans la simulation. */
export interface FaitsSimules {
  planningFait: boolean;
  /** Tâches P1/P2 du jour non terminées. */
  prioritairesRestantes: number;
  recapFait: boolean;
}

const FAITS_PAR_DEFAUT: FaitsSimules = { planningFait: true, prioritairesRestantes: 0, recapFait: true };
// Journée : planning pas encore fait (matin verrouillé sur les PC). Soirée : l'heure d'ouverture
// est passée mais il reste 2 tâches prioritaires (travail). Nuit : tout est fait.
const FAITS_PAR_PHASE: Record<Phase, FaitsSimules> = {
  journee: { planningFait: false, prioritairesRestantes: 2, recapFait: true },
  soiree: { planningFait: true, prioritairesRestantes: 2, recapFait: true },
  nuit: FAITS_PAR_DEFAUT,
};
/** Le matin verrouillé ne concerne que les PC, comme dans l'exemple de config. */
const APPAREILS_MATIN: TypeAppareil[] = ['pc_linux', 'pc_windows'];
const APPAREIL_PRINCIPAL = 'pc_linux';

const enMinutes = (h: HeureLocale) => {
  const [a, b] = h.split(':').map(Number);
  return (a ?? 0) * 60 + (b ?? 0);
};
const versHeure = (minutes: number) => {
  const m = Math.max(0, minutes);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
// Copie par JSON, comme un passage par le réseau ; `undefined` (réponse sans corps) reste tel quel.
const copie = <T,>(valeur: T): T => (valeur === undefined ? valeur : (JSON.parse(JSON.stringify(valeur)) as T));
const minuscule = (texte: string) => texte.charAt(0).toLowerCase() + texte.slice(1);
const majuscule = (texte: string) => texte.charAt(0).toUpperCase() + texte.slice(1);

/** Comme le moteur : « 2 tâches restantes dont 1 en retard » (une sur deux est en retard). */
function detailPrioritaires(n: number, _date: DateLocale): string {
  const total = `${n} tâche${n > 1 ? 's' : ''} restante${n > 1 ? 's' : ''}`;
  return n < 2 ? total : `${total} dont ${Math.floor(n / 2)} en retard`;
}
const HEURE_VALIDE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_VALIDE = /^\d{4}-\d{2}-\d{2}$/;

function fuseauDuNavigateur(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function nuitDe(demande: DemandeException): DateLocale {
  return demande.type === 'coucher' || demande.type === 'avancer_coucher' ? demande.nuit : ajouterJours(demande.date, -1);
}

export function creerApiSimulee(options: OptionsSimulation = {}): ApiFocus {
  const horloge = options.maintenant ?? (() => Date.now());
  const fuseau = options.fuseau ?? fuseauDuNavigateur();
  const latenceMs = options.latenceMs ?? 0;
  const faits: FaitsSimules = { ...(options.phase ? FAITS_PAR_PHASE[options.phase] : FAITS_PAR_DEFAUT), ...options.faits };
  const exceptions: Exception[] = [];
  let decalage = 0;
  const maintenant = () => horloge() + decalage;
  if (options.phase) decalage = instantDansPhase(options.phase, horloge()) - horloge();
  const debut = maintenant();

  const taches: TacheSimulee[] = [
    { id: 't1', nom: 'Exercices de probabilités', priorite: 'p1', creeeLe: debut - 3 * 60 * MINUTE },
    { id: 't2', nom: 'Fiche de révision : suites numériques', priorite: 'p2', creeeLe: debut - 50 * MINUTE },
    { id: 't3', nom: 'Relire le chapitre 4', priorite: 'p3', creeeLe: debut - 5 * MINUTE },
    { id: 't4', nom: "Préparer l'exposé d'histoire", priorite: 'p4', creeeLe: debut - 24 * 60 * MINUTE },
  ];
  let sessions: SessionInterne[] = [];
  const continues = new Map<string, number>();
  let compteur = 0;

  // ─── Journée ────────────────────────────────────────────────────────────────

  interface EngagementDuJour {
    nom: string;
    /** Minutes depuis minuit (null = sans heure). */
    heure: number | null;
    reveil: number | null;
    annulable: boolean;
    decalable: boolean;
    origine: 'routine' | 'exception';
  }

  function engagementsDuJour(date: DateLocale, liste: Exception[]): Map<string, EngagementDuJour> {
    const resultat = new Map<string, EngagementDuJour>();
    for (const id of ENGAGEMENTS_PAR_JOUR[jourDeSemaine(date)] ?? []) {
      const e = ENGAGEMENTS[id];
      if (!e) continue;
      const heure = enMinutes(e.heure);
      resultat.set(id, { nom: e.nom, heure, reveil: heure - e.preparationMin, annulable: e.annulable, decalable: e.decalable, origine: 'routine' });
    }
    for (const { demande: d } of liste) {
      if (d.type === 'ajoute' && d.date === date) {
        const heure = d.heure ? enMinutes(d.heure) : null;
        const reveil = d.reveil ? enMinutes(d.reveil) : heure === null ? null : heure - (d.preparationMin ?? 0);
        resultat.set(d.libelle, { nom: d.libelle, heure, reveil, annulable: true, decalable: false, origine: 'exception' });
      } else if (d.type === 'retire' && d.date === date) {
        resultat.delete(d.engagement);
      } else if (d.type === 'decale' && d.date === date) {
        const e = resultat.get(d.engagement);
        if (e) {
          const heure = enMinutes(d.heure);
          resultat.set(d.engagement, { ...e, heure, reveil: heure - (ENGAGEMENTS[d.engagement]?.preparationMin ?? 0) });
        }
      }
    }
    return resultat;
  }

  function lever(date: DateLocale, liste: Exception[]): number {
    const reveils = [...engagementsDuJour(date, liste).values()].map((e) => e.reveil).filter((r): r is number => r !== null);
    return instantLocal(date, versHeure(Math.min(enMinutes(REVEIL_LIBRE), ...reveils)), fuseau);
  }

  function coucherApplique(nuit: DateLocale, liste: Exception[]): number {
    let coucher = lever(ajouterJours(nuit, 1), liste) - CIBLE_MIN * MINUTE;
    for (const { demande: d } of liste) {
      if (d.type === 'coucher' && d.nuit === nuit) {
        coucher = instantLocal(d.heure >= '12:00' ? nuit : ajouterJours(nuit, 1), d.heure, fuseau);
      } else if (d.type === 'avancer_coucher' && d.nuit === nuit) {
        coucher = Date.parse(d.a);
      }
    }
    return coucher;
  }

  function ouverture(nuit: DateLocale, liste: Exception[]): number {
    const coucher = coucherApplique(nuit, liste);
    const parametre = OUVERTURE_PAR_JOUR[jourDeSemaine(nuit)];
    const base = parametre ? instantLocal(nuit, parametre, fuseau) : coucher - 120 * MINUTE;
    return Math.min(base + PRIX_DU_REPORT_MIN * MINUTE, coucher);
  }

  function decisionPrise(nuit: DateLocale): boolean {
    return exceptions.some((e) => e.pendantNuit && nuitDe(e.demande) === nuit);
  }

  function dateCourante(t: number): DateLocale {
    const jour = dateLocale(t, fuseau);
    return t < lever(jour, exceptions) ? ajouterJours(jour, -1) : jour;
  }

  /** Un instant de la journée en cours qui tombe dans la phase demandée. */
  function instantDansPhase(phase: Phase, t: number): number {
    const date = dateCourante(t);
    const debutJour = lever(date, exceptions);
    const soiree = ouverture(date, exceptions);
    const coucher = coucherApplique(date, exceptions);
    if (phase === 'journee') return Math.max(debutJour + 60 * MINUTE, soiree - 150 * MINUTE);
    if (phase === 'soiree') return soiree + Math.floor((coucher - soiree) / 2 / MINUTE) * MINUTE;
    return coucher + 80 * MINUTE;
  }

  function phaseA(t: number): Phase {
    const date = dateCourante(t);
    if (t < ouverture(date, exceptions)) return 'journee';
    return t < coucherApplique(date, exceptions) ? 'soiree' : 'nuit';
  }

  function actionsA(t: number): ActionsStatut {
    const date = dateCourante(t);
    const phase = phaseA(t);
    const coucher = coucherApplique(date, exceptions);
    const jeVaisDormir =
      phase === 'nuit'
        ? { disponible: false, motif: `la nuit a déjà commencé à ${heureLocale(coucher, fuseau)}` }
        : { disponible: true, motif: null };
    // Une décision de nuit prise ferme la nuit, même si l'ouverture a reculé avec le coucher.
    if (decisionPrise(date)) {
      return {
        je_vais_dormir: jeVaisDormir,
        decaler_coucher: { mode: 'indisponible', motif: `décision de nuit déjà prise pour la nuit du ${dateCourte(date)} (une seule par nuit)` },
      };
    }
    if (phase === 'journee') return { je_vais_dormir: jeVaisDormir, decaler_coucher: { mode: 'raison', motif: null } };
    return {
      je_vais_dormir: jeVaisDormir,
      decaler_coucher: {
        mode: 'decision_de_nuit',
        motif:
          phase === 'nuit'
            ? `la nuit a déjà commencé à ${heureLocale(coucher, fuseau)}`
            : `soirée ouverte depuis ${heureLocale(ouverture(date, exceptions), fuseau)}`,
      },
    };
  }

  function engagementsDemain(t: number): EngagementDemain[] {
    const demain = ajouterJours(dateCourante(t), 1);
    const instant = (minutes: number | null) => (minutes === null ? null : versInstant(instantLocal(demain, versHeure(minutes), fuseau)));
    return [...engagementsDuJour(demain, exceptions)].map(([id, e]) => ({
      id,
      nom: e.nom,
      reveil: instant(e.reveil),
      heure: instant(e.heure),
      annulable: e.annulable,
      decalable: e.decalable,
      origine: e.origine,
    }));
  }

  function journee(t: number): Journee {
    const date = dateCourante(t);
    const leverSuivant = lever(ajouterJours(date, 1), exceptions);
    const coucher = coucherApplique(date, exceptions);
    return {
      date,
      routine: 'semaine',
      fuseau,
      engagements: [...engagementsDuJour(date, exceptions).keys()],
      lever: versInstant(lever(date, exceptions)),
      leverSuivant: versInstant(leverSuivant),
      coucherPrevu: versInstant(leverSuivant - CIBLE_MIN * MINUTE),
      coucherApplique: versInstant(coucher),
      ouverture: versInstant(ouverture(date, exceptions)),
      prixDuReportMin: PRIX_DU_REPORT_MIN,
      detteNuitMin: Math.round(CIBLE_MIN - (leverSuivant - coucher) / MINUTE),
      decisionDeNuitPrise: decisionPrise(date),
    };
  }

  // ─── Appareils ──────────────────────────────────────────────────────────────

  function appsPour(type: TypeAppareil, ids: string[]): AppBloquee[] {
    return ids.flatMap((id) => {
      const app = CATALOGUE[id];
      if (!app) return [];
      if (type === 'iphone') return app.iphone ? [{ id, nom: app.nom, domaines: [] }] : [];
      return app.domaines.length > 0 ? [{ id, nom: app.nom, domaines: [...app.domaines] }] : [];
    });
  }

  function vuLe(appareil: string, t: number): string | null {
    // pc_linux interroge l'API chaque minute ; l'iPhone moins souvent ; pc_windows est éteint.
    if (appareil === 'pc_linux') return versInstant(t - ((t - debut + 40_000) % MINUTE));
    if (appareil === 'iphone') return versInstant(debut - 4 * MINUTE);
    return versInstant(debut - 3 * 24 * 60 * MINUTE);
  }

  /** Comme l'API : « Matin verrouillé : planning du matin à faire », « Nuit jusqu'à 05:30 ». */
  function motifInterdit(etat: Omit<StatutAppareil, 'session_possible' | 'session_motif'>): string {
    const actif = etat.parcours?.find((e) => e.actif);
    const nom = actif?.nom ?? etat.mode;
    const manque = actif?.logique === 'pas' ? actif.conditions.find((c) => !c.vraie) : undefined;
    if (manque) return `${nom} : ${minuscule(manque.libelle)} ${manque.detail ?? 'à faire'}`;
    if (etat.sortie?.certaine) return `${nom} jusqu'à ${formaterHeure(etat.sortie.au_plus_tard, fuseau)}`;
    return etat.sortie ? `${nom} : fin ${etat.sortie.texte}` : nom;
  }

  function etatAppareil(appareil: string, type: TypeAppareil, t: number): StatutAppareil {
    const etat = etatSansPossibilite(appareil, type, t);
    const motif =
      type === 'pc_windows'
        ? 'aucun compte de travail sur ce PC'
        : etat.sessions === 'interdites'
          ? motifInterdit(etat)
          : (etat.apps_bloquees ?? []).length === 0
            ? "rien n'est bloqué en ce moment"
            : null;
    const bloquees = new Set((etat.apps_bloquees ?? []).map((x) => x.id));
    const groupes_bloques = GROUPES.map((g) => ({ ...g, apps: g.apps.filter((id) => bloquees.has(id)) })).filter((g) => g.apps.length > 0);
    return { ...etat, groupes_bloques, session_possible: motif === null, session_motif: motif };
  }

  /** Les modes de la routine dans l'ordre de priorité (§2.5), conditions évaluées à `t`. */
  function parcoursA(type: TypeAppareil, t: number): EtapeParcours[] {
    const date = dateCourante(t);
    const coucher = coucherApplique(date, exceptions);
    const soiree = ouverture(date, exceptions);
    const n = faits.prioritairesRestantes;
    const etapes: Omit<EtapeParcours, 'actif'>[] = [
      {
        mode: 'NIGHT_LOCK',
        nom: 'Nuit',
        applicable: true,
        logique: 'simple',
        conditions: [
          { type: 'heure', libelle: `Coucher à ${heureLocale(coucher, fuseau)}`, vraie: t >= coucher, detail: null, a: versInstant(coucher), niee: false },
        ],
      },
      {
        mode: 'MORNING_LOCK',
        nom: 'Matin verrouillé',
        applicable: APPAREILS_MATIN.includes(type),
        logique: 'pas',
        conditions: [
          { type: 'planning', libelle: 'Planning du matin', vraie: faits.planningFait, detail: faits.planningFait ? null : 'à faire', a: null, niee: true },
        ],
      },
      {
        mode: 'EVENING_FREE',
        nom: 'Soirée libre',
        applicable: true,
        logique: 'tous',
        conditions: [
          {
            type: 'heure',
            libelle: `Ouverture à ${heureLocale(soiree, fuseau)}`,
            vraie: t >= soiree,
            detail: `+${formaterDuree(PRIX_DU_REPORT_MIN)} de report`,
            a: versInstant(soiree),
            niee: false,
          },
          {
            type: 'prioritaires',
            libelle: 'Tâches P1/P2 faites',
            vraie: n === 0,
            detail: n === 0 ? null : detailPrioritaires(n, date),
            a: null,
            niee: false,
          },
          { type: 'recap', libelle: "Récap d'hier", vraie: faits.recapFait, detail: faits.recapFait ? null : 'à faire', a: null, niee: false },
        ],
      },
      { mode: 'WORK', nom: 'Travail', applicable: true, logique: 'simple', conditions: [{ type: 'toujours', libelle: 'Par défaut', vraie: true, detail: null, a: null, niee: false }] },
    ];
    const vrai = (e: Omit<EtapeParcours, 'actif'>) =>
      e.applicable && e.conditions.every((c) => c.vraie !== (c.niee === true));
    const gagnant = etapes.find(vrai)?.mode;
    return etapes.map((e) => ({ ...e, actif: e.mode === gagnant }));
  }

  // Comme dans l'exemple de config : pc_windows n'a aucun compte de travail.
  function etatSansPossibilite(appareil: string, type: TypeAppareil, t: number): Omit<StatutAppareil, 'session_possible' | 'session_motif'> {
    const date = dateCourante(t);
    const coucher = coucherApplique(date, exceptions);
    const soiree = ouverture(date, exceptions);
    const parcours = parcoursA(type, t);
    const mode = parcours.find((e) => e.actif)?.mode ?? 'WORK';
    const commun = { appareil, type, mode, parcours, vu_le: vuLe(appareil, t) };
    if (mode === 'NIGHT_LOCK') {
      const leverSuivant = lever(ajouterJours(date, 1), exceptions);
      return {
        ...commun,
        raison: `NIGHT_LOCK — nuit jusqu'au lever de ${heureLocale(leverSuivant, fuseau)}`,
        sessions: 'interdites',
        jusqua: versInstant(leverSuivant),
        sortie: { texte: `au lever, ${heureLocale(leverSuivant, fuseau)}`, certaine: true, au_plus_tard: versInstant(leverSuivant) },
        apps_bloquees: appsPour(type, Object.keys(CATALOGUE)),
      };
    }
    if (mode === 'MORNING_LOCK') {
      return {
        ...commun,
        raison: 'MORNING_LOCK — planning du jour à faire',
        sessions: 'interdites',
        jusqua: versInstant(coucher),
        sortie: { texte: 'dès que le planning du matin est fait', certaine: false, au_plus_tard: versInstant(coucher) },
        apps_bloquees: appsPour(type, Object.keys(CATALOGUE)),
      };
    }
    if (mode === 'EVENING_FREE') {
      return {
        ...commun,
        raison: `EVENING_FREE — soirée libre jusqu'au coucher de ${heureLocale(coucher, fuseau)}`,
        sessions: 'autorisees',
        jusqua: versInstant(coucher),
        sortie: { texte: `au coucher, ${heureLocale(coucher, fuseau)}`, certaine: true, au_plus_tard: versInstant(coucher) },
        apps_bloquees: [],
      };
    }
    const n = faits.prioritairesRestantes;
    const manque = [
      ...(n > 0 ? ['les tâches P1/P2'] : []),
      ...(faits.recapFait ? [] : ["le récap d'hier"]),
    ];
    const hOuverture = heureLocale(soiree, fuseau);
    const sortie: SortieMode =
      manque.length === 0
        ? { texte: `à ${hOuverture}`, certaine: true, au_plus_tard: versInstant(soiree) }
        : {
            // Mêmes phrases que le moteur (§3.7).
            texte:
              t < soiree
                ? `quand ${manque.join(' et ')} seront faites et après ${hOuverture}`
                : manque.length === 1 && n === 0
                  ? `dès que ${manque[0]} est fait`
                  : `dès que ${manque.join(' et ')} sont faites`,
            certaine: false,
            au_plus_tard: versInstant(coucher),
          };
    return {
      ...commun,
      raison: n > 0 ? `WORK — tâches prioritaires restantes : ${n}` : `WORK — soirée libre à ${hOuverture}`,
      sessions: 'autorisees',
      jusqua: versInstant(manque.length === 0 ? soiree : coucher),
      sortie,
      apps_bloquees: appsPour(type, BLOQUEES_WORK),
    };
  }

  function exigerSessionPossible(appareil: StatutAppareil) {
    if (!appareil.session_possible) {
      throw new ErreurFocus('session_impossible', `Session impossible : ${appareil.session_motif}.`, 409);
    }
  }

  function trouverAppareil(appareil: string, t: number): StatutAppareil {
    const a = APPAREILS.find((x) => x.appareil === appareil);
    if (!a) throw new ErreurFocus('appareil_inconnu', `Appareil inconnu : ${appareil}.`, 404);
    return etatAppareil(a.appareil, a.type, t);
  }

  // ─── Sessions ───────────────────────────────────────────────────────────────

  const cleContinue = (tacheId: string, t: number) => `${dateCourante(t)}|${tacheId}`;

  function poserQuestion(interne: SessionInterne, a: number) {
    const n = continues.get(cleContinue(interne.session.tache?.id ?? '', a)) ?? 0;
    const attente = ATTENTES_S[Math.min(n, ATTENTES_S.length - 1)] ?? 0;
    compteur += 1;
    interne.session.question = {
      id: `q_${compteur}`,
      posee_a: versInstant(a),
      attente_s: attente,
      expire_a: versInstant(a + (EXPIRATION_QUESTION_S + attente) * 1000),
    };
    interne.prochaineQuestion = null;
  }

  /** Fait passer le temps : questions expirées (session fermée), questions à poser. */
  function avancer(t: number) {
    sessions = sessions.filter((s) => !s.session.question || t < Date.parse(s.session.question.expire_a));
    for (const s of sessions) {
      if (!s.session.question && s.prochaineQuestion !== null && t >= s.prochaineQuestion) {
        poserQuestion(s, s.prochaineQuestion);
      }
    }
    sessions = sessions.filter((s) => !s.session.question || t < Date.parse(s.session.question.expire_a));
  }

  function trouverSession(id: string): SessionInterne {
    const s = sessions.find((x) => x.session.id === id);
    if (!s) throw new ErreurFocus('session_inconnue', 'Session introuvable ou déjà fermée.', 404);
    return s;
  }

  function domainesDe(type: TypeAppareil, apps: string[]): string[] {
    return [...new Set(appsPour(type, apps).flatMap((a) => a.domaines))].sort();
  }

  // Session de démonstration : une question en attente, avec l'attente du 3e « continue ».
  if (etatAppareil('pc_linux', 'pc_linux', debut).sessions === 'autorisees') {
    continues.set(cleContinue('t1', debut), 2);
    const demo: SessionInterne = {
      session: {
        id: 's_demo',
        appareil: 'pc_linux',
        tache: { id: 't1', nom: 'Exercices de probabilités' },
        apps: ['chatgpt'],
        domaines: domainesDe('pc_linux', ['chatgpt']),
        ouverte_le: versInstant(debut - 26 * MINUTE),
        question: null,
      },
      prochaineQuestion: null,
    };
    poserQuestion(demo, debut - 1000);
    sessions.push(demo);
  }

  // ─── Exceptions ─────────────────────────────────────────────────────────────

  function verifierDemande(d: DemandeException) {
    const dateOk = d.type === 'coucher' || d.type === 'avancer_coucher' ? DATE_VALIDE.test(d.nuit) : DATE_VALIDE.test(d.date);
    const heures = [
      d.type === 'ajoute' ? d.heure : undefined,
      d.type === 'ajoute' ? d.reveil : undefined,
      d.type === 'decale' || d.type === 'coucher' ? d.heure : undefined,
    ].filter((h): h is string => h !== undefined);
    if (!dateOk || heures.some((h) => !HEURE_VALIDE.test(h))) {
      throw new ErreurFocus('demande_invalide', 'Demande invalide : date ou heure mal formée.', 400);
    }
    if (d.type === 'ajoute' && (!d.libelle.trim() || (!d.heure && !d.reveil))) {
      throw new ErreurFocus('demande_invalide', 'Demande invalide : libellé et heure (ou réveil) requis.', 400);
    }
  }

  /** Même ordre que le moteur : si seule la friction manque, tout le reste est admissible. */
  function frictionManquante(friction: CorpsException['friction'], avecPhrase: boolean): string | undefined {
    const longueur = longueurRaison(friction?.raison ?? '');
    const prefixe = avecPhrase ? 'décision de nuit : ' : '';
    if (longueur < RAISON_MIN) return `${prefixe}raison d'au moins ${RAISON_MIN} caractères exigée (${longueur} fournis)`;
    if (avecPhrase && friction?.phrase !== PHRASE_NUIT) return `${prefixe}recopier exactement la phrase « ${PHRASE_NUIT} »`;
    return undefined;
  }

  function calculerPrix(demande: DemandeException, t: number, friction?: CorpsException['friction']): PrixException {
    verifierDemande(demande);
    const nuit = nuitDe(demande);
    const apres = [...exceptions, { id: 'essai', demande, creeeLe: versInstant(t), pendantNuit: false }];
    const lendemain = ajouterJours(nuit, 1);
    const coucherAvant = coucherApplique(nuit, exceptions);
    const coucherApres = coucherApplique(nuit, apres);
    const leverAvant = lever(lendemain, exceptions);
    const leverApres = lever(lendemain, apres);
    const dette = (coucher: number, leverMs: number) => Math.round(CIBLE_MIN - (leverMs - coucher) / MINUTE);
    const base = {
      coucherAvant: versInstant(coucherAvant),
      coucherApres: versInstant(coucherApres),
      leverAvant: versInstant(leverAvant),
      leverApres: versInstant(leverApres),
      detteAvantMin: dette(coucherAvant, leverAvant),
      detteApresMin: dette(coucherApres, leverApres),
    };

    if (demande.type === 'retire' || demande.type === 'decale') {
      const e = engagementsDuJour(demande.date, exceptions).get(demande.engagement);
      const refus = (motifRefus: string): PrixException => ({ ...base, admissible: false, motifRefus, friction: 'aucune', resserre: false });
      if (!e) return refus(`pas d'engagement « ${majuscule(demande.engagement)} » le ${dateCourte(demande.date)}`);
      if (demande.type === 'retire' && !e.annulable) return refus(`l'engagement « ${e.nom} » ne peut pas être annulé`);
      if (demande.type === 'decale' && !e.decalable) return refus(`l'engagement « ${e.nom} » ne peut pas être décalé`);
    }
    if (coucherApres <= coucherAvant && leverApres <= leverAvant) {
      return { ...base, admissible: true, friction: 'aucune', resserre: true };
    }

    const sommeil = (leverApres - coucherApres) / MINUTE;
    const avecFriction = (f: 'raison' | 'raison_phrase', motifRefus: string | undefined): PrixException => {
      const manque = motifRefus === undefined ? frictionManquante(friction, f === 'raison_phrase') : undefined;
      const refus = motifRefus ?? manque;
      return {
        ...base,
        admissible: refus === undefined,
        ...(refus !== undefined ? { motifRefus: refus } : {}),
        friction: f,
        ...(manque !== undefined ? { frictionManquante: true } : {}),
        resserre: false,
      };
    };
    if (t < ouverture(nuit, exceptions) && !decisionPrise(nuit)) {
      return avecFriction(
        'raison',
        sommeil < MINIMUM_MIN ? `sommeil prévu ${formaterDuree(sommeil)}, sous le minimum de ${formaterDuree(MINIMUM_MIN)}` : undefined,
      );
    }
    if (t < leverAvant) {
      let motifRefus: string | undefined;
      if (decisionPrise(nuit)) motifRefus = `décision de nuit déjà prise pour la nuit du ${dateCourte(nuit)} (une seule par nuit)`;
      else if (sommeil < PLANCHER_NUIT_MIN) {
        motifRefus = `sommeil prévu ${formaterDuree(sommeil)}, sous le plancher de nuit de ${formaterDuree(PLANCHER_NUIT_MIN)}`;
      }
      return avecFriction('raison_phrase', motifRefus);
    }
    return { ...base, admissible: false, motifRefus: `la nuit du ${dateCourte(nuit)} est passée`, friction: 'aucune', resserre: false };
  }

  // ─── Points d'entrée ────────────────────────────────────────────────────────

  /** Engagements vérifiés : 7 derniers jours, aujourd'hui et la fin de la semaine (§4.6). */
  function engagementsVerifies(t: number) {
    const aujourdhui = dateLocale(t, fuseau);
    const lundi = ajouterJours(aujourdhui, -((jourDeSemaine(aujourdhui) + 6) % 7));
    const liste: EngagementVerifie[] = [];
    let passes = 0;
    for (let n = 0; ; n++) {
      const date = ajouterJours(lundi, 6 - n);
      if (date < ajouterJours(aujourdhui, -7)) break;
      const retires = exceptions.filter((e) => e.demande.type === 'retire' && e.demande.date === date).map((e) => (e.demande as { engagement: string }).engagement);
      for (const id of VERIFIES) {
        const prevu = (ENGAGEMENTS_PAR_JOUR[jourDeSemaine(date)] ?? []).includes(id);
        if (!prevu) continue;
        let statut: StatutEngagement;
        if (date >= aujourdhui) statut = retires.includes(id) ? 'saute_declare' : 'a_faire';
        else statut = retires.includes(id) ? 'saute_declare' : SEANCES_MANQUEES.includes(++passes) ? 'saute_non_declare' : 'fait';
        liste.unshift({ date, engagement: id, nom: ENGAGEMENTS[id]?.nom ?? id, statut });
      }
    }
    const sautes = liste.filter((e) => e.date >= lundi && e.date <= aujourdhui && e.statut.startsWith('saute')).length;
    return { aujourdhui, engagements_verifies: liste, sautes_semaine: sautes };
  }

  async function servir<T>(calcul: () => T): Promise<T> {
    if (latenceMs > 0) await new Promise((r) => setTimeout(r, latenceMs));
    return copie(calcul());
  }

  return {
    statut: () =>
      servir((): ReponseStatut => {
        const t = maintenant();
        avancer(t);
        const j = journee(t);
        const nuits = DETTES_FICTIVES.map((dette_min, i) => {
          const phases = MESURES_FICTIVES[i] ?? null;
          const endormi = phases ? phases.legere + phases.profonde + phases.rem : null;
          const nuit = ajouterJours(j.date, i - DETTES_FICTIVES.length);
          const debutSieste = instantLocal(nuit, SIESTE_FICTIVE.debut, j.fuseau);
          const siestes =
            i === SIESTE_FICTIVE.indice
              ? [{ debut: versInstant(debutSieste), fin: versInstant(debutSieste + (SIESTE_FICTIVE.minutes + 5) * MINUTE), minutes: SIESTE_FICTIVE.minutes }]
              : [];
          return {
            nuit,
            dette_min,
            dette_reelle_min: endormi === null ? null : CIBLE_MIN - endormi,
            endormi_min: endormi,
            phases,
            incomplete: i === INCOMPLETE_FICTIVE,
            siestes_min: siestes.reduce((total, x) => total + x.minutes, 0),
            siestes,
          };
        });
        const reelles = nuits.filter((n) => n.dette_reelle_min !== null);
        const debutDuJour = instantLocal(j.date, SIESTE_DU_JOUR.debut, j.fuseau);
        const finDuJour = debutDuJour + SIESTE_DU_JOUR.duree * MINUTE;
        const siestesDuJour = t >= finDuJour ? [{ debut: versInstant(debutDuJour), fin: versInstant(finDuJour), minutes: SIESTE_DU_JOUR.minutes }] : [];
        const siestesDuJourMin = siestesDuJour.reduce((total, x) => total + x.minutes, 0);
        const siestesTotal = nuits.reduce((total, n) => total + n.siestes_min, 0) + siestesDuJourMin;
        const coucherDuJour = Date.parse(j.coucherApplique);
        const tardive = siestesDuJour.find((x) => Date.parse(x.fin) > coucherDuJour - 4 * 60 * MINUTE);
        const cumulMin = sessions.reduce((total, s) => total + Math.max(0, Math.round((t - Date.parse(s.session.ouverte_le)) / MINUTE)), 0);
        return {
          heure_serveur: versInstant(t),
          config_version: 'simulee',
          journee: j,
          appareil_principal: APPAREIL_PRINCIPAL,
          appareils: APPAREILS.map((a) => etatAppareil(a.appareil, a.type, t)),
          sessions: sessions.map((s) => ({
            ...s.session,
            prochaine_question_a: s.prochaineQuestion === null ? null : versInstant(s.prochaineQuestion),
          })),
          sessions_du_jour: { cumul_min: Math.min(cumulMin + 35, PLAFOND_SESSIONS_MIN), plafond_min: PLAFOND_SESSIONS_MIN },
          nuits,
          dette_cumulee_min: nuits.reduce((total, n) => total + n.dette_min, 0),
          dette_cumulee_reelle_min: reelles.length === 0 ? null : reelles.reduce((total, n) => total + n.dette_reelle_min!, 0) - siestesTotal,
          siestes_total_min: siestesTotal,
          siestes_du_jour: siestesDuJour,
          siestes_du_jour_min: siestesDuJourMin,
          sieste_tardive: tardive && t < coucherDuJour ? { fin: tardive.fin, coucher: j.coucherApplique } : null,
          sommeil_mesure: { derniere_synchro: versInstant(t - 20 * MINUTE), erreur: null },
          objectif_sommeil_min: CIBLE_MIN,
          phase: phaseA(t),
          actions: actionsA(t),
          engagements_demain: engagementsDemain(t),
          ...engagementsVerifies(t),
          seances_mesurees: { derniere_synchro: versInstant(t - 35 * MINUTE), erreur: null },
        };
      }),

    taches: () =>
      servir((): ReponseTaches => ({
        taches: taches.map((x) => ({
          id: x.id,
          nom: x.nom,
          priorite: x.priorite,
          eligible_le: versInstant(x.creeeLe + DELAI_NOUVELLE_TACHE_MIN * MINUTE),
        })),
      })),

    appsBloquees: (appareil) => servir(() => trouverAppareil(appareil.appareil, maintenant()).apps_bloquees ?? []),

    ouvrirSession: (corps) =>
      servir(() => {
        const t = maintenant();
        avancer(t);
        const appareil = trouverAppareil(corps.appareil, t);
        exigerSessionPossible(appareil);
        const tache = taches.find((x) => x.id === corps.tache_id);
        if (!tache) throw new ErreurFocus('tache_inconnue', 'Tâche introuvable ou déjà terminée.', 404);
        const eligibleLe = tache.creeeLe + DELAI_NOUVELLE_TACHE_MIN * MINUTE;
        if (t < eligibleLe) {
          throw new ErreurFocus(
            'tache_trop_recente',
            `Tâche créée il y a moins de ${DELAI_NOUVELLE_TACHE_MIN} min : éligible à ${heureLocale(eligibleLe, fuseau)}.`,
            409,
          );
        }
        const permises = new Set((appareil.apps_bloquees ?? []).map((a) => a.id));
        if (corps.apps.length === 0 || corps.apps.some((a) => !permises.has(a))) {
          throw new ErreurFocus('apps_invalides', 'Choisissez au moins une app bloquée sur cet appareil.', 400);
        }
        compteur += 1;
        sessions.push({
          session: {
            id: `s_${compteur}`,
            appareil: appareil.appareil,
            tache: { id: tache.id, nom: tache.nom },
            apps: [...corps.apps],
            domaines: domainesDe(appareil.type, corps.apps),
            ouverte_le: versInstant(t),
            question: null,
          },
          prochaineQuestion: t + INTERVALLE_QUESTION_SIMULE_S * 1000,
        });
      }),

    ajouterApp: (sessionId, app) =>
      servir(() => {
        const t = maintenant();
        avancer(t);
        const s = trouverSession(sessionId);
        const appareil = trouverAppareil(s.session.appareil, t);
        exigerSessionPossible(appareil);
        if (!(appareil.apps_bloquees ?? []).some((a) => a.id === app)) {
          throw new ErreurFocus('app_invalide', "Cette app n'est pas bloquée sur cet appareil.", 400);
        }
        if (!s.session.apps.includes(app)) s.session.apps.push(app);
        s.session.domaines = domainesDe(appareil.type, s.session.apps);
      }),

    repondre: (sessionId, corps) =>
      servir(() => {
        const t = maintenant();
        avancer(t);
        const s = trouverSession(sessionId);
        const q = s.session.question;
        if (!q || q.id !== corps.question_id) {
          throw new ErreurFocus('question_inconnue', "Cette question n'est plus en attente.", 409);
        }
        if (corps.reponse === 'arrete') {
          sessions = sessions.filter((x) => x !== s);
          return;
        }
        const continuerDes = Date.parse(q.posee_a) + q.attente_s * 1000;
        if (t < continuerDes) {
          throw new ErreurFocus('trop_tot', `Trop tôt : attendez encore ${Math.ceil((continuerDes - t) / 1000)} s.`, 409);
        }
        const cle = cleContinue(s.session.tache?.id ?? '', t);
        continues.set(cle, (continues.get(cle) ?? 0) + 1);
        s.session.question = null;
        s.prochaineQuestion = t + INTERVALLE_QUESTION_SIMULE_S * 1000;
      }),

    fermerSession: (sessionId) =>
      servir(() => {
        avancer(maintenant());
        const s = trouverSession(sessionId);
        sessions = sessions.filter((x) => x !== s);
      }),

    prixException: (corps: CorpsException) => servir(() => calculerPrix(corps.demande, maintenant(), corps.friction)),

    enregistrerException: (corps) =>
      servir(() => {
        const t = maintenant();
        const prix = calculerPrix(corps.demande, t, corps.friction);
        if (prix.frictionManquante) throw new ErreurFocus('friction_requise', prix.motifRefus ?? 'Raison exigée.', 400);
        if (!prix.admissible) throw new ErreurFocus('exception_refusee', prix.motifRefus ?? 'Exception refusée.', 409);
        compteur += 1;
        exceptions.push({
          id: `e_${compteur}`,
          demande: copie(corps.demande),
          creeeLe: versInstant(t),
          raison: corps.friction?.raison,
          pendantNuit: prix.friction === 'raison_phrase',
        });
      }),
  };
}
