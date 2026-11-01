// Adaptateur Todoist (API v1) → faits du moteur. Aucune règle de mode ici : on traduit et on
// date. L'ancienne REST v2 répond 410 ; `postponed_count` n'est jamais lu (il compte les
// changements de date dans les deux sens et s'efface) : le journal /activities fait foi.
import type { DateLocale, Instant, Priorite, Report, Tache } from '../../core/src/types';
import { ajouterJours, dateLocale, debutJourLocal, decalageFuseau, ms, versInstant } from './temps';

export const BASE_TODOIST = 'https://api.todoist.com/api/v1/';
const TAILLE_PAGE = 50;
const PAGES_MAX = 20;
/** Requêtes au plus par client (un passage) : une invocation de Worker a 50 sous-requêtes, D1 compris. */
export const REQUETES_MAX_TODOIST = 20;
const JOURS_COMMENTAIRE = 3;
/** Profondeur du journal lu : sert à compter les reports précédents d'une tâche. */
const JOURS_HISTORIQUE = 4;
/**
 * Tâches du jour, en retard, et des deux jours suivants : le planning couvre 36 h et doit
 * savoir, par exemple, que la tâche de planning de demain matin existe déjà.
 */
const FILTRE_TACHES = 'overdue | today | tomorrow | 3 days';
/** Échéance retirée : la tâche sort du jour pour une durée indéterminée, c'est un report. */
export const SANS_DATE: DateLocale = '9999-12-31';

export class ErreurTodoist extends Error {
  constructor(
    readonly statut: number,
    chemin: string,
  ) {
    super(`Todoist a répondu ${statut} sur ${chemin}`);
  }
}

/** Dernière deadline vue sur une tâche, et quand on l'a vue apparaître. */
export interface SuiviDeadline {
  date: DateLocale | null;
  poseeLe: Instant | null;
}

export interface ParametresFaits {
  maintenant: Date;
  /** Fuseau de la routine du jour : sert à dater les reports et les échéances à heure fixe. */
  fuseau: string;
  commentaireMin: number;
  etiquettesExclues: string[];
  suiviDeadlines: Record<string, SuiviDeadline>;
  /** Identifiant Todoist de l'utilisateur, s'il est déjà connu (évite un appel). */
  idUtilisateur?: string;
}

export interface ResultatFaits {
  idUtilisateur: string;
  taches: Tache[];
  reports: Report[];
  suiviDeadlines: Record<string, SuiviDeadline>;
}

export interface ClientTodoist {
  recupererFaits(p: ParametresFaits): Promise<ResultatFaits>;
  etiquettesExistantes(): Promise<string[]>;
}

// ─── Formes brutes de l'API v1 (seulement les champs lus) ────────────────────

export interface TacheTodoist {
  id: string;
  content: string;
  priority: number;
  labels: string[];
  due: { date: string; is_recurring?: boolean } | null;
  deadline: { date: string } | null;
  responsible_uid: string | null;
  checked: boolean;
  added_at: string | null;
  completed_at: string | null;
}

export interface EvenementTodoist {
  object_type: string;
  object_id: string;
  event_type: string;
  event_date: string;
  parent_item_id: string | null;
  initiator_id: string | null;
  extra_data: Record<string, unknown> | null;
}

interface Page<T> {
  results?: T[];
  items?: T[];
  next_cursor?: string | null;
}

// ─── Conversions ─────────────────────────────────────────────────────────────

/** Todoist : 4 = P1 (urgent) … 1 = P4 (normal). Le moteur ne connaît que p1…p4. */
export function prioriteDepuisTodoist(p: number): Priorite {
  if (p === 4) return 'p1';
  if (p === 3) return 'p2';
  if (p === 2) return 'p3';
  return 'p4';
}

