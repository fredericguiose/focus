// Prix d'une exception (docs/conception.md §3.4). Resserrer est toujours permis ; desserrer
// exige une raison, et coûte plus cher une fois la soirée ouverte.

import type { Contexte, DemandeException, Exception, FrictionFournie, Journee, PrixException } from './types';
import { engagementsDuJour, journee, nuitDe } from './journee';
import { dateCourte, estDate, estHeure, lireInstant, local, MINUTE, minutesDe } from './temps';

export const PHRASE_DECISION_DE_NUIT = 'JE NE PEUX PAS DECALER';
export const RAISON_MIN_CARACTERES = 50;

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

/** Motif de refus si la demande est mal formée ou vise un engagement impossible. */
function motifInvalide(contexte: Contexte, d: DemandeException): string | undefined {
  switch (d.type) {
    case 'ajoute':
      if (!d.libelle.trim()) return 'libellé vide';
      if ((d.heure !== undefined && !estHeure(d.heure)) || (d.reveil !== undefined && !estHeure(d.reveil))) {
        return 'heure invalide : attendu "HH:MM"';
      }
      if (d.preparationMin !== undefined && !(Number.isInteger(d.preparationMin) && d.preparationMin >= 0)) {
        return 'préparation invalide : attendu un nombre entier de minutes';
      }
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
      if (d.type === 'decale' && d.preparationMin !== undefined && !(Number.isInteger(d.preparationMin) && d.preparationMin >= 0)) {
        return 'préparation invalide : attendu un nombre entier de minutes';
      }
      return undefined;
    }
  }
}

/** « Je vais dormir » ne peut qu'avancer le coucher : à partir du coucher appliqué, la nuit a commencé. */
function nuitCommencee(d: DemandeException, avant: Journee): string | undefined {
  if (d.type !== 'avancer_coucher' || lireInstant(d.a) < lireInstant(avant.coucherApplique)) return undefined;
  return `la nuit a déjà commencé à ${local(lireInstant(avant.coucherApplique), avant.fuseau).heure}`;
}

/** Resserrer : coucher plus tôt, engagement ajouté ou avancé. */
function resserre(contexte: Contexte, d: DemandeException, avant: Journee, apres: Journee): boolean {
  switch (d.type) {
    case 'ajoute':
      return true;
    case 'retire':
      return false;
    case 'decale': {
      // Sans heure, il ne fixait aucun réveil : lui en donner un ne peut qu'avancer le lever.
      const e = engagementsDuJour(contexte, d.date).find((x) => x.id === d.engagement)!;
      const reference = e.heureMin ?? e.reveilMin;
      return reference === undefined || minutesDe(d.heure) <= reference;
    }
    case 'coucher':
    case 'avancer_coucher':
      return lireInstant(apres.coucherApplique) <= lireInstant(avant.coucherApplique);
  }
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
 * de nuit acceptée (friction 'raison_phrase') doit être enregistrée avec `pendantNuit: true`,
 * et elle seule. Lève une erreur si la demande n'a pas de nuit.
 */
export function prixException(contexte: Contexte, demande: DemandeException, friction?: FrictionFournie): PrixException {
  const { sommeil } = contexte.config;
  const t = lireInstant(contexte.maintenant);
  verifierForme(demande);
  const nuit = nuitDe(demande);
  const avant = journee(contexte, nuit);
  const invalide = motifInvalide(contexte, demande) ?? nuitCommencee(demande, avant);
  const simulee: Exception = { id: '(aperçu)', demande, creeeLe: contexte.maintenant, pendantNuit: false };
  const apres = invalide ? avant : journee({ ...contexte, exceptions: [...contexte.exceptions, simulee] }, nuit);

  const bilan = {
    resserre: !invalide && resserre(contexte, demande, avant, apres),
    coucherAvant: avant.coucherApplique,
    coucherApres: apres.coucherApplique,
    leverAvant: avant.leverSuivant,
    leverApres: apres.leverSuivant,
    detteAvantMin: avant.detteNuitMin,
    detteApresMin: apres.detteNuitMin,
  };
  const accepte = (f: PrixException['friction']): PrixException => ({ admissible: true, friction: f, ...bilan });
  const refuse = (motif: string, f: PrixException['friction'] = 'aucune', manquante = false): PrixException => ({
    admissible: false,
    motifRefus: motif,
    friction: f,
    ...(manquante ? { frictionManquante: true } : {}),
    ...bilan,
  });

  if (invalide) return refuse(invalide);
  if (t >= lireInstant(avant.leverSuivant)) return refuse(`la nuit du ${dateCourte(nuit)} est passée`);
  if (bilan.resserre) return accepte('aucune');

  const sommeilApres = (lireInstant(apres.leverSuivant) - lireInstant(apres.coucherApplique)) / MINUTE;
  if (facultatif(contexte, demande)) {
    const [plafond, nom] = t < lireInstant(avant.ouverture)
      ? [sommeil.minimumMin, 'le minimum'] : [sommeil.plancherNuitMin, 'le plancher de nuit'];
    if (sommeilApres < plafond) return refuse(`sommeil prévu ${duree(sommeilApres)}, sous ${nom} de ${duree(plafond)}`);
    return accepte('aucune');
  }
  if (t < lireInstant(avant.ouverture)) {
    if (sommeilApres < sommeil.minimumMin) {
      return refuse(`sommeil prévu ${duree(sommeilApres)}, sous le minimum de ${duree(sommeil.minimumMin)}`, 'raison');
    }
    const manque = raisonManquante(friction);
    return manque ? refuse(manque, 'raison', true) : accepte('raison');
  }

  if (avant.decisionDeNuitPrise) return refuse(`décision de nuit déjà prise pour la nuit du ${dateCourte(nuit)} (une seule par nuit)`, 'raison_phrase');
  if (sommeilApres < sommeil.plancherNuitMin) {
    return refuse(`sommeil prévu ${duree(sommeilApres)}, sous le plancher de nuit de ${duree(sommeil.plancherNuitMin)}`, 'raison_phrase');
  }
  const manque = frictionManquante(friction);
  return manque ? refuse(manque, 'raison_phrase', true) : accepte('raison_phrase');
}
