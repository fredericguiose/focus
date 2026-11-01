// Proposition de rattraper le sommeil (CDC §4, « Rembourser la dette = facultatif » et « Dette de
// sommeil hebdomadaire », 01/11) : une fois par soir, après l'ouverture de la soirée, se coucher
// plus tôt à l'heure de son choix. La dette est celle de la semaine en cours (`dette_semaine` de
// l'API, celle que la carte Sommeil affiche) ; l'objectif du soir la répartit sur les nuits qui
// restent, plafonné à 1 h. La phase et les heures viennent du statut.
import type { ReponseStatut } from '@/api/contrat';
import { ajouterJours, heureLocale, instantLocal } from './temps';

const MINUTE = 60_000;
export const PAS_MIN = 15;
/** Même tolérance que la carte Sommeil : en deçà, elle affiche « objectif atteint ». */
export const DETTE_MIN_PROPOSEE = 5;

/** Plafond de l'objectif du soir (CDC : « plafond 1 h par soir »). */
export const OBJECTIF_MAX_MIN = 60;

/** Reste à rattraper cette semaine et nuits pour le faire, si cela vaut la peine d'être proposé ; null sinon. */
export function detteARattraper(statut: ReponseStatut): { resteMin: number; nuits: number } | null {
  const s = statut.dette_semaine;
  if (!s) return null;
  const reste = Math.round(s.reste_min);
  return reste > DETTE_MIN_PROPOSEE ? { resteMin: reste, nuits: Math.max(1, s.nuits_restantes) } : null;
}

/** Objectif du soir : reste ÷ nuits restantes, au quart d'heure supérieur, entre 15 min et 1 h. */
export function objectifDuSoir(resteMin: number, nuits: number): number {
  const parNuit = Math.ceil(resteMin / Math.max(1, nuits) / PAS_MIN) * PAS_MIN;
  return Math.min(OBJECTIF_MAX_MIN, Math.max(PAS_MIN, parNuit));
}

/** L'heure « HH:MM » d'une exception `coucher` de la nuit D désigne-t-elle bien cet instant ? */
function exprimable(ms: number, nuit: string, fuseau: string): boolean {
  const heure = heureLocale(ms, fuseau);
  const [h, m] = heure.split(':').map(Number);
  // Règle du moteur (instantCoucher) : 12:00–23:59 le jour D, 00:00–11:59 le lendemain.
  const jour = (h ?? 0) * 60 + (m ?? 0) >= 12 * 60 ? nuit : ajouterJours(nuit, 1);
  return instantLocal(jour, heure, fuseau) === ms;
}

/**
 * Heures de coucher proposées, du coucher appliqué (gain nul) à la plus tôt : maintenant arrondi
 * au quart d'heure suivant, puis de quart d'heure en quart d'heure. Jamais après le coucher appliqué.
 */
export function heuresProposees(statut: ReponseStatut, maintenantMs: number): number[] {
  const j = statut.journee;
  const coucher = Date.parse(j.coucherApplique);
  const pas = PAS_MIN * MINUTE;
  const plusTot = Math.ceil(maintenantMs / pas) * pas;
  if (plusTot >= coucher) return [];
  const liste = [coucher];
  for (let t = Math.ceil(coucher / pas) * pas - pas; t >= plusTot; t -= pas) {
    if (t < coucher && exprimable(t, j.date, j.fuseau)) liste.push(t);
  }
  return liste;
}

/**
 * Faut-il proposer de rattraper ce soir ? Dette mesurée, soirée ouverte (phase de l'API et heure
 * réelle), coucher pas encore avancé ni décision de nuit prise, au moins un quart d'heure à gagner.
 */
export function propositionPossible(statut: ReponseStatut, maintenantMs: number): boolean {
  const j = statut.journee;
  if (detteARattraper(statut) === null) return false;
  if (statut.phase !== 'soiree') return false;
  if (maintenantMs < Date.parse(j.ouverture) || maintenantMs >= Date.parse(j.coucherApplique)) return false;
  if (j.decisionDeNuitPrise) return false;
  if (Date.parse(j.coucherApplique) < Date.parse(j.coucherPrevu)) return false;
  const heures = heuresProposees(statut, maintenantMs);
  return heures.length >= 2 && heures[0]! - heures.at(-1)! >= PAS_MIN * MINUTE;
}

/**
 * Heure suggérée : coucher appliqué − objectif, ramenée dans les heures proposées (la plus tardive
 * qui atteint l'objectif) ; la plus tôt possible si aucune ne l'atteint.
 */
export function heureSuggeree(heures: number[], objectifMin: number): number | undefined {
  const coucher = heures[0];
  if (coucher === undefined) return undefined;
  const cible = coucher - objectifMin * MINUTE;
  return heures.find((h) => h <= cible) ?? heures.at(-1);
}

/** Gain de sommeil pour une heure de coucher choisie et progression vers l'objectif du soir (0 → 100). */
export function bilan(coucherMs: number, choisiMs: number, objectifMin: number): { gainMin: number; progression: number } {
  const gainMin = Math.max(0, Math.round((coucherMs - choisiMs) / MINUTE));
  return { gainMin, progression: objectifMin > 0 ? Math.min(100, (gainMin / objectifMin) * 100) : 0 };
}

// ─── Une fois par soir ─────────────────────────────────────────────────────────

const PREFIXE = 'focus.dette.proposee.';
/** Si le stockage échoue, la mémoire de la session empêche la proposition de revenir en boucle. */
const vuesEnMemoire = new Set<string>();

export function dejaProposee(nuit: string): boolean {
  if (vuesEnMemoire.has(nuit)) return true;
  try {
    return localStorage.getItem(PREFIXE + nuit) !== null;
  } catch {
    return false;
  }
}

export function marquerProposee(nuit: string): void {
  vuesEnMemoire.add(nuit);
  try {
    localStorage.setItem(PREFIXE + nuit, '1');
    // Ménage : les clés des nuits passées ne servent plus.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const cle = localStorage.key(i);
      if (cle?.startsWith(PREFIXE) && cle !== PREFIXE + nuit) localStorage.removeItem(cle);
    }
  } catch {
    /* gardé en mémoire seulement */
  }
}

/** Pour les tests : oublie la mémoire de session. */
export function oublierPropositions(): void {
  vuesEnMemoire.clear();
}
