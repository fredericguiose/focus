// Frise de la journée : périodes nommées (couleurs des modes) et repères horaires, du lever au
// lever suivant. Échelle par morceaux : chaque période garde une largeur minimale pour que son nom
// et les heures de ses bornes restent lisibles au téléphone ; dans une période, l'échelle est linéaire.
import type { Journee } from '@/api/contrat';
import type { FamilleMode } from './modes';

export type ClePeriode = 'matin' | 'travail' | 'soiree' | 'nuit';
export type CleRepereFrise = 'lever' | 'ouverture' | 'coucher' | 'leverSuivant';

export interface PeriodeFrise {
  cle: ClePeriode;
  nom: string;
  famille: FamilleMode;
  debut: number;
  fin: number;
  /** Bornes sur la frise, de 0 à 1. */
  gauche: number;
  droite: number;
}

export interface RepereFrise {
  cle: CleRepereFrise;
  libelle: string;
  ms: number;
  position: number;
}

export interface Frise {
  periodes: PeriodeFrise[];
  reperes: RepereFrise[];
  /** Position de « maintenant », null hors de la journée. */
  maintenant: number | null;
}

const NOMS: Record<ClePeriode, string> = { matin: 'Matin', travail: 'Travail', soiree: 'Soirée libre', nuit: 'Nuit' };

/** Largeur minimale d'une période (fraction de la frise). */
export const LARGEUR_MIN = 0.2;

/** Largeurs proportionnelles aux durées, relevées à `min` puis renormalisées. */
export function largeurs(durees: number[], min = LARGEUR_MIN): number[] {
  const n = durees.length;
  if (n === 0) return [];
  const plancher = Math.min(min, 1 / n);
  const fixes = new Set<number>();
  for (;;) {
    const libre = 1 - fixes.size * plancher;
    const total = durees.reduce((s, d, i) => (fixes.has(i) ? s : s + Math.max(0, d)), 0);
    const l = durees.map((d, i) => (fixes.has(i) ? plancher : total > 0 ? (Math.max(0, d) / total) * libre : libre / (n - fixes.size)));
    const trop = l.findIndex((x, i) => !fixes.has(i) && x < plancher);
    if (trop === -1) return l;
    fixes.add(trop);
  }
}

/**
 * `modePrincipal` et `jusqua` : mode en cours de l'appareil principal et sa fin, donnés par l'API.
 * Le matin verrouillé dépend du planning du jour, pas de l'heure : il n'apparaît que s'il est en cours.
 */
export function construireFrise(j: Journee, maintenantMs: number, modePrincipal?: string, jusqua?: string | null): Frise {
  const lever = Date.parse(j.lever);
  const leverSuivant = Date.parse(j.leverSuivant);
  const coucher = Math.min(Date.parse(j.coucherApplique), leverSuivant);
  const ouverture = Math.min(Date.parse(j.ouverture), coucher);

  const brutes: { cle: ClePeriode; famille: FamilleMode; debut: number; fin: number }[] = [];
  let debutTravail = lever;
  if (modePrincipal === 'MORNING_LOCK') {
    const finMatin = Math.min(jusqua ? Date.parse(jusqua) : maintenantMs, ouverture);
    if (finMatin > lever) {
      brutes.push({ cle: 'matin', famille: 'matin', debut: lever, fin: finMatin });
      debutTravail = finMatin;
    }
  }
  brutes.push({ cle: 'travail', famille: 'travail', debut: debutTravail, fin: ouverture });
  brutes.push({ cle: 'soiree', famille: 'soiree', debut: ouverture, fin: coucher });
  brutes.push({ cle: 'nuit', famille: 'nuit', debut: coucher, fin: leverSuivant });
  const gardees = brutes.filter((p) => p.fin > p.debut);

  const l = largeurs(gardees.map((p) => p.fin - p.debut));
  let curseur = 0;
  const periodes = gardees.map((p, i): PeriodeFrise => {
    const gauche = curseur;
    curseur += l[i] ?? 0;
    return { ...p, nom: NOMS[p.cle], gauche, droite: i === gardees.length - 1 ? 1 : curseur };
  });

  const position = (ms: number): number => {
    if (periodes.length === 0) return 0;
    if (ms <= lever) return 0;
    if (ms >= leverSuivant) return 1;
    const p = periodes.find((x) => ms >= x.debut && ms < x.fin) ?? periodes[periodes.length - 1]!;
    return p.gauche + ((ms - p.debut) / (p.fin - p.debut)) * (p.droite - p.gauche);
  };

  const reperes: RepereFrise[] = [
    { cle: 'lever' as const, libelle: 'Lever', ms: lever },
    { cle: 'ouverture' as const, libelle: 'Ouverture', ms: ouverture },
    { cle: 'coucher' as const, libelle: 'Coucher', ms: coucher },
    { cle: 'leverSuivant' as const, libelle: 'Lever', ms: leverSuivant },
  ]
    // Sans soirée (ouverture = coucher), un seul repère suffit : le coucher.
    .filter((r) => !(r.cle === 'ouverture' && r.ms >= coucher))
    .map((r) => ({ ...r, position: position(r.ms) }));

  return {
    periodes,
    reperes,
    maintenant: maintenantMs >= lever && maintenantMs <= leverSuivant ? position(maintenantMs) : null,
  };
}
