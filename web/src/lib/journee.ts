import type { Journee } from '@/api/contrat';

export type CleRepere = 'lever' | 'ouverture' | 'coucher' | 'leverSuivant';

export interface Repere {
  cle: CleRepere;
  libelle: string;
  ms: number;
}

export function reperes(j: Journee): Repere[] {
  return [
    { cle: 'lever', libelle: 'Lever', ms: Date.parse(j.lever) },
    { cle: 'ouverture', libelle: 'Ouverture de la soirée', ms: Date.parse(j.ouverture) },
    { cle: 'coucher', libelle: 'Coucher', ms: Date.parse(j.coucherApplique) },
    { cle: 'leverSuivant', libelle: 'Lever suivant', ms: Date.parse(j.leverSuivant) },
  ];
}

/** Prochain repère de la journée après `maintenantMs` (ouverture, coucher ou lever suivant). */
export function prochainRepere(j: Journee, maintenantMs: number): Repere | null {
  return reperes(j).find((r) => r.cle !== 'lever' && r.ms > maintenantMs) ?? null;
}

/** Position (0 à 1) d'un instant sur la frise lever → lever suivant. */
export function positionSurFrise(j: Journee, ms: number): number {
  const debut = Date.parse(j.lever);
  const fin = Date.parse(j.leverSuivant);
  if (fin <= debut) return 0;
  return Math.min(1, Math.max(0, (ms - debut) / (fin - debut)));
}
