import { describe, expect, it } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import type { ConditionParcours, EtapeParcours, StatutAppareil } from '@/api/contrat';
import { appareilPrincipal, ceQuiManque, etapesDuJour, phraseManque } from './parcours';

// Mardi 3 novembre 2026, 15:00 à Paris (journée), ouverture 19:50, coucher 21:30.
const MARDI_15H = Date.parse('2026-11-03T14:00:00Z');

async function statutEnPhase(phase: 'journee' | 'soiree' | 'nuit') {
  return creerApiSimulee({ maintenant: () => MARDI_15H, fuseau: 'Europe/Paris', phase }).statut();
}

const cles = (etapes: ReturnType<typeof etapesDuJour>) => etapes?.map((e) => e.cle);

describe('parcours de la journée', () => {
  it('remet les modes dans l’ordre du jour, entre le lever et le lever suivant', async () => {
    const statut = await statutEnPhase('journee');
    const pc = appareilPrincipal(statut);
    expect(pc?.appareil).toBe('pc_linux');
    // L'API les donne dans l'ordre de priorité : nuit, matin, soirée, travail.
    expect(pc?.parcours?.map((e) => e.mode)).toEqual(['NIGHT_LOCK', 'MORNING_LOCK', 'EVENING_FREE', 'WORK']);
    expect(cles(etapesDuJour(pc, statut.journee))).toEqual(['lever', 'MORNING_LOCK', 'WORK', 'EVENING_FREE', 'NIGHT_LOCK', 'lever_suivant']);
    // Le matin verrouillé ne s'applique pas à l'iPhone : il n'apparaît pas.
    const iphone = statut.appareils.find((a) => a.appareil === 'iphone');
    expect(cles(etapesDuJour(iphone, statut.journee))).toEqual(['lever', 'WORK', 'EVENING_FREE', 'NIGHT_LOCK', 'lever_suivant']);
  });

  it('marque l’étape active, atténue celles d’avant ; seules la nuit et les levers ont une heure', async () => {
    const statut = await statutEnPhase('soiree');
    const etapes = etapesDuJour(appareilPrincipal(statut), statut.journee)!;
    expect(etapes.map((e) => [e.cle, e.etat])).toEqual([
      ['lever', 'franchie'],
      ['MORNING_LOCK', 'franchie'],
      ['WORK', 'active'],
      ['EVENING_FREE', 'a_venir'],
      ['NIGHT_LOCK', 'a_venir'],
      ['lever_suivant', 'a_venir'],
    ]);
    const heures = etapes.flatMap((e) => (e.genre === 'mode' ? [[e.cle, e.heureFixe]] : []));
    expect(heures).toEqual([
      ['MORNING_LOCK', null],
      ['WORK', null],
      ['EVENING_FREE', null],
      ['NIGHT_LOCK', statut.journee.coucherApplique],
    ]);
  });

  it('dit ce qui manque pour sortir du mode actif', async () => {
    const journee = await statutEnPhase('journee');
    // Mode `pas` : le fait attendu (pas fait), en ✗ orange.
    expect(ceQuiManque(appareilPrincipal(journee), journee.journee)).toEqual([{ texte: 'Planning à faire', detail: null, etat: 'a_faire' }]);
    const soiree = await statutEnPhase('soiree');
    expect(ceQuiManque(appareilPrincipal(soiree), soiree.journee)).toEqual([
      { texte: 'Tâches P1/P2 à faire', detail: '2 restantes, dont 1 en retard depuis le 30 oct.', etat: 'a_faire' },
    ]);
  });

  it('phrases de ce qui manque : date du retard pour planning et récap, heure sans doublon', () => {
    const c = (type: ConditionParcours['type'], libelle: string, detail: string | null) => ({ type, libelle, vraie: false, detail, a: null });
    expect(phraseManque(c('planning', 'Planning du matin', 'en retard depuis le 8 oct.'))).toEqual({ texte: 'Planning à faire', detail: 'en retard depuis le 8 oct.' });
    expect(phraseManque(c('recap', "Récap d'hier", 'à faire'))).toEqual({ texte: 'Récap à faire', detail: null });
    expect(phraseManque(c('heure', 'Ouverture à 16:00', '+20 min de report'))).toEqual({ texte: 'Ouverture à 16:00', detail: '+20 min de report' });
    expect(phraseManque(c('toujours', 'Par défaut', null))).toBeNull();
  });

  it('tolère un mode inconnu : placé à la fin, avant le lever suivant', async () => {
    const statut = await statutEnPhase('journee');
    const pc = appareilPrincipal(statut)!;
    const inconnu: EtapeParcours = { mode: 'EXAM_LOCK', nom: 'Examen', applicable: true, actif: false, logique: 'un_parmi', conditions: [] };
    const avecInconnu: StatutAppareil = { ...pc, parcours: [inconnu, ...(pc.parcours ?? [])] };
    expect(cles(etapesDuJour(avecInconnu, statut.journee))).toEqual([
      'lever',
      'MORNING_LOCK',
      'WORK',
      'EVENING_FREE',
      'NIGHT_LOCK',
      'EXAM_LOCK',
      'lever_suivant',
    ]);
    // Sans parcours (API plus ancienne) : rien, sans planter.
    expect(etapesDuJour({ ...pc, parcours: undefined }, statut.journee)).toBeNull();
    expect(ceQuiManque({ ...pc, parcours: [{ ...inconnu, actif: true }] }, statut.journee)).toEqual([]);
  });
});
