import { describe, expect, it } from 'vitest';
import { cadencesDeSynchro, validerConfig } from '../src/config';
import { EXEMPLE, remplacer } from './aides';

function erreurs(yaml: string): string[] {
  const r = validerConfig(yaml);
  if (r.ok) throw new Error('la config aurait dû être refusée');
  return r.erreurs;
}

describe('validerConfig — exemple', () => {
  it('accepte exemple.yaml et normalise les clés et les durées', () => {
    const r = validerConfig(EXEMPLE);
    if (!r.ok) throw new Error(r.erreurs.join('\n'));
    const c = r.config;
    expect(c.sommeil).toEqual({
      cibleMin: 480,
      minimumMin: 420,
      plancherNuitMin: 360,
      leverPlancher: '04:30',
      endormissementMin: 0,
      ecartLeverMaxMin: 120,
    });
    expect(c.engagements.sport).toEqual({ heure: '06:00', preparationMin: 30, obligatoire: true, verification: { mesure: 'seance' } });
    expect(c.engagements.travail).toEqual({ reveil: '06:30', obligatoire: true });
    expect(c.apps.safari).toEqual({ nom: 'Safari', domaines: [], iphone: 'com.apple.mobilesafari' });
    expect(c.appareils.iphone).toEqual({ type: 'iphone', comptesDeTravail: [] });
    expect(c.modes.EVENING_FREE).toEqual({
      quand: {
        tous: [{ heure: { apres: '$ouverture', decalePar: 'prix_du_report' } }, 'prioritaires_faites', 'recap_fait'],
      },
      effets: {},
      sessions: 'autorisees',
      parametres: { ouverture: '$coucher - 2h' },
    });
    expect(c.modes.NIGHT_LOCK!.effets).toEqual({ bloque: 'tout', sauf: ['claude_code'], verrouillerSession: true });
    expect(c.routines.conges!.engagements).toEqual({ sport: { sansHeure: true, obligatoire: false } });
    expect(c.routines.conges!.reveilLibre).toBe('08:00');
    expect(c.routines.semaine!.jours.dim).toEqual({
      parametres: { EVENING_FREE: { ouverture: '14:00' } },
      conditionsEnPlus: { EVENING_FREE: ['aucun_retard'] },
    });
    expect(c.prixDuReport).toEqual({ parReportMin: 20, plafondMin: 90, commentaireMin: 15, deadline: { reportsMax: 3, joursMinimum: 2 } });
    expect(c.sessions).toEqual({
      plafondQuotidienMin: 180,
      attentesS: [0, 3, 5, 10, 15, 20],
      delaiNouvelleTacheMin: 15,
      expirationQuestionS: 60,
      intervalleQuestionMin: { pc: 25, iphone: 10 },
    });
  });

  it('applique les défauts (todoist, sessions)', () => {
    let yaml = remplacer(EXEMPLE, '  recap_tolerance_jours: 1\n  prioritaires: [p1, p2]\n  etiquettes_exclues: [planning, recap]\n', '');
    yaml = remplacer(yaml, yaml.slice(yaml.indexOf('sessions:\n  plafond_quotidien')), '');
    const r = validerConfig(yaml);
    if (!r.ok) throw new Error(r.erreurs.join('\n'));
    expect(r.config.todoist).toEqual({
      etiquettePlanning: 'planning',
      etiquetteRecap: 'recap',
      recapToleranceJours: 1,
      prioritaires: ['p1', 'p2'],
      etiquettesExclues: [],
    });
    expect(r.config.sessions.attentesS).toEqual([0, 3, 5, 10, 15, 20]);
    expect(r.config.sessions.intervalleQuestionMin).toEqual({ pc: 25, iphone: 10 });
  });

  it('lit les durées "1h30" et les préparations en nombre ou en durée', () => {
    let yaml = remplacer(EXEMPLE, 'cible: "8h"', 'cible: "7h45"');
    yaml = remplacer(yaml, 'preparation: 30,', 'preparation: "1h05",');
    yaml = remplacer(yaml, 'plafond: "90min"', 'plafond: "1h30"');
    const r = validerConfig(yaml);
    if (!r.ok) throw new Error(r.erreurs.join('\n'));
    expect(r.config.sommeil.cibleMin).toBe(465);
    expect(r.config.engagements.sport!.preparationMin).toBe(65);
    expect(r.config.prixDuReport.plafondMin).toBe(90);
  });
});

