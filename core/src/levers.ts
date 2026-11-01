// Journal des levers (docs/conception.md §3.1) : par jour, lever prévu et lever mesuré ; sur la
// période, l'écart entre le lever mesuré le plus tôt et le plus tard, face à la limite. Affiché,
// ne bloque rien. Une mesure ignorée pour décalage horaire (vu du fuseau de `jusqua`) est marquée
// et n'entre pas dans l'écart.

import type { Contexte, DateLocale, Instant, JournalDesLevers, LeverJournalise } from './types';
import { leverMesure, leverPrevu, mesureIgnoree, reglagesDuLever, routineDuJour } from './journee';
import { ajouterJours, ecrireInstant, instantLocal, lireInstant, MINUTE } from './temps';

export const JOURS_DU_JOURNAL_DES_LEVERS = 7;

/**
 * Les `nbJours` jours finissant à `jusqua` (inclus), du plus ancien au plus récent. Le prévu est
 * celui figé la veille au soir (`prevusFiges`, par date du lever) ; à défaut, recalculé avec les
 * seules mesures d'avant ce jour.
 */
export function journalDesLevers(
  contexte: Contexte,
  jusqua: DateLocale,
  prevusFiges: Record<DateLocale, Instant> = {},
  nbJours = JOURS_DU_JOURNAL_DES_LEVERS,
): JournalDesLevers {
  const jours: LeverJournalise[] = [];
  const mesures: { instant: number; minutes: number }[] = [];
  const fuseau = routineDuJour(contexte.config, jusqua).routine.fuseau;
  for (let n = nbJours - 1; n >= 0; n--) {
    const date = ajouterJours(jusqua, -n);
    const fige = prevusFiges[date];
    const prevu = fige !== undefined ? lireInstant(fige) : leverPrevu(contexte, date);
    const mesure = leverMesure(contexte, date);
    const ignore = mesure === null ? null : mesureIgnoree(contexte.config, date, fuseau);
    jours.push({
      date,
      prevu: ecrireInstant(prevu),
      prevuFige: fige !== undefined,
      mesure: mesure === null ? null : ecrireInstant(mesure),
      ecartMin: mesure === null ? null : Math.round((mesure - prevu) / MINUTE),
      ...(ignore ? { ignore } : {}),
    });
    if (mesure !== null && !ignore) {
      const { routine } = routineDuJour(contexte.config, date);
      mesures.push({ instant: mesure, minutes: (mesure - instantLocal(date, 0, routine.fuseau)) / MINUTE });
    }
  }
  const tries = [...mesures].sort((a, b) => a.minutes - b.minutes);
  const plusTot = tries[0];
  const plusTard = tries.at(-1);
  return {
    jours,
    amplitude:
      plusTot && plusTard && tries.length >= 2
        ? {
            plusTot: ecrireInstant(plusTot.instant),
            plusTard: ecrireInstant(plusTard.instant),
            ecartMin: Math.round(plusTard.minutes - plusTot.minutes),
            mesures: tries.length,
          }
        : null,
    limiteMin: reglagesDuLever(contexte.config).ecartLeverMaxMin,
  };
}