function instantTodoist(v: string): Instant {
  // Un horodatage sans fuseau serait lu à l'heure locale de la machine.
  return versInstant(Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`));
}

/** Date seule, date-heure flottante (heure locale) ou instant UTC (fuseau fixe). */
export function dateDepuisTodoist(v: string, fuseau: string): DateLocale {
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(v)) return dateLocale(new Date(Date.parse(v)), fuseau);
  return v.slice(0, 10);
}

const JOUR_MS = 86_400_000;
const HEURE_MS = 3_600_000;

/**
 * Dans /activities, une échéance « journée entière » n'arrive pas en date seule : c'est la fin
 * du jour (23:59:59) dans le fuseau du compte Todoist, en UTC. Le 30 octobre à UTC−3 donne
 * "2026-10-31T02:59:59.000000Z". Ce fuseau n'est pas fourni : il se déduit de l'heure, seul
 * un décalage entre −12 h et +14 h étant possible. Les échéances à heure fixe (secondes à 0)
 * suivent la règle générale.
 */
export function dateEcheanceActivite(v: string, fuseau: string): DateLocale {
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(v)) return v.slice(0, 10);
  const t = Date.parse(v);
  const d = new Date(t);
  if (d.getUTCSeconds() === 59 && d.getUTCMinutes() % 15 === 14) {
    const ecart = (((JOUR_MS - 1000 - (t % JOUR_MS)) % JOUR_MS) + JOUR_MS) % JOUR_MS;
    const candidats = [ecart, ecart - JOUR_MS].filter((o) => o >= -12 * HEURE_MS && o <= 14 * HEURE_MS);
    if (candidats.length > 0) {
      const local = decalageFuseau(t, fuseau);
      const ecartRetenu = candidats.reduce((a, b) => (Math.abs(b - local) < Math.abs(a - local) ? b : a));
      return new Date(t + ecartRetenu).toISOString().slice(0, 10);
    }
  }
  return dateDepuisTodoist(v, fuseau);
}

function versTache(t: TacheTodoist, moi: string, fuseau: string): Tache {
  return {
    id: String(t.id),
    contenu: t.content,
    priorite: prioriteDepuisTodoist(t.priority),
    etiquettes: t.labels ?? [],
    echeance: t.due ? dateDepuisTodoist(t.due.date, fuseau) : null,
    deadline: t.deadline?.date ?? null,
    terminee: Boolean(t.checked || t.completed_at),
    termineeLe: t.completed_at ? instantTodoist(t.completed_at) : null,
    creeeLe: t.added_at ? instantTodoist(t.added_at) : versInstant(0),
    assigneeAMoi: !t.responsible_uid || String(t.responsible_uid) === moi,
  };
}

// ─── Reports ─────────────────────────────────────────────────────────────────

interface Candidat {
  tacheId: string;
  le: Instant;
  de: DateLocale;
  vers: DateLocale;
  precedents: number;
}

/**
 * Un report = l'échéance passe d'un jour ≤ jour du geste à un jour > jour du geste (ou
 * disparaît). Ne comptent pas : poser une date sur une tâche qui n'en avait pas, rapprocher
 * une date, et les gestes faits par quelqu'un d'autre ou par le système (initiateur absent).
 */
export function detecterReports(evenements: EvenementTodoist[], moi: string, fuseau: string): Candidat[] {
  const modifs = evenements
    .filter((e) => e.object_type === 'item' && e.event_type === 'updated')
    .sort((a, b) => ms(instantTodoist(a.event_date)) - ms(instantTodoist(b.event_date)));
  const vus = new Set<string>();
  const parTache = new Map<string, number>();
  const candidats: Candidat[] = [];
  for (const e of modifs) {
    if (String(e.initiator_id ?? '') !== moi) continue;
    const extra = e.extra_data ?? {};
    const ancienne = typeof extra.last_due_date === 'string' ? extra.last_due_date : null;
    if (!ancienne) continue;
    const le = instantTodoist(e.event_date);
    const jour = dateLocale(new Date(ms(le)), fuseau);
    const de = dateEcheanceActivite(ancienne, fuseau);
    if (de > jour) continue;
    const nouvelle = typeof extra.due_date === 'string' ? extra.due_date : null;
    const vers = nouvelle ? dateEcheanceActivite(nouvelle, fuseau) : SANS_DATE;
    if (vers <= jour) continue;
    // L'interface émet parfois plusieurs événements pour un seul geste : un report par tâche et par jour.
    const tacheId = String(e.object_id);
    const cle = `${tacheId}|${jour}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    const precedents = parTache.get(tacheId) ?? 0;
    parTache.set(tacheId, precedents + 1);
    candidats.push({ tacheId, le, de, vers, precedents });
  }
  return candidats;
}