describe('validerConfig — références inconnues', () => {
  it('groupe ou app inconnu dans bloque', () => {
    const yaml = remplacer(EXEMPLE, 'bloque: [ia_conversationnelle, divertissement, navigateurs]', 'bloque: [ia_conversationnelle, divertisement, navigateurs]');
    expect(erreurs(yaml)).toEqual([
      'modes.WORK.effets.bloque[1] : groupe ou app inconnu « divertisement » (vouliez-vous dire « divertissement » ?)',
    ]);
  });

  it('app inconnue dans sauf', () => {
    const yaml = remplacer(EXEMPLE, 'sauf: [claude_code]', 'sauf: [claude_cod]');
    expect(erreurs(yaml)).toEqual([
      'modes.NIGHT_LOCK.effets.sauf[0] : groupe ou app inconnu « claude_cod » (vouliez-vous dire « claude_code » ?)',
    ]);
  });

  it('app inconnue dans un groupe, et groupe dans un groupe', () => {
    expect(erreurs(remplacer(EXEMPLE, 'matin: [gmail, whatsapp,', 'matin: [gmail, whatsap,'))).toEqual([
      'groupes.matin[1] : app inconnue « whatsap » (vouliez-vous dire « whatsapp » ?)',
    ]);
    expect(erreurs(remplacer(EXEMPLE, 'navigateurs: [safari]', 'navigateurs: [safari, divertissement]'))).toEqual([
      'groupes.navigateurs[1] : « divertissement » est un groupe ; un groupe ne contient que des apps',
    ]);
  });

  it('« tout » dans une liste', () => {
    const yaml = remplacer(EXEMPLE, 'bloque: tout, fermer', 'bloque: [tout], fermer');
    expect(erreurs(yaml)).toEqual(['modes.MORNING_LOCK.effets.bloque[0] : tout s\'écrit seul (bloque: tout), pas dans une liste']);
  });

  it('mode inconnu dans une routine', () => {
    const yaml = remplacer(EXEMPLE, 'reveil_libre: "08:00"\n    modes: [NIGHT_LOCK, MORNING_LOCK, EVENING_FREE, WORK]', 'reveil_libre: "08:00"\n    modes: [NIGHT_LOCK, MORNING_LOCK, EVENING_FREE, WROK]');
    expect(erreurs(yaml)).toEqual(['routines.conges.modes[3] : mode inconnu « WROK » (vouliez-vous dire « WORK » ?)']);
  });

  it('mode inconnu dans retirer, conditions_en_plus et parametres d\'un jour', () => {
    expect(erreurs(remplacer(EXEMPLE, 'mar: { engagements: [travail] }', 'mar: { engagements: [travail], retirer: [MORNING_LCK] }'))).toEqual([
      'routines.semaine.jours.mar.retirer[0] : mode absent de la routine semaine « MORNING_LCK » (vouliez-vous dire « MORNING_LOCK » ?)',
    ]);
    expect(erreurs(remplacer(EXEMPLE, 'conditions_en_plus: { EVENING_FREE:', 'conditions_en_plus: { EVENING_FRE:'))).toEqual([
      'routines.semaine.jours.dim.conditions_en_plus.EVENING_FRE : mode absent de la routine semaine « EVENING_FRE » (vouliez-vous dire « EVENING_FREE » ?)',
    ]);
    const parametres = erreurs(remplacer(EXEMPLE, 'sam: { parametres: { EVENING_FREE:', 'sam: { parametres: { EVENNG_FREE:'));
    expect(parametres).toEqual([
      'routines.semaine.jours.sam.parametres.EVENNG_FREE : mode absent de la routine « EVENNG_FREE » (vouliez-vous dire « EVENING_FREE » ?)',
    ]);
  });

  it('paramètre inconnu pour un mode', () => {
    const yaml = remplacer(EXEMPLE, 'ven: { engagements: [sport, travail], parametres: { EVENING_FREE: { ouverture: "18:00" } } }', 'ven: { engagements: [sport, travail], parametres: { EVENING_FREE: { ouvertre: "18:00" } } }');
    expect(erreurs(yaml)).toEqual([
      'routines.semaine.jours.ven.parametres.EVENING_FREE.ouvertre : paramètre inconnu pour le mode EVENING_FREE « ouvertre » (vouliez-vous dire « ouverture » ?)',
    ]);
  });

  it('paramètre cité mais sans valeur', () => {
    const yaml = remplacer(EXEMPLE, '    parametres: { ouverture: "$coucher - 2h" }\n', '');
    const e = erreurs(yaml);
    expect(e).toContain(
      'routines.semaine : le paramètre $ouverture du mode EVENING_FREE n\'a pas de valeur (ni dans modes.EVENING_FREE.parametres, ni dans routines.semaine.parametres.EVENING_FREE) pour : lun, mar, mer, jeu',
    );
    expect(e).toHaveLength(1);
  });

  it('engagement inconnu dans un jour et dans une surcharge de routine', () => {
    expect(erreurs(remplacer(EXEMPLE, 'mar: { engagements: [travail] }', 'mar: { engagements: [travial] }'))).toEqual([
      'routines.semaine.jours.mar.engagements[0] : engagement inconnu « travial » (vouliez-vous dire « travail » ?)',
    ]);
    expect(erreurs(remplacer(EXEMPLE, 'engagements: { sport: { heure: libre, obligatoire: false } }', 'engagements: { sprot: { heure: libre } }'))).toEqual([
      'routines.conges.engagements.sprot : engagement inconnu « sprot » (vouliez-vous dire « sport » ?)',
    ]);
  });

  it('type de mesure inconnu dans une vérification', () => {
    expect(erreurs(remplacer(EXEMPLE, 'verification: { mesure: seance }', 'verification: { mesure: seances }'))).toEqual([
      'engagements.sport.verification.mesure : type de mesure inconnu « seances » (vouliez-vous dire « seance » ?)',
    ]);
    expect(erreurs(remplacer(EXEMPLE, 'verification: { mesure: seance }', 'verification: { type: seance }'))).not.toHaveLength(0);
  });

  it('routine inconnue dans le calendrier et par défaut', () => {
    expect(erreurs(remplacer(EXEMPLE, '{ routine: conges, du:', '{ routine: conge, du:'))).toEqual([
      'calendrier[0].routine : routine inconnue « conge » (vouliez-vous dire « conges » ?)',
    ]);
    expect(erreurs(remplacer(EXEMPLE, 'routine_par_defaut: semaine', 'routine_par_defaut: semaines'))).toEqual([
      'routine_par_defaut : routine inconnue « semaines » (vouliez-vous dire « semaine » ?)',
    ]);
  });

  it('appareil inconnu dans les appareils d\'un mode', () => {
    expect(erreurs(remplacer(EXEMPLE, 'appareils: [pc_linux, pc_windows]', 'appareils: [pc_linx, pc_windows]'))).toEqual([
      'modes.MORNING_LOCK.appareils[0] : appareil inconnu « pc_linx » (vouliez-vous dire « pc_linux » ?)',
    ]);
  });

  it('condition inconnue', () => {
    expect(erreurs(remplacer(EXEMPLE, '[aucun_retard]', '[aucun_retards]'))).toEqual([
      'routines.semaine.jours.dim.conditions_en_plus.EVENING_FREE[0] : condition inconnue « aucun_retards » (vouliez-vous dire « aucun_retard » ?) ; attendu : toujours, planning_fait, recap_fait, prioritaires_faites, aucun_retard, heure, nombre_de_taches, tous, un_parmi, pas',
    ]);
    expect(erreurs(remplacer(EXEMPLE, 'quand: { pas: planning_fait }', 'quand: { pas: planing_fait }'))[0]).toMatch(
      /^modes\.MORNING_LOCK\.quand\.pas : condition inconnue « planing_fait » \(vouliez-vous dire « planning_fait » \?\)/,
    );
  });

  it('aucun mode pour un appareil après retirer', () => {
    const yaml = remplacer(EXEMPLE, 'mar: { engagements: [travail] }', 'mar: { engagements: [travail], retirer: [NIGHT_LOCK, EVENING_FREE, WORK] }');
    expect(erreurs(yaml)).toEqual(['routines.semaine.jours.mar : aucun mode ne s\'applique à l\'appareil iphone ce jour-là']);
  });
});

