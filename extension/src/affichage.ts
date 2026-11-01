// Libellés lisibles des modes et des raisons, repris de la web app (web/src/lib/modes.ts) pour que
// l'extension parle comme elle. Module pur.

export type FamilleMode = 'nuit' | 'matin' | 'travail' | 'soiree' | 'inconnu';

export interface InfoMode {
  famille: FamilleMode;
  libelle: string;
}

const MODES: Record<string, InfoMode> = {
  NIGHT_LOCK: { famille: 'nuit', libelle: 'Nuit' },
  MORNING_LOCK: { famille: 'matin', libelle: 'Journée verrouillée' },
  WORK: { famille: 'travail', libelle: 'Travail' },
  EVENING_FREE: { famille: 'soiree', libelle: 'Soirée libre' },
};

export function infoMode(code: string): InfoMode {
  const connu = MODES[code];
  if (connu) return connu;
  const lisible = code.toLowerCase().replace(/_/g, ' ');
  return { famille: 'inconnu', libelle: lisible.charAt(0).toUpperCase() + lisible.slice(1) };
}

/** « WORK — tâches prioritaires restantes : 2 » → « Tâches prioritaires restantes : 2 ». */
export function raisonLisible(raison: string): string {
  const sansCode = raison
    .replace(/^[A-Z][A-Z_]*\s*[—–-]\s*/, '')
    .replace(/\b[A-Z][A-Z]+(?:_[A-Z]+)+\b/g, (code) => infoMode(code).libelle)
    .trim();
  return sansCode.charAt(0).toUpperCase() + sansCode.slice(1);
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Morceaux connus des raisons du moteur (core/src/conditions.ts), dits en mots courts. */
const MANQUES: [RegExp, (n: number) => string][] = [
  [/^tâches prioritaires restantes.*: (\d+)$/, (n) => pluriel(n, 'tâche prioritaire à finir', 'tâches prioritaires à finir')],
  [/^récaps en retard : (\d+)$/, (n) => pluriel(n, 'récap en retard', 'récaps en retard')],
  [/^planning à faire : (\d+)$/, () => 'Planning du jour à faire'],
  [/^retards restants : (\d+)$/, (n) => pluriel(n, 'retard à solder', 'retards à solder')],
];

function manqueLisible(morceau: string): string {
  const m = morceau.trim();
  for (const [motif, dire] of MANQUES) {
    const r = motif.exec(m);
    if (r) return dire(Number(r[1]));
  }
  const avant = /^avant (\d{1,2}:\d{2})$/.exec(m);
  if (avant) return `Attendre ${avant[1]}`;
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/**
 * Raison du mode, découpée pour l'affichage : « WORK — EVENING_FREE non atteint : a : 6, b : 1 »
 * → objectif « Soirée libre », manques [« 6 tâches prioritaires à finir », « 1 récap en retard »].
 * Sans « non atteint », la raison lisible entière est le seul élément.
 */
export function raisonDetaillee(raison: string): { objectif: string | null; manques: string[] } {
  const sansMode = raison.replace(/^[A-Z][A-Z_]*\s*[—–-]\s*/, '');
  const r = /^([A-Z][A-Z_]*) non atteint\s*:\s*(.+)$/.exec(sansMode);
  if (!r) return { objectif: null, manques: [raisonLisible(raison)].filter(Boolean) };
  const manques = r[2]!.split(/,\s+/).map(manqueLisible).filter(Boolean);
  return { objectif: infoMode(r[1]!).libelle, manques };
}

/** « 18:30 », « demain 07:00 », ou « lun. 3 nov. 07:00 » au-delà. */
export function echeanceLisible(fin: Date, maintenant: Date): string {
  const heure = fin.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const jour = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const ecart = Math.round((jour(fin) - jour(maintenant)) / 86_400_000);
  if (ecart <= 0) return heure;
  if (ecart === 1) return `demain ${heure}`;
  return `${fin.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} ${heure}`;
}

/** Initiale affichée quand le navigateur n'a pas d'icône pour le site. */
export function initiale(nom: string): string {
  const lettre = [...nom.replace(/^www\./, '').trim()][0] ?? '?';
  return lettre.toLocaleUpperCase('fr-FR');
}
