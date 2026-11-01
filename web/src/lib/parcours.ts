// Parcours de la journée (conception §2.5-2.7) : les modes de l'appareil principal remis dans
// l'ordre où la journée les traverse. L'API les donne dans l'ordre de priorité, avec leurs
// conditions évaluées maintenant ; seules les heures fixes (lever, coucher) sont des heures.
import type { ConditionParcours, EtapeParcours, Instant, Journee, ReponseStatut, StatutAppareil } from '@/api/contrat';
import { etatCondition, type EtatFait } from './etats';

/** Ordre du jour des modes connus ; un mode inconnu vient après, dans l'ordre de l'API. */
export const ORDRE_DU_JOUR = ['MORNING_LOCK', 'WORK', 'EVENING_FREE', 'NIGHT_LOCK'] as const;

export type EtatEtape = 'franchie' | 'active' | 'a_venir';

export type EtapeJour =
  | { genre: 'repere'; cle: 'lever' | 'lever_suivant'; libelle: string; heure: Instant; etat: EtatEtape }
  | { genre: 'mode'; cle: string; etape: EtapeParcours; heureFixe: Instant | null; etat: EtatEtape };

/** L'appareil désigné par l'API, sinon le premier (API plus ancienne). */
export function appareilPrincipal(statut: ReponseStatut): StatutAppareil | undefined {
  return statut.appareils.find((a) => a.appareil === statut.appareil_principal) ?? statut.appareils[0];
}

const rang = (mode: string) => {
  const i = (ORDRE_DU_JOUR as readonly string[]).indexOf(mode);
  return i === -1 ? ORDRE_DU_JOUR.length : i;
};

/** Une étape à heure fixe : la nuit (le coucher), ou un mode dont la seule condition est une heure. */
function heureFixe(etape: EtapeParcours, j: Journee): Instant | null {
  if (etape.mode === 'NIGHT_LOCK') return etape.conditions.find((c) => c.type === 'heure')?.a ?? j.coucherApplique;
  const [seule, ...autres] = etape.conditions;
  return etape.logique === 'simple' && autres.length === 0 && seule?.type === 'heure' ? seule.a : null;
}

/** Lever → modes dans l'ordre du jour → lever suivant ; null si l'API ne donne pas de parcours. */
export function etapesDuJour(appareil: StatutAppareil | undefined, j: Journee): EtapeJour[] | null {
  if (!appareil?.parcours || appareil.parcours.length === 0) return null;
  const modes = appareil.parcours
    .map((etape, i) => ({ etape, i }))
    .filter(({ etape }) => etape.applicable)
    .sort((a, b) => rang(a.etape.mode) - rang(b.etape.mode) || a.i - b.i)
    .map(({ etape }) => etape);
  const active = modes.findIndex((e) => e.actif);
  return [
    { genre: 'repere', cle: 'lever', libelle: 'Lever', heure: j.lever, etat: 'franchie' },
    ...modes.map(
      (etape, i): EtapeJour => ({
        genre: 'mode',
        cle: etape.mode,
        etape,
        heureFixe: heureFixe(etape, j),
        etat: active === -1 ? 'a_venir' : i < active ? 'franchie' : i === active ? 'active' : 'a_venir',
      }),
    ),
    { genre: 'repere', cle: 'lever_suivant', libelle: 'Lever', heure: j.leverSuivant, etat: 'a_venir' },
  ];
}

/** Ce qui manque : quelques mots en gros, la précision à part (couleur commune, lib/etats). */
export interface Manque {
  texte: string;
  detail: string | null;
  etat: EtatFait;
}

const A_FAIRE: Partial<Record<ConditionParcours['type'], string>> = {
  planning: 'Planning à faire',
  recap: 'Récap à faire',
  prioritaires: 'Tâches P1/P2 à faire',
  retard: 'Retards à rattraper',
};

/** Le fait qui manque, court ; la précision (« pas de planning fait depuis le 8 oct. ») reste en détail. Null pour « par défaut ». */
export function phraseManque(c: ConditionParcours): Omit<Manque, 'etat'> | null {
  if (c.type === 'toujours') return null;
  const detail = c.detail && c.detail !== 'à faire' ? c.detail : null;
  return { texte: A_FAIRE[c.type] ?? c.libelle, detail };
}

/**
 * Ce qui manque pour sortir du mode actif : le fait attendu par un mode `pas` qui le retient, sinon
 * les faits pas encore vrais de l'étape suivante du jour (l'heure seulement s'il ne manque rien d'autre).
 */
export function ceQuiManque(appareil: StatutAppareil | undefined, j: Journee): Manque[] {
  const etapes = etapesDuJour(appareil, j);
  if (!etapes) return [];
  const modes = etapes.flatMap((e) => (e.genre === 'mode' ? [e.etape] : []));
  const i = modes.findIndex((e) => e.actif);
  const active = modes[i];
  if (!active) return [];
  const manques = (conditions: ConditionParcours[]) =>
    conditions.flatMap((c) => {
      const m = phraseManque(c);
      return m === null ? [] : [{ ...m, etat: etatCondition(c) }];
    });
  if (active.logique === 'pas') return manques(active.conditions.filter((c) => !c.vraie));
  const suivante = modes[i + 1];
  // Entrer dans un mode `pas` n'est pas un objectif : rien à proposer.
  if (!suivante || suivante.logique === 'pas') return [];
  const fausses = suivante.conditions.filter((c) => !c.vraie);
  const sansHeure = fausses.filter((c) => c.type !== 'heure');
  const retenues = manques(sansHeure.length > 0 ? sansHeure : fausses);
  return suivante.logique === 'un_parmi' && retenues.length > 1
    ? [{ texte: retenues.map((m) => m.texte).join(' ou '), detail: null, etat: retenues[0]!.etat }]
    : retenues;
}
