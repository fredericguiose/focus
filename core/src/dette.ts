// Dette de sommeil hebdomadaire (CDC §4, entrée du 01/11) : règle comptable, pas biologique.
// Fonctions pures partagées par l'API (statut) et la web app (mode simulé).
import { ajouterJours, JOURS_SEMAINE, jourSemaine } from './temps';
import type { DateLocale } from './types';

/** Bilans des semaines closes renvoyés par le statut. */
export const SEMAINES_DE_BILAN = 4;

/** Lundi de la semaine (lundi → dimanche) de la date locale D. */
export function lundiDe(date: DateLocale): DateLocale {
  return ajouterJours(date, -JOURS_SEMAINE.indexOf(jourSemaine(date)));
}

/** Une nuit du compte : temps endormi (null sans mesure) et siestes de la journée D (`siestes_min`). */
export interface NuitDuCompte {
  nuit: DateLocale;
  endormi_min: number | null;
  siestes_min: number;
}

/**
 * Compte d'une semaine, règle comptable validée le 01/11 : la nuit D appartient à la semaine de
 * la date D (la nuit de dimanche à lundi clôt la semaine). `dette_min` = Σ des manques
 * (cible − endormi > 0) des nuits mesurées ; `rattrape_min` = Σ des surplus (endormi − cible > 0)
 * + siestes rangées sur les nuits de la semaine : une sieste rattrape la nuit d'avant, donc celle
 * de la journée D + 1 compte pour la nuit D (`siestesDuJour` : celles de la journée en cours J, dont
 * la nuit J − 1 peut être dans la semaine) ; `reste_min` = max(0, dette − rattrapé). Les nuits non
 * mesurées ne comptent ni en dette ni en surplus : `nuits_mesurees` / `nuits_total` (nuits finies).
 */
export function compteSemaine(debut: DateLocale, nuits: NuitDuCompte[], cibleMin: number, siestesDuJour?: { jour: DateLocale; minutes: number }) {
  const fin = ajouterJours(debut, 6);
  const siennes = nuits.filter((n) => n.nuit >= debut && n.nuit <= fin);
  const siesteDe = new Map(nuits.map((n) => [n.nuit, n.siestes_min]));
  if (siestesDuJour) siesteDe.set(siestesDuJour.jour, siestesDuJour.minutes);
  let dette = 0;
  let rattrape = 0;
  let mesurees = 0;
  for (const n of siennes) {
    rattrape += siesteDe.get(ajouterJours(n.nuit, 1)) ?? 0;
    if (n.endormi_min === null) continue;
    mesurees++;
    const ecart = cibleMin - n.endormi_min;
    if (ecart > 0) dette += ecart;
    else rattrape -= ecart;
  }
  const dette_min = Math.round(dette);
  const rattrape_min = Math.round(rattrape);
  return { debut, fin, dette_min, rattrape_min, reste_min: Math.max(0, dette_min - rattrape_min), nuits_mesurees: mesurees, nuits_total: siennes.length };
}

/**
 * Semaine en cours (celle de la journée J) et bilans des `SEMAINES_DE_BILAN` semaines closes, la
 * plus récente d'abord. `nuits` : les nuits finies (avant J). `nuits_restantes` : de la nuit J
 * (ce soir) à celle du dimanche, incluses. Tout est recalculé à partir des mesures, rien n'est stocké.
 */
export function dettesHebdomadaires(jour: DateLocale, nuits: NuitDuCompte[], cibleMin: number, siestesDuJourMin: number) {
  const lundi = lundiDe(jour);
  const duJour = { jour, minutes: siestesDuJourMin };
  const courante = compteSemaine(lundi, nuits, cibleMin, duJour);
  const bilans = [];
  for (let k = 1; k <= SEMAINES_DE_BILAN; k++) {
    const b = compteSemaine(ajouterJours(lundi, -7 * k), nuits, cibleMin, duJour);
    bilans.push({
      debut: b.debut,
      fin: b.fin,
      dette_min: b.dette_min,
      rattrape_min: b.rattrape_min,
      non_rattrape_min: b.reste_min,
      nuits_mesurees: b.nuits_mesurees,
      nuits_total: b.nuits_total,
    });
  }
  return {
    dette_semaine: { ...courante, nuits_restantes: 7 - JOURS_SEMAINE.indexOf(jourSemaine(jour)) },
    bilans_semaines: bilans,
  };
}
