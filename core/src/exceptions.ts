// Prix d'une exception (docs/conception.md §3.4). Resserrer est toujours permis ; desserrer
// exige une raison, et coûte plus cher une fois la soirée ouverte. Resserrer ou desserrer se
// juge sur l'EFFET : chaque nuit touchée (de la nuit courante à la nuit de l'exception, plus la
// fenêtre de régularité) est comparée avant / après.

import type { Contexte, DateLocale, DemandeException, Exception, FrictionFournie, Journee, PrixException } from './types';
import { engagementsDuJour, journee, journeeCourante, nuitDe } from './journee';
import { ajouterJours, dateCourte, ecartJours, estDate, estHeure, lireInstant, local, minutesDe } from './temps';

export const PHRASE_DECISION_DE_NUIT = 'JE NE PEUX PAS DECALER';
export const RAISON_MIN_CARACTERES = 50;
/** Préparation maximale d'un engagement ajouté ou décalé (4 h). */
export const PREPARATION_MAX_MIN = 240;
/** Nuits comparées après la nuit de l'exception : la fenêtre de régularité des levers (§3.1). */
const NUITS_DE_REGULARITE = 7;
/** Au-delà, seules la semaine qui suit maintenant et celle autour de l'exception sont comparées. */
const NUITS_COMPAREES_MAX = 60;

function duree(minutes: number): string {
  const m = Math.round(minutes);
  const signe = m < 0 ? '-' : '';
  const a = Math.abs(m);
  return `${signe}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
}

const TYPES = ['ajoute', 'retire', 'decale', 'coucher', 'avancer_coucher'];

/** Une demande sans type connu ou sans date valide n'a pas de nuit : c'est une erreur d'appel. */
function verifierForme(d: DemandeException): void {
  if (!TYPES.includes(d?.type)) throw new Error(`type d'exception inconnu « ${String(d?.type)} »`);
  const date: unknown = 'nuit' in d ? d.nuit : d.date;
  if (typeof date !== 'string' || !estDate(date)) throw new Error(`date invalide « ${String(date)} » (attendu AAAA-MM-JJ)`);
}

const PREPARATION_INVALIDE = `préparation invalide : attendu un nombre entier de minutes, de 0 à ${PREPARATION_MAX_MIN}`;
const preparationValide = (m: number) => Number.isInteger(m) && m >= 0 && m <= PREPARATION_MAX_MIN;

/** Motif de refus si la demande est mal formée ou vise un engagement impossible. */
function motifInvalide(contexte: Contexte, d: DemandeException): string | undefined {
  switch (d.type) {
    case 'ajoute':
      if (!d.libelle.trim()) return 'libellé vide';
      if ((d.heure !== undefined && !estHeure(d.heure)) || (d.reveil !== undefined && !estHeure(d.reveil))) {
        return 'heure invalide : attendu "HH:MM"';
      }
      if (d.preparationMin !== undefined && !preparationValide(d.preparationMin)) return PREPARATION_INVALIDE;
      return undefined;
    case 'coucher':
      return estHeure(d.heure) ? undefined : 'heure invalide : attendu "HH:MM"';
    case 'avancer_coucher':
      return Number.isNaN(Date.parse(d.a)) ? 'instant invalide : attendu ISO 8601 UTC' : undefined;
    case 'retire':
    case 'decale': {
      if (d.type === 'decale' && !estHeure(d.heure)) return 'heure invalide : attendu "HH:MM"';
      const present = engagementsDuJour(contexte, d.date).find((e) => e.id === d.engagement);
      const nom = `« ${d.engagement.charAt(0).toUpperCase()}${d.engagement.slice(1)} »`;
      if (!present) return `pas d'engagement ${nom} le ${dateCourte(d.date)}`;
      if (d.type === 'decale' && d.preparationMin !== undefined && !preparationValide(d.preparationMin)) return PREPARATION_INVALIDE;
      return undefined;
    }
  }
}

/** « Je vais dormir » ne peut qu'avancer le coucher : à partir du coucher appliqué, la nuit a commencé. */
function nuitCommencee(d: DemandeException, avant: Journee): string | undefined {
  if (d.type !== 'avancer_coucher' || lireInstant(d.a) < lireInstant(avant.coucherApplique)) return undefined;
  return `la nuit a déjà commencé à ${local(lireInstant(avant.coucherApplique), avant.fuseau).heure}`;
}

/**
 * Un engagement ajouté ou décalé ne réveille jamais avant `lever_plancher` (ni la veille au soir :
 * une préparation qui passe minuit donne un réveil négatif). Sinon, un engagement « 00:00 + 10 h »
 * ferait du lever un instant passé et finirait la nuit en cours.
 */