/** Instants des commentaires assez longs, par tâche. */
export function commentairesParTache(evenements: EvenementTodoist[], commentaireMin: number): Map<string, number[]> {
  const notes = new Map<string, number[]>();
  for (const e of evenements) {
    if (e.object_type !== 'note' || e.event_type !== 'added' || !e.parent_item_id) continue;
    const contenu = e.extra_data?.content;
    if (typeof contenu !== 'string' || contenu.trim().length < commentaireMin) continue;
    const id = String(e.parent_item_id);
    notes.set(id, [...(notes.get(id) ?? []), ms(instantTodoist(e.event_date))]);
  }
  return notes;
}

/**
 * Une deadline n'a de date de pose que si on a vu la tâche sans elle puis avec : une deadline
 * déjà là au premier passage reste sans date (on ne facture pas sur une supposition).
 */
export function suivreDeadlines(
  precedent: Record<string, SuiviDeadline>,
  taches: Iterable<TacheTodoist>,
  maintenant: Instant,
): Record<string, SuiviDeadline> {
  const suivi: Record<string, SuiviDeadline> = {};
  for (const t of taches) {
    const id = String(t.id);
    const date = t.deadline?.date ?? null;
    const avant = precedent[id];
    if (!avant) suivi[id] = { date, poseeLe: null };
    else if (avant.date !== date) suivi[id] = { date, poseeLe: date ? maintenant : null };
    else suivi[id] = avant;
  }
  return suivi;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export interface OptionsClient {
  jeton: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  base?: string;
}

export function creerClientTodoist({ jeton, fetch: f = (u, i) => fetch(u, i), base = BASE_TODOIST }: OptionsClient): ClientTodoist {
  let requetes = 0;
  async function obtenir<T>(chemin: string, params: Record<string, string>): Promise<T> {
    // Au-delà, faits abandonnés (le cache précédent reste) plutôt qu'une invocation qui casse en route.
    if (++requetes > REQUETES_MAX_TODOIST) throw new Error(`Todoist : plus de ${REQUETES_MAX_TODOIST} requêtes en un passage, faits abandonnés.`);
    const url = new URL(chemin, base);
    for (const [cle, valeur] of Object.entries(params)) url.searchParams.set(cle, valeur);
    const reponse = await f(url.toString(), { headers: { Authorization: `Bearer ${jeton}` } });
    if (!reponse.ok) throw new ErreurTodoist(reponse.status, chemin);
    return (await reponse.json()) as T;
  }

  // Une page manquante ferait disparaître un commentaire, donc facturer un report documenté :
  // mieux vaut échouer et garder le cache précédent que rendre des faits incomplets.
  async function toutes<T>(chemin: string, params: Record<string, string>, cle: 'results' | 'items'): Promise<T[]> {
    const tout: T[] = [];
    let curseur: string | null | undefined;
    for (let page = 0; page < PAGES_MAX; page++) {
      const p = await obtenir<Page<T>>(chemin, { ...params, limit: String(TAILLE_PAGE), ...(curseur ? { cursor: curseur } : {}) });
      tout.push(...(p[cle] ?? []));
      curseur = p.next_cursor;
      if (!curseur) return tout;
    }
    throw new Error(`Todoist : plus de ${PAGES_MAX} pages sur ${chemin}, faits abandonnés.`);
  }

  return {
    async recupererFaits(p) {
      const moi = p.idUtilisateur ?? String((await obtenir<{ id: string }>('user', {})).id);
      const maintenant = versInstant(p.maintenant);
      const aujourdhui = dateLocale(p.maintenant, p.fuseau);
      // Depuis la veille : la journée courante commence au lever, elle peut être celle d'hier.
      const debutReports = debutJourLocal(ajouterJours(aujourdhui, -1), p.fuseau).getTime();

      const [actives, terminees, evenements] = await Promise.all([
        toutes<TacheTodoist>('tasks/filter', { query: FILTRE_TACHES }, 'results'),
        toutes<TacheTodoist>(
          'tasks/completed/by_completion_date',
          { since: versInstant(debutReports), until: maintenant },
          'items',
        ),
        toutes<EvenementTodoist>(
          'activities',
          {
            object_event_types: JSON.stringify(['item:updated', 'note:added']),
            // Un jour de marge : on ne sait pas dans quel fuseau Todoist lit cette date.
            date_from: ajouterJours(aujourdhui, -JOURS_HISTORIQUE - 1),
          },
          'results',
        ),
      ]);

      const connues = new Map<string, TacheTodoist>();
      for (const t of terminees) connues.set(String(t.id), t);
      for (const t of actives) connues.set(String(t.id), t);
      const taches = [...connues.values()].map((t) => versTache(t, moi, p.fuseau));

      const candidats = detecterReports(evenements, moi, p.fuseau).filter((r) => ms(r.le) >= debutReports);
      // Une tâche reportée à plus tard n'est plus dans le filtre du jour : on va la chercher.
      const absentes = [...new Set(candidats.map((r) => r.tacheId))].filter((id) => !connues.has(id));
      for (let i = 0; i < absentes.length; i += TAILLE_PAGE) {
        const lot = absentes.slice(i, i + TAILLE_PAGE);
        for (const t of await toutes<TacheTodoist>('tasks', { ids: lot.join(',') }, 'results')) connues.set(String(t.id), t);
      }

      const suiviDeadlines = suivreDeadlines(p.suiviDeadlines, connues.values(), maintenant);
      const notes = commentairesParTache(evenements, p.commentaireMin);
      const exclues = new Set(p.etiquettesExclues);
      const reports: Report[] = [];
      for (const r of candidats) {
        const t = connues.get(r.tacheId);
        // Tâche supprimée : priorité inconnue, on ne facture pas.
        if (!t) continue;
        if (t.responsible_uid && String(t.responsible_uid) !== moi) continue;
        if ((t.labels ?? []).some((e) => exclues.has(e))) continue;
        const instantReport = ms(r.le);
        const deadline = t.deadline?.date ?? null;
        const suivi = suiviDeadlines[r.tacheId];
        reports.push({
          tacheId: r.tacheId,
          priorite: prioriteDepuisTodoist(t.priority),
          le: r.le,
          de: r.de,
          vers: r.vers,
          deadline,
          deadlinePoseeLe: suivi && suivi.date === deadline ? suivi.poseeLe : null,
          reportsPrecedents: r.precedents,
          documente: (notes.get(r.tacheId) ?? []).some(
            (n) => n <= instantReport && n >= instantReport - JOURS_COMMENTAIRE * 86_400_000,
          ),
        });
      }
      return { idUtilisateur: moi, taches, reports, suiviDeadlines };
    },

    async etiquettesExistantes() {
      const [personnelles, partagees] = await Promise.all([
        toutes<{ name: string }>('labels', {}, 'results'),
        toutes<string>('labels/shared', {}, 'results'),
      ]);
      return [...new Set([...personnelles.map((e) => e.name), ...partagees])].sort();
    },
  };
}
