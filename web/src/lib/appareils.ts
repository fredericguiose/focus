import type { StatutAppareil, TypeAppareil } from '@/api/contrat';

const LIBELLES_TYPE: Record<TypeAppareil, string> = {
  pc_linux: 'PC Linux',
  pc_windows: 'PC Windows',
  iphone: 'iPhone',
};

/** Nom affichable : celui du type si l'appareil porte le nom de son type, sinon le nom sans soulignés. */
export function libelleAppareil(a: Pick<StatutAppareil, 'appareil' | 'type'>): string {
  if (a.appareil === a.type) return LIBELLES_TYPE[a.type];
  const lisible = a.appareil.replace(/[_-]+/g, ' ');
  return lisible.charAt(0).toUpperCase() + lisible.slice(1);
}

export type EtatPing = 'recent' | 'retard' | 'absent';

// Un PC interroge l'API chaque minute, mais l'API n'enregistre le ping que toutes les 5 min :
// au-delà de 7 min, l'appareil est éteint, hors ligne ou en panne.
export const PING_RECENT_MS = 7 * 60_000;
export const PING_ABSENT_MS = 60 * 60_000;

export function etatPing(vuLe: string | null, maintenantMs: number): EtatPing {
  if (vuLe === null) return 'absent';
  const ecart = maintenantMs - Date.parse(vuLe);
  if (ecart <= PING_RECENT_MS) return 'recent';
  return ecart <= PING_ABSENT_MS ? 'retard' : 'absent';
}