describe('validerConfig — formes et valeurs', () => {
  it('clé inconnue (faute de frappe) et champ manquant', () => {
    const e = erreurs(remplacer(EXEMPLE, 'reveil_libre: "07:00"', 'reveil_lbre: "07:00"'));
    expect(e).toContain('reveil_libre : champ obligatoire manquant');
    expect(e).toContain('(racine) : clé inconnue « reveil_lbre » (vouliez-vous dire « reveil_libre » ?)');
  });

  it('heures mal formées', () => {
    expect(erreurs(remplacer(EXEMPLE, 'lever_plancher: "04:30"', 'lever_plancher: "4:30"'))).toEqual([
      'sommeil.lever_plancher : heure invalide : attendu "HH:MM" (24 h, entre guillemets)',
    ]);
    expect(erreurs(remplacer(EXEMPLE, 'reveil: "06:30"', 'reveil: "24:30"'))).toEqual([
      'engagements.travail.reveil : heure invalide : attendu "HH:MM" (24 h, entre guillemets)',
    ]);
    expect(erreurs(remplacer(EXEMPLE, 'ouverture: "18:00"', 'ouverture: "18h"'))[0]).toMatch(
      /^routines\.semaine\.jours\.ven\.parametres\.EVENING_FREE\.ouverture : expression d'heure invalide/,
    );
    expect(erreurs(remplacer(EXEMPLE, '"$coucher - 2h"', '"$coucher - 2 heures"'))[0]).toMatch(
      /^modes\.EVENING_FREE\.parametres\.ouverture : expression d'heure invalide/,
    );
  });

  it('durée mal formée', () => {
    expect(erreurs(remplacer(EXEMPLE, 'cible: "8h"', 'cible: "8 heures"'))).toEqual([
      'sommeil.cible : durée invalide « 8 heures » : attendu "8h", "30min" ou "1h30"',
    ]);
  });

  it('plage de calendrier inversée', () => {
    const yaml = remplacer(EXEMPLE, 'du: "2026-12-19", au: "2027-01-03"', 'du: "2027-01-03", au: "2026-12-19"');
    expect(erreurs(yaml)).toEqual(['calendrier[0] : plage inversée : du 2027-01-03 est après au 2026-12-19']);
  });

  it('plages de calendrier qui se chevauchent', () => {
    const yaml = remplacer(
      EXEMPLE,
      '  - { routine: conges, du: "2026-12-19", au: "2027-01-03" }',
      '  - { routine: conges, du: "2026-12-19", au: "2027-01-03" }\n  - { routine: conges, du: "2027-01-03", au: "2027-01-10" }',
    );
    expect(erreurs(yaml)).toEqual(['calendrier[1] : chevauche la plage calendrier[0] (2026-12-19 → 2027-01-03)']);
  });

  it('date impossible et fuseau inconnu', () => {
    expect(erreurs(remplacer(EXEMPLE, 'du: "2026-12-19"', 'du: "2026-02-30"'))).toEqual([
      'calendrier[0].du : date invalide : attendu "AAAA-MM-JJ"',
    ]);
    const e = erreurs(remplacer(EXEMPLE, 'reveil_libre: "08:00"\n    modes', 'reveil_libre: "08:00"\n    fuseau_bis: x\n    modes'));
    expect(e).toEqual(['routines.conges : clé inconnue « fuseau_bis »']);
    const yaml = remplacer(EXEMPLE, '  conges:\n    fuseau: Europe/Paris', '  conges:\n    fuseau: Europe/Pariss');
    expect(erreurs(yaml)).toEqual(['routines.conges.fuseau : fuseau inconnu : attendu un nom IANA (ex. Europe/Paris, America/Cayenne)']);
  });

  it('domaine avec schéma, app sans cible', () => {
    expect(erreurs(remplacer(EXEMPLE, 'domaines: [claude.ai]', 'domaines: [https://claude.ai]'))).toEqual([
      'apps.claude_ai.domaines[0] : domaine invalide : attendu un nom d\'hôte en minuscules, sans http:// ni /',
    ]);
    expect(erreurs(remplacer(EXEMPLE, 'safari:    { nom: Safari,   iphone: com.apple.mobilesafari }', 'safari:    { nom: Safari }'))).toEqual([
      'apps.safari : une app doit avoir des domaines et/ou un identifiant iphone',
    ]);
  });

  it('annulable et decalable n\'existent plus : refus qui dit de les retirer', () => {
    expect(erreurs(remplacer(EXEMPLE, 'travail: { reveil: "06:30" }', 'travail: { reveil: "06:30", annulable: true, decalable: false }'))).toEqual([
      "engagements.travail : « annulable » n'existe plus : retirez-la (tout engagement peut être retiré ; obligatoire: false le rend libre) ; " +
        "« decalable » n'existe plus : retirez-la (tout engagement peut être décalé ; obligatoire: false le rend libre)",
    ]);
  });

  it('obligatoire : défaut vrai, surchargeable par la routine', () => {
    const r = validerConfig(remplacer(EXEMPLE, 'travail: { reveil: "06:30" }', 'travail: { reveil: "06:30", obligatoire: false }'));
    if (!r.ok) throw new Error(r.erreurs.join('\n'));
    expect(r.config.engagements.travail).toEqual({ reveil: '06:30', obligatoire: false });
    expect(erreurs(remplacer(EXEMPLE, 'obligatoire: false } }', 'obligatoire: non } }'))).toHaveLength(1);
  });

  it('heure: libre ne se combine pas (sauf avec obligatoire)', () => {
    expect(erreurs(remplacer(EXEMPLE, '{ sport: { heure: libre, obligatoire: false } }', '{ sport: { heure: libre, preparation: 10 } }'))).toEqual([
      'routines.conges.engagements.sport.heure : heure: libre s\'écrit seule (reçu aussi : preparation)',
    ]);
  });

  it('cohérence du sommeil', () => {
    expect(erreurs(remplacer(EXEMPLE, 'minimum: "7h"', 'minimum: "9h"'))).toEqual(['sommeil.minimum : le minimum dépasse la cible']);
  });

  it('YAML invalide : clé en double, syntaxe', () => {
    expect(erreurs(remplacer(EXEMPLE, 'utilisateur: alice', 'utilisateur: alice\nutilisateur: bob'))).toEqual([
      'YAML invalide (ligne 7, colonne 1) : clé en double',
    ]);
    expect(erreurs('a: [1, 2')[0]).toMatch(/^YAML invalide \(ligne \d+, colonne \d+\) : /);
    expect(erreurs('')).toEqual(['(racine) : la configuration est vide']);
  });

  it('mauvais types', () => {
    expect(erreurs(remplacer(EXEMPLE, 'version: 1', 'version: 2'))).toEqual(['version : valeur 2 invalide ; attendu : 1']);
    expect(erreurs(remplacer(EXEMPLE, 'commentaire_min: 15', 'commentaire_min: quinze'))).toEqual([
      'prix_du_report.commentaire_min : nombre attendu, reçu le texte « quinze »',
    ]);
    expect(erreurs(remplacer(EXEMPLE, 'sessions: interdites\n  MORNING_LOCK', 'sessions: interdite\n  MORNING_LOCK'))).toEqual([
      'modes.NIGHT_LOCK.sessions : valeur « interdite » invalide ; attendu : autorisees, interdites',
    ]);
  });
});