function reveilSousLePlancher(contexte: Contexte, d: DemandeException, apres: Contexte): string | undefined {
  if (d.type !== 'ajoute' && d.type !== 'decale') return undefined;
  const id = d.type === 'ajoute' ? d.libelle : d.engagement;
  const reveils = engagementsDuJour(apres, d.date)
    .filter((e) => e.id === id && e.origine === (d.type === 'ajoute' ? 'exception' : e.origine))
    .map((e) => e.reveilMin)
    .filter((r): r is number => r !== undefined);
  const plancher = minutesDe(contexte.config.sommeil.leverPlancher);
  const reveil = Math.min(...reveils);
  if (!(reveil < plancher)) return undefined;
  return `réveil à ${heureDe(reveil)}, avant le lever plancher de ${contexte.config.sommeil.leverPlancher}`;
}

function heureDe(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const veille = minutes < 0 ? ' (la veille)' : '';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}${veille}`;
}

/** Desserrer par nature : renoncer à un engagement, ou le repousser. */
function desserreParNature(contexte: Contexte, d: DemandeException): boolean {
  if (d.type === 'retire') return true;
  if (d.type !== 'decale') return false;
  // Sans heure, il ne fixait aucun réveil : lui en donner un ne peut qu'avancer le lever.
  const e = engagementsDuJour(contexte, d.date).find((x) => x.id === d.engagement)!;
  const reference = e.heureMin ?? e.reveilMin;
  return reference !== undefined && minutesDe(d.heure) > reference;
}

/** Les nuits dont l'exception peut changer le coucher ou le lever, à partir de la nuit courante. */
function nuitsTouchees(courante: DateLocale, nuit: DateLocale): DateLocale[] {
  const derniere = ajouterJours(nuit, NUITS_DE_REGULARITE);
  const n = ecartJours(courante, derniere);
  if (n < 0) return [];
  if (n <= NUITS_COMPAREES_MAX) return Array.from({ length: n + 1 }, (_, i) => ajouterJours(courante, i));
  // Exception lointaine : la régularité ne porte pas au-delà des blocs calculés (§3.1).
  const proches = Array.from({ length: NUITS_DE_REGULARITE + 1 }, (_, i) => ajouterJours(courante, i));
  const autour = Array.from({ length: 2 * NUITS_DE_REGULARITE + 1 }, (_, i) => ajouterJours(nuit, i - NUITS_DE_REGULARITE));
  return [...new Set([...proches, ...autour])].sort();
}

interface NuitComparee {
  nuit: DateLocale;
  avant: Journee;
  apres: Journee;
  /** Coucher plus tard, ou nuit en cours qui finit plus tôt. */
  desserree: boolean;
}

/**
 * Compare chaque nuit touchée. Une nuit est desserrée si son coucher recule, ou si elle a
 * commencé et que son lever avance (la nuit en cours finirait plus tôt). Refus net si un lever
 * à venir devient un instant passé : la journée en cours changerait sous les pieds.
 */
function comparerLesNuits(contexte: Contexte, apres: Contexte, nuits: DateLocale[]): { nuits: NuitComparee[]; leverPasse?: string } {
  const t = lireInstant(contexte.maintenant);
  const comparees: NuitComparee[] = [];
  for (const nuit of nuits) {
    const avant = journee(contexte, nuit);
    const ensuite = journee(apres, nuit);
    const leverAvant = lireInstant(avant.leverSuivant);
    const leverApres = lireInstant(ensuite.leverSuivant);
    if (leverApres <= t && t < leverAvant) {
      const heure = local(leverApres, ensuite.fuseau).heure;
      return { nuits: comparees, leverPasse: `le lever du ${dateCourte(ajouterJours(nuit, 1))} passerait à ${heure}, déjà passé` };
    }
    const commencee = t >= lireInstant(avant.coucherApplique);
    const desserree = lireInstant(ensuite.coucherApplique) > lireInstant(avant.coucherApplique) || (commencee && leverApres < leverAvant);
    comparees.push({ nuit, avant, apres: ensuite, desserree });
  }
  return { nuits: comparees };
}

/** Retirer ou repousser un engagement facultatif est libre : seul le plafond de sommeil compte. */
function facultatif(contexte: Contexte, d: DemandeException): boolean {
  if (d.type !== 'retire' && d.type !== 'decale') return false;
  return engagementsDuJour(contexte, d.date).find((e) => e.id === d.engagement)?.obligatoire === false;
}

function raisonManquante(friction: FrictionFournie | undefined): string | undefined {
  const raison = friction?.raison?.trim() ?? '';
  if (raison.length >= RAISON_MIN_CARACTERES) return undefined;
  return `raison d'au moins ${RAISON_MIN_CARACTERES} caractères exigée (${raison.length} fournis)`;
}

function frictionManquante(friction: FrictionFournie | undefined): string | undefined {
  const raison = raisonManquante(friction);
  if (raison) return `décision de nuit : ${raison}`;
  if (friction?.phrase !== PHRASE_DECISION_DE_NUIT) {
    return `décision de nuit : recopier exactement la phrase « ${PHRASE_DECISION_DE_NUIT} »`;
  }
  return undefined;
}

