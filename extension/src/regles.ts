// Règle de blocage locale : la même que le client PC (clients/pc/internal/planning/regles.go,
// `Evaluer`), appliquée au planning de l'appareil (GET /v1/planning). Module pur : ni chrome.*, ni
// réseau, ni horloge ; tout instant est passé en paramètre (millisecondes, heure du serveur).

/** Format de planning que cette règle sait lire (api/src/planning.ts, VERSION_FORMAT_PLANNING). */
export const VERSION_FORMAT = 1;

/** Sans rafraîchissement réussi depuis ce délai, le planning ne décide plus rien. */
export const AGE_MAX_MS = 10 * 60 * 1000;

export interface SegmentPlanning {
  debut: string;
  fin: string;
  mode: string;
  sessions: 'autorisees' | 'interdites';
  actions: { bloquer_domaines?: string[]; verrouiller_session?: boolean; fermer_comptes_hors_travail?: boolean };
}

export interface QuestionPlanning {
  id: string;
  posee_a: string;
  attente_s: number;
  expire_a: string;
}

export interface SessionPlanning {
  id: string;
  apps: string[];
  domaines?: string[];
  tache?: { id: string; nom: string } | null;
  question: QuestionPlanning | null;
  /** App à plafond propre (ex. « claude_code ») ; null ou absent : session normale. */
  plafond_app?: string | null;
  fin_au_plus_tard: string | null;
}

export interface Planning {
  version: number;
  appareil: string;
  heure_serveur: string;
  valable_jusqua: string;
  segments: SegmentPlanning[];
  sessions: SessionPlanning[];
  raison: string;
}

/** Planning reçu, avec ce qu'il faut pour le rejouer plus tard (horloge locale du navigateur). */
export interface PlanningRecu {
  planning: Planning;
  /** Horloge locale à la réception (ms). */
  recuLe: number;
  /** heure_serveur − horloge locale à la réception (ms), comme `Caler` côté Go. */
  decalageMs: number;
}

const instant = (s: string | null | undefined): number => (s ? Date.parse(s) : NaN);

/** Refuse ce qu'on ne saurait pas appliquer sans risque (comme `Planning.Valider` côté Go). */
export function validerPlanning(p: unknown): Planning {
  const x = p as Partial<Planning> | null;
  if (!x || typeof x !== 'object') throw new Error('planning absent');
  if (x.version !== VERSION_FORMAT) throw new Error(`version de planning ${String(x.version)} inconnue (attendu ${VERSION_FORMAT})`);
  if (Number.isNaN(instant(x.heure_serveur))) throw new Error('heure_serveur absente');
  if (Number.isNaN(instant(x.valable_jusqua))) throw new Error('valable_jusqua absent');
  if (!Array.isArray(x.segments) || !Array.isArray(x.sessions)) throw new Error('segments ou sessions absents');
  x.segments.forEach((s, i) => {
    if (!(instant(s.debut) < instant(s.fin))) throw new Error(`segment ${i} : début pas avant fin`);
  });
  x.sessions.forEach((s, i) => {
    if (!s.id) throw new Error(`session ${i} sans identifiant`);
  });
  return x as Planning;
}

export function normaliser(d: string): string {
  return d.trim().toLowerCase().replace(/\.$/, '');
}

/** Segment qui contient l'instant : début inclus, fin exclue. */
export function segmentEnVigueur(p: Planning, t: number): SegmentPlanning | null {
  return p.segments.find((s) => instant(s.debut) <= t && t < instant(s.fin)) ?? null;
}

/** Un segment qui verrouille l'écran ou interdit les sessions ne laisse aucune session libérer. */
export function sessionsPermises(seg: SegmentPlanning): boolean {
  return seg.sessions !== 'interdites' && !seg.actions.verrouiller_session;
}

/**
 * Session valide : fin_au_plus_tard non atteinte (fin incluse), et question non expirée.
 * L'extension ne connaît pas les « continue » acceptés par focusd : une question expirée compte
 * comme expirée, mais `decider` demande alors de confirmer avec un planning frais (voir plus bas).
 */
export function sessionValide(s: SessionPlanning, t: number): boolean {
  const fin = instant(s.fin_au_plus_tard);
  if (!Number.isNaN(fin) && t >= fin) return false;
  if (!s.question) return true;
  return t < instant(s.question.expire_a);
}

/** Domaines bloqués à l'instant t (heure du serveur), triés ; null si le planning a expiré. */
export function domainesBloques(p: Planning, t: number): string[] | null {
  if (!(t < instant(p.valable_jusqua))) return null;
  const seg = segmentEnVigueur(p, t);
  if (!seg) return [];
  const liberes = new Set<string>();
  if (sessionsPermises(seg)) {
    for (const s of p.sessions) {
      if (!sessionValide(s, t)) continue;
      for (const d of s.domaines ?? []) liberes.add(normaliser(d));
    }
  }
  const bloques = new Set<string>();
  for (const brut of seg.actions.bloquer_domaines ?? []) {
    const d = normaliser(brut);
    if (d && !liberes.has(d)) bloques.add(d);
  }
  return [...bloques].sort();
}

export type Decision =
  /** Planning absent, expiré ou trop vieux : il ne décide rien (repli sur la détection par erreur). */
  | { utilisable: false; motif: string }
  /**
   * `confirmer` : le domaine n'était pas bloqué à la réception du planning et l'est devenu par le
   * seul passage du temps (segment suivant, question expirée, fin de session). Le client PC a pu
   * entre-temps recevoir un planning différent (« continue » accepté…) : relire avant d'afficher.
   */
  | { utilisable: true; bloque: boolean; confirmer: boolean; mode: string | null };

