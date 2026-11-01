// Journaux des levers et des couchers (docs/conception.md §3.1) : par jour, prévu et mesuré ; sur
// la période, l'écart entre la mesure la plus tôt et la plus tard, face à la limite. Affichés, ne
// bloquent rien. Une mesure ignorée pour décalage horaire (vu du fuseau de `jusqua`) est marquée
// et n'entre pas dans l'écart.

import type { CoucherJournalise, Contexte, DateLocale, Instant, JournalDesCouchers, JournalDesLevers, LeverJournalise } from './types';
import { coucherPrevu, leverMesure, leverPrevu, mesureIgnoree, reglagesDuLever, routineDuJour } from './journee';
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
  return { jours, amplitude: amplitude(mesures), limiteMin: reglagesDuLever(contexte.config).ecartLeverMaxMin };
}

/** La mesure la plus tôt et la plus tard (par minutes depuis le pivot du jour) ; null sous 2 mesures. */
function amplitude(mesures: { instant: number; minutes: number }[]): JournalDesLevers['amplitude'] {
  const tries = [...mesures].sort((a, b) => a.minutes - b.minutes);
  const plusTot = tries[0];
  const plusTard = tries.at(-1);
  return plusTot && plusTard && tries.length >= 2
    ? {
        plusTot: ecrireInstant(plusTot.instant),
        plusTard: ecrireInstant(plusTard.instant),
        ecartMin: Math.round(plusTard.minutes - plusTot.minutes),
        mesures: tries.length,
      }
    : null;
}

/** Pivot des endormissements : midi du soir de la nuit (23:30 et 00:30 sont à 1 h, pas à 23 h). */
const PIVOT_DES_NUITS_MIN = 12 * 60;

/**
 * Les `nbNuits` nuits finissant avant `jusqua` (de jusqua − nbNuits à jusqua − 1, celles des
 * levers du journal), de la plus ancienne à la plus récente. Le prévu est le coucher prévu figé
 * par la photo de la nuit (`prevusFiges`, par date de la nuit) ; à défaut, recalculé comme le
 * lever prévu du lendemain (seules les mesures d'avant ce matin-là). `endormissements` : début
 * mesuré de la nuit principale, par date de la nuit. Une nuit est ignorée pour décalage horaire
 * selon la règle des levers appliquée à son soir. Affichage seul : rien n'est contraint.
 */
export function journalDesCouchers(
  contexte: Contexte,
  jusqua: DateLocale,
  endormissements: Record<DateLocale, Instant>,
  prevusFiges: Record<DateLocale, Instant> = {},
  nbNuits = JOURS_DU_JOURNAL_DES_LEVERS,
): JournalDesCouchers {
  const nuits: CoucherJournalise[] = [];
  const mesures: { instant: number; minutes: number }[] = [];
  const fuseau = routineDuJour(contexte.config, jusqua).routine.fuseau;
  for (let n = nbNuits; n >= 1; n--) {
    const nuit = ajouterJours(jusqua, -n);
    const fige = prevusFiges[nuit];
    const prevu = fige !== undefined ? lireInstant(fige) : coucherPrevu(contexte, nuit);
    const brute = endormissements[nuit];
    const mesure = brute === undefined ? null : lireInstant(brute);
    const ignore = mesure === null ? null : mesureIgnoree(contexte.config, nuit, fuseau);
    nuits.push({
      nuit,
      prevu: ecrireInstant(prevu),
      prevuFige: fige !== undefined,
      mesure: mesure === null ? null : ecrireInstant(mesure),
      ecartMin: mesure === null ? null : Math.round((mesure - prevu) / MINUTE),
      ...(ignore ? { ignore } : {}),
    });
    if (mesure !== null && !ignore) {
      const { routine } = routineDuJour(contexte.config, nuit);
      mesures.push({ instant: mesure, minutes: (mesure - instantLocal(nuit, PIVOT_DES_NUITS_MIN, routine.fuseau)) / MINUTE });
    }
  }
  return { nuits, amplitude: amplitude(mesures), limiteMin: reglagesDuLever(contexte.config).ecartLeverMaxMin };
}
