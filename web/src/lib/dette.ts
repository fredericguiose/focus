// Proposition de rattraper le sommeil (CDC §4, « Rembourser la dette = facultatif », 01/11) :
// une fois par soir, après l'ouverture de la soirée, se coucher plus tôt à l'heure de son choix.
// Rien n'est recalculé ici : la dette est celle de l'API (`dette_cumulee_reelle_min`, celle que
// la carte Sommeil affiche), la phase et les heures viennent du statut.
import type { ReponseStatut } from '@/api/contrat';
import { ajouterJours, heureLocale, instantLocal } from './temps';

const MINUTE = 60_000;
export const PAS_MIN = 15;
/** Même tolérance que la carte Sommeil : en deçà, elle affiche « objectif atteint ». */
export const DETTE_MIN_PROPOSEE = 5;

/** Dette réelle mesurée, en minutes, si elle vaut la peine d'être proposée ; null sinon. */
export function detteARattraper(statut: ReponseStatut): number | null {
  const d = statut.dette_cumulee_reelle_min;
  return typeof d === 'number' && Math.round(d) > DETTE_MIN_PROPOSEE ? Math.round(d) : null;
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

/** Gain de sommeil et dette restante pour une heure de coucher choisie (minutes, jamais négatifs). */
export function bilan(coucherMs: number, choisiMs: number, detteMin: number): { gainMin: number; resteMin: number } {
  const gainMin = Math.max(0, Math.round((coucherMs - choisiMs) / MINUTE));
  return { gainMin, resteMin: Math.max(0, detteMin - gainMin) };
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