/**
 * Le domaine est-il bloqué maintenant ? Correspondance exacte du nom d'hôte, comme le fichier
 * hosts (qui ne bloque que les noms écrits, sans joker : `music.youtube.com` n'est bloqué que s'il
 * est listé). L'hôte de l'API n'est jamais bloqué (le client PC l'écarte aussi).
 */
export function decider(recu: PlanningRecu | null, hote: string, maintenantLocal: number, hoteApi: string | null): Decision {
  if (!recu) return { utilisable: false, motif: 'aucun planning' };
  if (maintenantLocal - recu.recuLe > AGE_MAX_MS || maintenantLocal < recu.recuLe - 60_000) {
    return { utilisable: false, motif: 'planning trop vieux' };
  }
  const p = recu.planning;
  const t = maintenantLocal + recu.decalageMs;
  const bloquesMaintenant = domainesBloques(p, t);
  if (bloquesMaintenant === null) return { utilisable: false, motif: 'planning expiré (valable_jusqua)' };
  const mode = segmentEnVigueur(p, t)?.mode ?? null;
  const d = normaliser(hote);
  if (!d || (hoteApi !== null && d === normaliser(hoteApi))) return { utilisable: true, bloque: false, confirmer: false, mode };
  const bloque = bloquesMaintenant.includes(d);
  if (!bloque) return { utilisable: true, bloque, confirmer: false, mode };
  const aLaReception = domainesBloques(p, instant(p.heure_serveur)) ?? [];
  return { utilisable: true, bloque, confirmer: !aLaReception.includes(d), mode };
}

/**
 * Instant (heure du serveur) où le domaine cesse d'être bloqué par les segments, en enchaînant
 * les segments consécutifs qui le bloquent ; sessions non comptées. null : pas avant la fin du
 * planning (`valable_jusqua`), ou domaine pas bloqué par le segment en vigueur.
 */
export function finDuBlocage(p: Planning, domaine: string, t: number): number | null {
  const d = normaliser(domaine);
  const bloquePar = (seg: SegmentPlanning | null) => !!seg && (seg.actions.bloquer_domaines ?? []).some((x) => normaliser(x) === d);
  if (!bloquePar(segmentEnVigueur(p, t))) return null;
  let fin = t;
  for (let seg = segmentEnVigueur(p, fin); bloquePar(seg); seg = segmentEnVigueur(p, fin)) fin = instant(seg!.fin);
  return fin < instant(p.valable_jusqua) ? fin : null;
}

/** Résumé pour la vérification des options : mode en vigueur et nombre de domaines bloqués. */
export function resume(recu: PlanningRecu, maintenantLocal: number): { mode: string | null; domaines: number } {
  const t = maintenantLocal + recu.decalageMs;
  return { mode: segmentEnVigueur(recu.planning, t)?.mode ?? null, domaines: domainesBloques(recu.planning, t)?.length ?? 0 };
}

// ─── Questions posées par l'extension ─────────────────────────────────────────────────────────

/** Question à poser dans le navigateur, avec ce qu'il faut pour l'afficher. */
export interface QuestionAPoser {
  sessionId: string;
  tache: string | null;
  question: QuestionPlanning;
}

/**
 * L'API renvoie la question suivante dès sa création, avec un `posee_a` futur. Elle est à poser
 * entre `posee_a` (inclus) et `expire_a` (exclu), pour les sessions normales seulement : celles à
 * plafond propre (Claude Code) n'ont leur question que dans le dialogue du client PC.
 */
export function aPoserDansLeNavigateur(s: SessionPlanning): boolean {
  return s.question !== null && !s.plafond_app;
}

/** Questions dues à l'instant t (heure du serveur), d'après le planning. */
export function questionsDues(p: Planning, t: number): QuestionAPoser[] {
  return p.sessions
    .filter((s) => aPoserDansLeNavigateur(s) && sessionValide(s, t) && instant(s.question!.posee_a) <= t)
    .map((s) => ({ sessionId: s.id, tache: s.tache?.nom ?? null, question: s.question! }));
}

/** Prochain `posee_a` futur (heure du serveur) parmi les questions à poser ; null s'il n'y en a pas. */
export function prochainePose(p: Planning, t: number): number | null {
  const futurs = p.sessions
    .filter((s) => aPoserDansLeNavigateur(s) && sessionValide(s, t))
    .map((s) => instant(s.question!.posee_a))
    .filter((x) => x > t);
  return futurs.length > 0 ? Math.min(...futurs) : null;
}

/** État de la fenêtre de question à l'instant t (heure du serveur), comme la web app. */
export function etatQuestion(q: QuestionPlanning, t: number): { avantContinuerS: number; avantExpirationS: number; peutContinuer: boolean; expiree: boolean } {
  const continuerDes = instant(q.posee_a) + q.attente_s * 1000;
  const expireA = instant(q.expire_a);
  const expiree = t >= expireA;
  return {
    avantContinuerS: Math.max(0, Math.ceil((continuerDes - t) / 1000)),
    avantExpirationS: Math.max(0, Math.ceil((expireA - t) / 1000)),
    peutContinuer: !expiree && t >= continuerDes,
    expiree,
  };
}
