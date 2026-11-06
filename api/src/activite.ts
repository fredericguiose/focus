// Temps actif d'une app déclaré par le client PC (04/11 : Claude Code, via ses hooks).
//
// Avant : Claude Code ne passait en WORK que par une session ouverte à la main, et le plafond
// comptait le temps où la session restait ouverte ; une session oubliée brûlait le plafond. Ici,
// le client déclare chaque message (`debut`), des signes de vie pendant la réponse (`pouls`) et la
// fin de la réponse (`fin`). Est compté : de `debut` à min(fin, dernier signe de vie) + marge, en
// réunissant les conversations parallèles (une minute comptée une fois). Ne comptent pas : le
// temps passé hors d'un mode qui bloque l'app (`compte` = 0) et les dossiers exemptés (devoirs).
import { instructionsInvalider } from './cache';
import { chargerContexte, nouvelIdentifiant } from './contexte';
import type { Dependances, JetonAuthentifie } from './env';
import { requeteInvalide } from './erreurs';
import { ms, versInstant } from './temps';
import { type Corps, texte } from './validation';
import type { Config, Contexte, Moteur } from '../../core/src/types';

export interface LigneActivite {
  app: string;
  exempte: number;
  compte: number;
  debut: string;
  vu_le: string;
  fin: string | null;
}

const EVENEMENTS = ['debut', 'pouls', 'fin'] as const;
type Evenement = (typeof EVENEMENTS)[number];

/** Motif « /a/devoir-* » : `*` = tout sauf « / » ; le chemin peut être le dossier ou un sous-dossier. */
export function estExempte(dossier: string, motifs: string[]): boolean {
  return motifs.some((m) => {
    const corps = m.replace(/\/+$/, '').split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
    return new RegExp(`^${corps}(/.*)?$`).test(dossier);
  });
}

/** Fin comptée d'une ligne : son dernier signe de vie (ou sa fin) plus la marge. */
function finComptee(l: LigneActivite, margeMs: number): number {
  return ms(l.fin ?? l.vu_le) + margeMs;
}

/** La ligne compte-t-elle encore à l'instant `t` (réponse en cours ou dans la marge) ? */
export function active(l: LigneActivite, t: number, margeMs: number): boolean {
  return ms(l.debut) <= t && finComptee(l, margeMs) > t;
}

