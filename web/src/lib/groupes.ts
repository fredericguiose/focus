// Choix des apps d'une session (§4.5) : d'abord les groupes que le mode bloque, puis les apps
// bloquées hors de tout groupe. Une app peut figurer dans plusieurs groupes : la sélection porte
// toujours sur des identifiants d'apps, un groupe n'est qu'un raccourci pour cocher les siennes.
import type { AppBloquee, GroupeBloque } from '@/api/contrat';

export interface GroupeAffiche {
  id: string;
  nom: string;
  apps: AppBloquee[];
}

export function regrouperApps(apps: AppBloquee[], groupes: GroupeBloque[] | undefined): { groupes: GroupeAffiche[]; seules: AppBloquee[] } {
  const parId = new Map(apps.map((a) => [a.id, a]));
  const affiches = (groupes ?? [])
    .map((g) => ({ id: g.id, nom: g.nom, apps: g.apps.flatMap((id) => parId.get(id) ?? []) }))
    .filter((g) => g.apps.length > 0);
  const dansUnGroupe = new Set(affiches.flatMap((g) => g.apps.map((a) => a.id)));
  return { groupes: affiches, seules: apps.filter((a) => !dansUnGroupe.has(a.id)) };
}

/** État de la case « tout le groupe » : coché, partiel, ou vide. */
export function etatGroupe(groupe: GroupeAffiche, choisies: string[]): boolean | 'indeterminate' {
  const n = groupe.apps.filter((a) => choisies.includes(a.id)).length;
  return n === 0 ? false : n === groupe.apps.length ? true : 'indeterminate';
}

/** Cocher le groupe ajoute toutes ses apps ; le décocher (ou un état partiel → tout) les retire. */
export function basculerGroupe(groupe: GroupeAffiche, choisies: string[]): string[] {
  const ids = groupe.apps.map((a) => a.id);
  if (etatGroupe(groupe, choisies) === true) return choisies.filter((id) => !ids.includes(id));
  return [...choisies, ...ids.filter((id) => !choisies.includes(id))];
}