describe('validerConfig — cadences de synchro (01/11)', () => {
  it('défauts : Todoist 2 min, Xiaomi 15 min, Hevy 1 h ; une config ancienne sans bloc les reçoit aussi', () => {
    const r = validerConfig(EXEMPLE);
    if (!r.ok) throw new Error(r.erreurs.join('\n'));
    expect(cadencesDeSynchro(r.config)).toEqual({ todoist: 2, xiaomi: 15, hevy: 60, googleAgenda: 15 });
    const { synchro: _, ...ancienne } = r.config;
    expect(cadencesDeSynchro(ancienne)).toEqual({ todoist: 2, xiaomi: 15, hevy: 60, googleAgenda: 15 });
    // Config normalisée du 01/11 : le bloc existe, sans Google Agenda.
    expect(cadencesDeSynchro({ ...r.config, synchro: { todoistMin: 3, xiaomiMin: 20, hevyMin: 60 } })).toEqual({
      todoist: 3, xiaomi: 20, hevy: 60, googleAgenda: 15,
    });
  });

  it('réglables ; Xiaomi jamais sous 10 min', () => {
    const r = validerConfig(`${EXEMPLE}\nsynchro: { todoist: "5min", xiaomi: "30min", hevy: "2h" }\n`);
    if (!r.ok) throw new Error(r.erreurs.join('\n'));
    expect(r.config.synchro).toEqual({ todoistMin: 5, xiaomiMin: 30, hevyMin: 120, googleAgendaMin: 15 });
    expect(erreurs(`${EXEMPLE}\nsynchro: { xiaomi: "5min" }\n`)).toEqual(['synchro.xiaomi : entre 10 min et 24h']);
  });

  it('Google Agenda (02/11) : 15 min par défaut, réglable, jamais sous 5 min', () => {
    const r = validerConfig(`${EXEMPLE}\nsynchro: { google_agenda: "5min" }\n`);
    if (!r.ok) throw new Error(r.erreurs.join('\n'));
    expect(cadencesDeSynchro(r.config).googleAgenda).toBe(5);
    expect(erreurs(`${EXEMPLE}\nsynchro: { google_agenda: "4min" }\n`)).toEqual(['synchro.google_agenda : entre 5 min et 24h']);
  });
});
