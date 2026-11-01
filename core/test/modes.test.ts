import { describe, expect, it } from 'vitest';
import { lireConfig } from '../src/config';
import { etat } from '../src/etat';
import { attenteContinue, moteur } from '../src/index';
import { configExemple, contexte, EXEMPLE, faits, remplacer, tache } from './aides';

// Lundi 02/11/2026 (UTC+1) : lever 05:30 (04:30Z), ouverture 20:30 (19:30Z), coucher 22:30 (21:30Z).
const planningAFaire = tache({ etiquettes: ['planning'], echeance: '2026-11-02', priorite: 'p4' });
const planningFait = { ...planningAFaire, terminee: true, termineeLe: '2026-11-02T06:00:00Z' };

const DOMAINES_WORK = [
  'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'm.youtube.com', 'twitter.com',
  'www.x.com', 'www.youtube.com', 'x.com', 'youtu.be', 'youtube.com',
];
const DOMAINES_NUIT = [
  'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'gmail.com', 'm.youtube.com',
  'mail.google.com', 'twitter.com', 'web.whatsapp.com', 'whatsapp.com', 'www.x.com', 'www.youtube.com',
  'x.com', 'youtu.be', 'youtube.com',
];

describe('choix du mode', () => {
  it('matin, planning à faire : MORNING_LOCK sur les PC, absent pour l\'iPhone', () => {
    const ctx = contexte('2026-11-02T09:00:00Z', { faits: faits({ taches: [planningAFaire] }) });
    const pc = etat(ctx, 'pc_linux');
    expect(pc.mode).toBe('MORNING_LOCK');
    expect(pc.sessions).toBe('interdites');
    expect(pc.actions).toEqual({
      bloquer_domaines: ['api.anthropic.com', 'console.anthropic.com', ...DOMAINES_NUIT].sort(),
      verrouiller_session: false,
      fermer_comptes_hors_travail: true,
    });
    expect(etat(ctx, 'pc_windows').mode).toBe('MORNING_LOCK');
    const iphone = etat(ctx, 'iphone');
    expect(iphone.mode).toBe('WORK');
    expect(iphone.actions).toEqual({
      bloquer_apps: [
        'com.anthropic.claude', 'com.apple.mobilesafari', 'com.atebits.Tweetie2',
        'com.google.gemini', 'com.google.ios.youtube', 'com.openai.chat',
      ],
    });
  });

  it('planning fait : WORK, domaines dédoublonnés et triés', () => {
    const ctx = contexte('2026-11-02T09:00:00Z', { faits: faits({ taches: [planningFait] }) });
    const pc = etat(ctx, 'pc_linux');
    expect(pc.mode).toBe('WORK');
    expect(pc.sessions).toBe('autorisees');
    expect(pc.actions).toEqual({ bloquer_domaines: DOMAINES_WORK, verrouiller_session: false, fermer_comptes_hors_travail: true });
  });

  it('après l\'ouverture, tout est fait : EVENING_FREE ne bloque rien', () => {
    const e = etat(contexte('2026-11-02T20:00:00Z'), 'pc_linux');
    expect(e.mode).toBe('EVENING_FREE');
    expect(e.actions).toEqual({ bloquer_domaines: [], verrouiller_session: false, fermer_comptes_hors_travail: false });
    expect(etat(contexte('2026-11-02T20:00:00Z'), 'iphone').actions).toEqual({ bloquer_apps: [] });
  });

  it('avant l\'ouverture : WORK même si tout est fait', () => {
    expect(etat(contexte('2026-11-02T19:29:00Z'), 'pc_linux').mode).toBe('WORK');
    expect(etat(contexte('2026-11-02T19:30:00Z'), 'pc_linux').mode).toBe('EVENING_FREE');
  });

  it('après l\'ouverture, une prioritaire reste : WORK, avec la raison', () => {
    const ctx = contexte('2026-11-02T20:00:00Z', { faits: faits({ taches: [tache({ echeance: '2026-11-02', priorite: 'p2' })] }) });
    const e = etat(ctx, 'pc_linux');
    expect(e.mode).toBe('WORK');
    expect(e.raison).toBe('WORK — EVENING_FREE non atteint : tâches prioritaires restantes (du jour et en retard) : 1');
  });

  it('après le coucher : NIGHT_LOCK, claude_code jamais bloqué, session verrouillée', () => {
    const e = etat(contexte('2026-11-02T22:00:00Z'), 'pc_linux');
    expect(e.mode).toBe('NIGHT_LOCK');
    expect(e.sessions).toBe('interdites');
    expect(e.actions).toEqual({ bloquer_domaines: DOMAINES_NUIT, verrouiller_session: true, fermer_comptes_hors_travail: false });
    expect((e.actions as { bloquer_domaines: string[] }).bloquer_domaines).not.toContain('api.anthropic.com');
    expect(etat(contexte('2026-11-02T22:00:00Z'), 'iphone').actions).toEqual({
      bloquer_apps: [
        'com.anthropic.claude', 'com.apple.mobilesafari', 'com.atebits.Tweetie2', 'com.google.Gmail',
        'com.google.gemini', 'com.google.ios.youtube', 'com.openai.chat', 'net.whatsapp.WhatsApp',
      ],
    });
  });

  it('l\'ordre compte : la nuit, NIGHT_LOCK passe avant MORNING_LOCK', () => {
    const planningDuMardi = tache({ etiquettes: ['planning'], echeance: '2026-11-03' });
    const ctx = contexte('2026-11-03T03:00:00Z', { faits: faits({ taches: [planningDuMardi] }) }); // mardi 04:00
    expect(etat(ctx, 'pc_linux').mode).toBe('NIGHT_LOCK');
    expect(etat({ ...ctx, maintenant: '2026-11-03T05:30:00Z' }, 'pc_linux').mode).toBe('MORNING_LOCK');
  });

  it('dimanche : conditions_en_plus aucun_retard', () => {
    const retard = tache({ echeance: '2026-11-06', priorite: 'p4' });
    const photosRetards = { '2026-11-08': [retard.id], '2026-11-07': [retard.id] };
    const enRetard = faits({ taches: [retard], photosRetards });
    expect(etat(contexte('2026-11-08T14:00:00Z', { faits: enRetard }), 'pc_linux').mode).toBe('WORK');
    const solde = faits({ taches: [{ ...retard, terminee: true }], photosRetards });
    expect(etat(contexte('2026-11-08T14:00:00Z', { faits: solde }), 'pc_linux').mode).toBe('EVENING_FREE');
    // Le samedi n'a pas cette condition.
    expect(etat(contexte('2026-11-07T14:00:00Z', { faits: enRetard }), 'pc_linux').mode).toBe('EVENING_FREE');
  });

  it('retirer : le mode disparaît ce jour-là', () => {
    const config = lireConfig(remplacer(EXEMPLE, 'sam: { parametres:', 'sam: { retirer: [MORNING_LOCK], parametres:'));
    const planningDuSamedi = tache({ etiquettes: ['planning'], echeance: '2026-11-07' });
    const ctx = { ...contexte('2026-11-07T09:00:00Z', { faits: faits({ taches: [planningDuSamedi] }) }), config };
    expect(etat(ctx, 'pc_linux').mode).toBe('WORK');
    expect(etat({ ...ctx, config: configExemple }, 'pc_linux').mode).toBe('MORNING_LOCK');
  });

  it('appareil inconnu : erreur', () => {
    expect(() => etat(contexte('2026-11-02T09:00:00Z'), 'ipad')).toThrow('appareil inconnu « ipad »');
  });
});

describe('attente progressive', () => {
  it('0, 3, 5, 10, 15, 20 puis 20', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 50].map((n) => attenteContinue(configExemple, n))).toEqual([0, 3, 5, 10, 15, 20, 20, 20, 20]);
    expect(moteur.attenteContinue(configExemple, 6)).toBe(20);
  });
});