/**
 * Les contrôles sont ordonnés : si le motif de refus porte sur la friction, tout le reste est
 * admissible. Avant l'ouverture, desserrer exige une raison (friction 'raison'). Une décision
 * de nuit acceptée (friction 'raison_phrase') doit être enregistrée avec `pendantNuit: true` et
 * `nuitDecision` (la nuit qu'elle desserre, pas toujours celle de l'exception), et elle seule.
 * Lève une erreur si la demande n'a pas de nuit.
 */
export function prixException(contexte: Contexte, demande: DemandeException, friction?: FrictionFournie): PrixException {
  const { sommeil } = contexte.config;
  const t = lireInstant(contexte.maintenant);
  verifierForme(demande);
  const nuit = nuitDe(demande);
  const avant = journee(contexte, nuit);
  const simulee: Exception = { id: '(aperçu)', demande, creeeLe: contexte.maintenant, pendantNuit: false };
  const ctxApres: Contexte = { ...contexte, exceptions: [...contexte.exceptions, simulee] };
  const invalide = motifInvalide(contexte, demande) ?? nuitCommencee(demande, avant) ?? reveilSousLePlancher(contexte, demande, ctxApres);
  const apres = invalide ? avant : journee(ctxApres, nuit);

  const passee = t >= lireInstant(avant.leverSuivant);
  const comparaison: { nuits: NuitComparee[]; leverPasse?: string } = invalide || passee ? { nuits: [] } : comparerLesNuits(contexte, ctxApres, nuitsTouchees(journeeCourante(contexte).date, nuit));
  const desserrees = comparaison.nuits.filter((n) => n.desserree);
  const parNature = !invalide && desserreParNature(contexte, demande);

  const bilan = {
    resserre: !invalide && !comparaison.leverPasse && !parNature && desserrees.length === 0,
    coucherAvant: avant.coucherApplique,
    coucherApres: apres.coucherApplique,
    leverAvant: avant.leverSuivant,
    leverApres: apres.leverSuivant,
    detteAvantMin: avant.detteNuitMin,
    detteApresMin: apres.detteNuitMin,
  };
  const accepte = (f: PrixException['friction'], nuitDecision?: DateLocale): PrixException => ({
    admissible: true,
    friction: f,
    ...(nuitDecision !== undefined ? { nuitDecision } : {}),
    ...bilan,
  });
  const refuse = (motif: string, f: PrixException['friction'] = 'aucune', manquante = false): PrixException => ({
    admissible: false,
    motifRefus: motif,
    friction: f,
    ...(manquante ? { frictionManquante: true } : {}),
    ...bilan,
  });

  if (invalide) return refuse(invalide);
  if (passee) return refuse(`la nuit du ${dateCourte(nuit)} est passée`);
  if (comparaison.leverPasse) return refuse(comparaison.leverPasse);
  if (bilan.resserre) return accepte('aucune');

  // Nuits à juger : celles que l'effet desserre ; à défaut (renoncer sans effet), celle de l'exception.
  const ciblees: NuitComparee[] = desserrees.length > 0 ? desserrees : [{ nuit, avant, apres, desserree: true }];
  const ouverte = (n: NuitComparee) => t >= lireInstant(n.avant.ouverture);
  // Sommeil prévu, compté depuis l'endormissement (coucher + délai d'endormissement).
  const sommeilDe = (n: NuitComparee) => sommeil.cibleMin - n.apres.detteNuitMin;
  const sousLePlafond = (f: PrixException['friction'], facultatif: boolean): PrixException | undefined => {
    for (const n of ciblees) {
      const [plafond, nom] = ouverte(n) ? [sommeil.plancherNuitMin, 'le plancher de nuit'] : [sommeil.minimumMin, 'le minimum'];
      const prevu = sommeilDe(n);
      if (prevu < plafond) {
        const quelle = n.nuit === nuit ? '' : ` la nuit du ${dateCourte(n.nuit)}`;
        return refuse(`sommeil prévu${quelle} ${duree(prevu)}, sous ${nom} de ${duree(plafond)}`, facultatif ? 'aucune' : f);
      }
    }
    return undefined;
  };

  if (facultatif(contexte, demande)) return sousLePlafond('aucune', true) ?? accepte('aucune');

  // La nuit la plus chère : la première desserrée (les suivantes ouvrent plus tard).
  const premiere = ciblees[0]!;
  if (!ouverte(premiere)) {
    const refus = sousLePlafond('raison', false);
    if (refus) return refus;
    const manque = raisonManquante(friction);
    return manque ? refuse(manque, 'raison', true) : accepte('raison');
  }

  if (premiere.avant.decisionDeNuitPrise) {
    return refuse(`décision de nuit déjà prise pour la nuit du ${dateCourte(premiere.nuit)} (une seule par nuit)`, 'raison_phrase');
  }
  const refus = sousLePlafond('raison_phrase', false);
  if (refus) return refus;
  const manque = frictionManquante(friction);
  return manque ? refuse(manque, 'raison_phrase', true) : accepte('raison_phrase', premiere.nuit);
}