/** Secondes comptées sur [depuis, maintenant] : réunion des intervalles qui comptent. */
export function cumulActiviteS(lignes: LigneActivite[], depuis: number, maintenant: number, margeMs: number): number {
  const intervalles = lignes
    .filter((l) => l.compte === 1 && l.exempte === 0)
    .map((l) => [Math.max(ms(l.debut), depuis), Math.min(finComptee(l, margeMs), maintenant)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let courant: [number, number] | null = null;
  for (const [a, b] of intervalles) {
    if (courant && a <= courant[1]) courant[1] = Math.max(courant[1], b);
    else {
      if (courant) total += courant[1] - courant[0];
      courant = [a, b];
    }
  }
  if (courant) total += courant[1] - courant[0];
  return Math.floor(total / 1000);
}

/** Lignes de l'app qui peuvent compter après `depuis` (marge comprise). */
export async function chargerActivites(db: D1Database, utilisateur: string, app: string, depuis: string, margeMin: number): Promise<LigneActivite[]> {
  const borne = versInstant(ms(depuis) - margeMin * 60_000);
  const { results } = await db
    .prepare(
      `SELECT app, exempte, compte, debut, vu_le, fin FROM activites
       WHERE utilisateur = ? AND app = ? AND (fin IS NULL OR fin > ?) AND vu_le > ?`,
    )
    .bind(utilisateur, app, borne, borne)
    .all<LigneActivite>();
  return results;
}

/** Secondes de temps actif depuis le lever, pour l'app au temps actif ; 0 sans `temps_actif`. */
export async function cumulTempsActifS(db: D1Database, utilisateur: string, config: Config, lever: string, maintenant: Date): Promise<{ app: string; secondes: number } | null> {
  const actif = config.sessions.tempsActif;
  if (!actif) return null;
  const lignes = await chargerActivites(db, utilisateur, actif.app, lever, actif.margeMin);
  return { app: actif.app, secondes: cumulActiviteS(lignes, ms(lever), maintenant.getTime(), actif.margeMin * 60_000) };
}

/** L'app est-elle bloquée par le mode en vigueur sur l'appareil (temps qui compte) ? */
function bloqueeParLeMode(moteur: Moteur, contexte: Contexte, appareil: string, app: string): boolean {
  const actions = moteur.etat(contexte, appareil).actions;
  if (!('bloquer_domaines' in actions)) return false;
  const domaines = contexte.config.apps[app]?.domaines ?? [];
  return actions.bloquer_domaines.some((d) => domaines.includes(d));
}

const AUCUNE_CONVERSATION = /^[A-Za-z0-9_.:-]{1,128}$/;

export async function enregistrerActivite(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, corps: Corps) {
  if (jeton.typeJeton !== 'appareil') throw requeteInvalide('Réservé aux jetons d\'appareil.');
  const evenement = texte(corps, 'evenement', 10) as Evenement;
  if (!EVENEMENTS.includes(evenement)) throw requeteInvalide('Champ « evenement » : debut, pouls ou fin.', { champ: 'evenement' });
  const conversation = texte(corps, 'conversation', 128);
  if (!AUCUNE_CONVERSATION.test(conversation)) throw requeteInvalide('Champ « conversation » invalide.', { champ: 'conversation' });
  const dossier = texte(corps, 'dossier', 500);
  if (!dossier.startsWith('/')) throw requeteInvalide('Champ « dossier » : chemin absolu attendu.', { champ: 'dossier' });

  const maintenant = deps.maintenant();
  const t = versInstant(maintenant);
  const { contexte } = await chargerContexte(db, jeton.utilisateur, maintenant);
  const actif = contexte.config.sessions.tempsActif;
  if (!actif) return { enregistre: false, raison: 'temps actif non configuré' };
  const app = actif.app;

  const ouverte = await db
    .prepare(`SELECT id FROM activites WHERE utilisateur = ? AND conversation = ? AND app = ? AND fin IS NULL ORDER BY debut DESC LIMIT 1`)
    .bind(jeton.utilisateur, conversation, app)
    .first<{ id: string }>();

  const instructions: D1PreparedStatement[] = [];
  if (evenement === 'fin') {
    if (ouverte) instructions.push(db.prepare(`UPDATE activites SET fin = ?, vu_le = ? WHERE id = ?`).bind(t, t, ouverte.id));
  } else if (ouverte && evenement === 'pouls') {
    instructions.push(db.prepare(`UPDATE activites SET vu_le = ? WHERE id = ?`).bind(t, ouverte.id));
  } else {
    // Nouveau message : la ligne précédente de la conversation (fin manquée) se clôt à son dernier signe de vie.
    if (ouverte) instructions.push(db.prepare(`UPDATE activites SET fin = vu_le WHERE id = ?`).bind(ouverte.id));
    const exempte = estExempte(dossier, actif.exemptions) ? 1 : 0;
    const compte = bloqueeParLeMode(deps.moteur, contexte, jeton.nom, app) ? 1 : 0;
    instructions.push(
      db
        .prepare(
          `INSERT INTO activites (id, utilisateur, appareil, app, conversation, dossier, exempte, compte, debut, vu_le, fin)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .bind(nouvelIdentifiant('a'), jeton.utilisateur, jeton.nom, app, conversation, dossier, exempte, compte, t, t),
    );
  }
  if (instructions.length > 0) await db.batch([...instructions, ...instructionsInvalider(db, jeton.utilisateur)]);
  return { enregistre: instructions.length > 0 };
}
