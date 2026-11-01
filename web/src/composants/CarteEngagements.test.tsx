import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { creerApiSimulee } from '@/api/simule';
import { CarteEngagements, etatDe, sautesEnMots } from '@/composants/statut/CarteEngagements';

// Vendredi 06/11/2026 16:00 à Paris ; sport (simulé) lun, mer, ven, et le samedi sans heure, facultatif.
const VENDREDI = Date.parse('2026-11-06T15:00:00Z');
const api = () => creerApiSimulee({ maintenant: () => VENDREDI, fuseau: 'Europe/Paris', phase: 'journee' });

describe('carte « Engagements »', () => {
  it('mode simulé : 7 derniers jours, aujourd’hui et la fin de la semaine', async () => {
    const s = await api().statut();
    expect(s.aujourdhui).toBe('2026-11-06');
    expect(s.engagements_verifies!.map((e) => [e.date, e.statut])).toEqual([
      ['2026-10-30', 'fait'],
      ['2026-10-31', 'facultatif_non_fait'],
      ['2026-11-02', 'saute_non_declare'],
      ['2026-11-04', 'fait'],
      ['2026-11-06', 'a_faire'],
      ['2026-11-07', 'a_faire'],
    ]);
    expect(s.sautes_semaine).toBe(1);
  });

  it('annuler une séance obligatoire : « annulée à l’avance » ; une facultative : non faite, hors des sautées', async () => {
    const jeudi = creerApiSimulee({ maintenant: () => Date.parse('2026-11-05T15:00:00Z'), fuseau: 'Europe/Paris', phase: 'journee' });
    await jeudi.enregistrerException({ demande: { type: 'retire', date: '2026-11-06', engagement: 'sport' }, friction: { raison: 'r'.repeat(50) } });
    expect((await jeudi.statut()).engagements_verifies!.find((e) => e.date === '2026-11-06')!.statut).toBe('saute_declare');

    const a = api();
    await a.enregistrerException({ demande: { type: 'retire', date: '2026-11-07', engagement: 'sport' } });
    const s = await a.statut();
    expect(s.engagements_verifies!.at(-1)).toMatchObject({ date: '2026-11-07', statut: 'facultatif_non_fait' });
    expect(s.sautes_semaine).toBe(1);
    render(<CarteEngagements statut={s} />);
    expect(screen.getByLabelText('sam. 7 nov. : non faite (facultative)')).toBeTruthy();
    expect(screen.queryByText(/rien n’est bloqué|non comptées/)).toBeNull();
  });

  it('affiche l’état du jour, la semaine en cases et le compte des séances sautées', async () => {
    const s = await api().statut();
    render(<CarteEngagements statut={s} />);
    expect(screen.getByText('Engagements')).toBeTruthy();
    expect(screen.getByText('pas encore de séance enregistrée')).toBeTruthy();
    expect(screen.getByLabelText('lun. 2 nov. : sauté sans l’annuler')).toBeTruthy();
    expect(screen.getByLabelText('sam. 7 nov. : à venir')).toBeTruthy();
    expect(screen.getByText('1 séance sautée cette semaine')).toBeTruthy();
  });

  it('sans engagement vérifié par l’API : pas de carte', () => {
    const { container } = render(<CarteEngagements statut={{ journee: { date: '2026-11-06' } } as never} />);
    expect(container.textContent).toBe('');
  });

  it('textes', () => {
    expect(sautesEnMots(0)).toBe('Aucune séance sautée cette semaine');
    expect(sautesEnMots(2)).toBe('2 séances sautées cette semaine');
    expect(etatDe({ date: '2026-11-08', engagement: 's', nom: 'S', statut: 'a_faire' }, '2026-11-06')).toBe('a_venir');
  });
});
