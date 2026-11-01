// Vérification des engagements (docs/conception.md §3.8). Le moteur ne connaît aucune source :
// un engagement déclare un type de mesure, une mesure de ce type le jour même le rend « fait ».

import type { Contexte, DateLocale, EngagementVerifie, Mesure, StatutEngagement } from './types';
import { engagementEffectif, engagementsDuJour, exceptionsTriees, routineDuJour } from './journee';
import { ajouterJours, dateLocale, jourSemaine, lireInstant } from './temps';

/** Engagements de la routine retirés ce jour-là par une exception. */
function retiresDuJour(contexte: Contexte, date: DateLocale): Set<string> {
  const { routine } = routineDuJour(contexte.config, date);
  const prevus = new Set(routine.jours[jourSemaine(date)]?.engagements ?? []);
  const retires = new Set<string>();
  for (const { demande: d } of exceptionsTriees(contexte.exceptions)) {
    if (d.type === 'retire' && d.date === date && prevus.has(d.engagement)) retires.add(d.engagement);
  }
  return retires;
}

/**
 * Pour chaque jour de `du` à `au` et chaque engagement vérifiable prévu par la routine (ou
 * retiré ce jour-là) : `fait` si une mesure du type déclaré commence ce jour local ; sinon
 * `saute_declare` s'il a été retiré ; sinon `saute_non_declare` si le jour est passé ; sinon `a_faire`.
 * Un engagement facultatif ce jour-là, retiré ou passé sans être fait : `facultatif_non_fait`.
 */
export function verifierEngagements(contexte: Contexte, mesures: Mesure[], du: DateLocale, au: DateLocale): EngagementVerifie[] {
  const { config } = contexte;
  const maintenant = lireInstant(contexte.maintenant);
  const resultat: EngagementVerifie[] = [];
  for (let date = du; date <= au; date = ajouterJours(date, 1)) {
    const { routine } = routineDuJour(config, date);
    const retires = retiresDuJour(contexte, date);
    const ids = [...new Set([...engagementsDuJour(contexte, date).map((e) => e.id), ...retires])];
    const passe = date < dateLocale(maintenant, routine.fuseau);
    for (const id of ids) {
      const type = config.engagements[id]?.verification?.mesure;
      if (!type) continue;
      const fait = mesures.some((m) => m.type === type && dateLocale(lireInstant(m.debut), routine.fuseau) === date);
      const obligatoire = engagementEffectif(config, routine, id)?.obligatoire ?? true;
      const retire = retires.has(id);
      let statut: StatutEngagement;
      if (fait) statut = 'fait';
      else if (!obligatoire) statut = retire || passe ? 'facultatif_non_fait' : 'a_faire';
      else statut = retire ? 'saute_declare' : passe ? 'saute_non_declare' : 'a_faire';
      resultat.push({ date, engagement: id, nom: id.charAt(0).toUpperCase() + id.slice(1), statut });
    }
  }
  return resultat;
}
