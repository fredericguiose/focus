// Lecture et validation de la configuration (docs/conception.md §2).
// Trois étapes : YAML 1.2 → forme (zod, clés inconnues refusées) → cohérence des références.
// Toute erreur est rapportée avec son chemin dans le YAML ; une config fausse est refusée en entier.

import { parseDocument } from 'yaml';
import { z } from 'zod';
import type {
  App,
  Condition,
  Config,
  Engagement,
  FiltreTaches,
  JourRoutine,
  JourSemaine,
  Mode,
  Priorite,
  ResultatValidation,
  Routine,
  TypeMesure,
} from './types';
import { TYPES_DE_MESURE } from './types';
import { estDate, estFuseau, estHeure, JOURS_SEMAINE, minutesDe } from './temps';
import { lireExpression, minutesDuree, parametresCites, VARIABLES_RESERVEES, variableDe } from './expressions';

type Chemin = (string | number)[];
type Signaler = (chemin: Chemin, message: string) => void;

const RE_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const RE_DOMAINE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
const RE_BUNDLE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const CONDITIONS_SIMPLES = ['toujours', 'planning_fait', 'recap_fait', 'prioritaires_faites', 'aucun_retard'] as const;
const CONDITIONS_COMPOSEES = ['heure', 'nombre_de_taches', 'tous', 'un_parmi', 'pas'];

// ─── Champs élémentaires ──────────────────────────────────────────────────────

const texte = z.string().min(1);
const heure = z.string().refine(estHeure, { error: 'heure invalide : attendu "HH:MM" (24 h, entre guillemets)' });
const date = z.string().refine(estDate, { error: 'date invalide : attendu "AAAA-MM-JJ"' });
const entierPositif = z.number().int().min(0);
const priorite = z.enum(['p1', 'p2', 'p3', 'p4']);

const duree = z.string().transform((v, ctx) => {
  const min = minutesDuree(v);
  if (min === null) ctx.addIssue({ code: 'custom', message: `durée invalide « ${v} » : attendu "8h", "30min" ou "1h30"` });
  return min ?? 0;
});

/** Durée, ou nombre seul = minutes (pour `preparation`). */
const dureeOuMinutes = z.union([entierPositif, duree], {
  error: 'durée invalide : attendu un nombre de minutes, "30min", "1h" ou "1h30"',
});

const expression = z.string().refine((v) => lireExpression(v) !== null, {
  error: 'expression d\'heure invalide : attendu "HH:MM", "$lever", "$coucher" ou "$nom ± durée" (ex. "$coucher - 2h")',
});

const listeIds = z.array(texte);
const parametres = z.record(z.string(), expression);
const parametresParMode = z.record(z.string(), parametres);

// ─── Conditions (vocabulaire fermé, §2.6) ─────────────────────────────────────

const schemaHeure = z.strictObject({
  apres: expression.optional(),
  avant: expression.optional(),
  decale_par: z.literal('prix_du_report').optional(),
});

const schemaNombreDeTaches = z.strictObject({
  filtre: z.strictObject({
    jour: z.enum(['aujourd_hui', 'retard', 'les_deux']),
    priorites: z.array(priorite).min(1).optional(),
    etiquettes_incluses: z.array(texte).min(1).optional(),
    etiquettes_exclues: z.array(texte).min(1).optional(),
  }),
  au_plus: entierPositif,
});

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sousSchema<S extends z.ZodType>(schema: S, v: unknown, chemin: Chemin, signaler: Signaler): z.output<S> | undefined {
  const r = schema.safeParse(v, { reportInput: true });
  if (r.success) return r.data;
  for (const issue of r.error.issues) signaler([...chemin, ...(issue.path as Chemin)], messageIssue(issue));
  return undefined;
}

function lireCondition(v: unknown, chemin: Chemin, signaler: Signaler): Condition | undefined {
  if (typeof v === 'string') {
    if ((CONDITIONS_SIMPLES as readonly string[]).includes(v)) return v as Condition;
    signaler(chemin, `condition inconnue « ${v} »${suggestion(v, [...CONDITIONS_SIMPLES, ...CONDITIONS_COMPOSEES])} ; ` +
      `attendu : ${[...CONDITIONS_SIMPLES, ...CONDITIONS_COMPOSEES].join(', ')}`);
    return undefined;
  }
  if (!estObjet(v)) {
    signaler(chemin, `condition attendue (texte ou objet), reçu ${typeDe(v)}`);
    return undefined;
  }
  const cles = Object.keys(v);
  if (cles.length !== 1) {
    signaler(chemin, `une condition s'écrit avec une seule clé parmi ${CONDITIONS_COMPOSEES.join(', ')} ; reçu : ${cles.join(', ') || 'aucune'}`);
    return undefined;
  }
  const cle = cles[0]!;
  const valeur = v[cle];
  const ici = [...chemin, cle];
  switch (cle) {
    case 'heure': {
      const h = sousSchema(schemaHeure, valeur, ici, signaler);
      if (!h) return undefined;
      if (h.apres === undefined && h.avant === undefined) {
        signaler(ici, 'il faut au moins une borne : apres ou avant');
        return undefined;
      }
      if (h.decale_par !== undefined && h.apres === undefined) {
        signaler([...ici, 'decale_par'], 'decale_par décale la borne apres, qui est absente');
        return undefined;
      }
      return {
        heure: {
          ...(h.apres !== undefined && { apres: h.apres }),
          ...(h.avant !== undefined && { avant: h.avant }),
          ...(h.decale_par !== undefined && { decalePar: h.decale_par }),
        },
      };
    }
    case 'nombre_de_taches': {
      const n = sousSchema(schemaNombreDeTaches, valeur, ici, signaler);
      if (!n) return undefined;
      const filtre: FiltreTaches = {
        jour: n.filtre.jour,
        ...(n.filtre.priorites && { priorites: n.filtre.priorites }),
        ...(n.filtre.etiquettes_incluses && { etiquettesIncluses: n.filtre.etiquettes_incluses }),
        ...(n.filtre.etiquettes_exclues && { etiquettesExclues: n.filtre.etiquettes_exclues }),
      };
      return { nombreDeTaches: { filtre, auPlus: n.au_plus } };
    }
    case 'tous':
    case 'un_parmi': {
      if (!Array.isArray(valeur) || valeur.length === 0) {
        signaler(ici, `liste non vide de conditions attendue, reçu ${typeDe(valeur)}`);
        return undefined;
      }
      const enfants = valeur.map((c, i) => lireCondition(c, [...ici, i], signaler));
      if (enfants.some((c) => c === undefined)) return undefined;
      return cle === 'tous' ? { tous: enfants as Condition[] } : { unParmi: enfants as Condition[] };
    }
    case 'pas': {
      const enfant = lireCondition(valeur, ici, signaler);
      return enfant === undefined ? undefined : { pas: enfant };
    }
    default:
      signaler(chemin, `condition inconnue « ${cle} »${suggestion(cle, CONDITIONS_COMPOSEES)} ; ` +
        `attendu une clé parmi ${CONDITIONS_COMPOSEES.join(', ')}`);
      return undefined;
  }
}

const condition = z.unknown().transform((v, ctx) => {
  const c = lireCondition(v, [], (path, message) => ctx.addIssue({ code: 'custom', message, path }));
  return c ?? ('toujours' as Condition);
});

// ─── Sections de la config ────────────────────────────────────────────────────

const schemaEngagement = z
  .strictObject({
    heure: heure.optional(),
    preparation: dureeOuMinutes.optional(),
    reveil: heure.optional(),
    annulable: z.boolean().default(false),
    decalable: z.boolean().default(false),
    verification: z.strictObject({ mesure: texte }).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.verification && !(TYPES_DE_MESURE as readonly string[]).includes(e.verification.mesure)) {
      ctx.addIssue({
        code: 'custom',
        path: ['verification', 'mesure'],
        message: inconnu('type de mesure inconnu', e.verification.mesure, [...TYPES_DE_MESURE]),
      });
    }
    if (e.preparation !== undefined && e.heure === undefined) {
      ctx.addIssue({ code: 'custom', path: ['preparation'], message: 'preparation sans heure : elle se retranche de heure' });
    }
    if (e.preparation !== undefined && e.reveil !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['preparation'], message: 'preparation sans effet quand reveil est donné' });
    }
  });

/** Surcharge d'un engagement par une routine ; `heure: libre` = engagement sans heure. */
const schemaSurcharge = z
  .strictObject({
    heure: z.union([z.literal('libre'), heure], { error: 'heure invalide : attendu "HH:MM" ou libre' }).optional(),
    preparation: dureeOuMinutes.optional(),
    reveil: heure.optional(),
    annulable: z.boolean().optional(),
    decalable: z.boolean().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.heure === 'libre') {
      const autres = Object.keys(e).filter((k) => k !== 'heure' && e[k as keyof typeof e] !== undefined);
      if (autres.length > 0) {
        ctx.addIssue({ code: 'custom', path: ['heure'], message: `heure: libre s'écrit seule (reçu aussi : ${autres.join(', ')})` });
      }
    }
    if (e.preparation !== undefined && e.reveil !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['preparation'], message: 'preparation sans effet quand reveil est donné' });
    }
  });

const schemaApp = z
  .strictObject({
    nom: texte,
    domaines: z
      .array(z.string().refine((d) => RE_DOMAINE.test(d), { error: 'domaine invalide : attendu un nom d\'hôte en minuscules, sans http:// ni /' }))
      .default([]),
    iphone: z.string().refine((b) => RE_BUNDLE.test(b), { error: 'identifiant iPhone invalide : attendu un identifiant de bundle (ex. com.google.ios.youtube)' }).optional(),
  })
  .refine((a) => a.domaines.length > 0 || a.iphone !== undefined, { error: 'une app doit avoir des domaines et/ou un identifiant iphone' });

const schemaAppareil = z.strictObject({
  type: z.enum(['pc_linux', 'pc_windows', 'iphone']),
  comptes_de_travail: z.array(texte).default([]),
});

const schemaEffets = z.strictObject({
  bloque: z.union([z.literal('tout'), listeIds], { error: 'bloque : attendu tout ou une liste de groupes ou d\'apps' }).optional(),
  sauf: listeIds.optional(),
  verrouiller_session: z.boolean().optional(),
  fermer_comptes_hors_travail: z.boolean().optional(),
});

const schemaMode = z.strictObject({
  quand: condition,
  effets: schemaEffets.prefault({}),
  appareils: listeIds.min(1).optional(),
  sessions: z.enum(['autorisees', 'interdites']).default('autorisees'),
  parametres: parametres.optional(),
});

const schemaJour = z.strictObject({
  engagements: listeIds.optional(),
  parametres: parametresParMode.optional(),
  conditions_en_plus: z.record(z.string(), z.array(condition).min(1)).optional(),
  retirer: listeIds.min(1).optional(),
});

const schemaRoutine = z.strictObject({
  fuseau: z.string().refine(estFuseau, { error: 'fuseau inconnu : attendu un nom IANA (ex. Europe/Paris, America/Cayenne)' }),
  modes: listeIds.min(1),
  reveil_libre: heure.optional(),
  engagements: z.record(z.string(), schemaSurcharge).optional(),
  parametres: parametresParMode.optional(),
  jours: z
    .strictObject({
      lun: schemaJour.optional(),
      mar: schemaJour.optional(),
      mer: schemaJour.optional(),
      jeu: schemaJour.optional(),
      ven: schemaJour.optional(),
      sam: schemaJour.optional(),
      dim: schemaJour.optional(),
    })
    .prefault({}),
});

const schemaConfig = z.strictObject({
  version: z.literal(1),
  utilisateur: texte,
  sommeil: z.strictObject({
    cible: duree,
    minimum: duree,
    plancher_nuit: duree,
    lever_plancher: heure,
  }),
  reveil_libre: heure,
  engagements: z.record(z.string(), schemaEngagement).default({}),
  apps: z.record(z.string(), schemaApp),
  groupes: z.record(z.string(), listeIds.min(1)).default({}),
  appareils: z.record(z.string(), schemaAppareil),
  modes: z.record(z.string(), schemaMode),
  routines: z.record(z.string(), schemaRoutine),
  routine_par_defaut: texte,
  calendrier: z.array(z.strictObject({ routine: texte, du: date, au: date })).default([]),
  todoist: z.strictObject({
    etiquette_planning: texte,
    etiquette_recap: texte,
    recap_tolerance_jours: entierPositif.default(1),
    prioritaires: z.array(priorite).min(1).default(['p1', 'p2']),
    etiquettes_exclues: z.array(texte).default([]),
  }),
  prix_du_report: z.strictObject({
    par_report: duree,
    plafond: duree,
    commentaire_min: entierPositif,
    deadline: z.strictObject({ reports_max: entierPositif, jours_minimum: entierPositif }),
  }),
  sessions: z
    .strictObject({
      plafond_quotidien: duree.default(180),
      attentes_s: z.array(entierPositif).min(1).default([0, 3, 5, 10, 15, 20]),
      delai_nouvelle_tache: duree.default(15),
      expiration_question_s: entierPositif.default(60),
      intervalle_question: z
        .strictObject({ pc: duree.default(25), iphone: duree.default(10) })
        .prefault({}),
    })
    .prefault({}),
});

type ConfigBrute = z.output<typeof schemaConfig>;
type SurchargeBrute = z.output<typeof schemaSurcharge>;
type JourBrut = z.output<typeof schemaJour>;

// ─── Normalisation : snake_case du YAML → types du moteur ────────────────────

function sansIndefinis<T extends object>(objet: T): T {
  return Object.fromEntries(Object.entries(objet).filter(([, v]) => v !== undefined)) as T;
}

function normaliserSurcharge(s: SurchargeBrute): Partial<Engagement> | { sansHeure: true } {
  if (s.heure === 'libre') return { sansHeure: true };
  return sansIndefinis({
    heure: s.heure,
    preparationMin: s.preparation,
    reveil: s.reveil,
    annulable: s.annulable,
    decalable: s.decalable,
  });
}

function normaliserJour(j: JourBrut): JourRoutine {
  return sansIndefinis({
    engagements: j.engagements,
    parametres: j.parametres,
    conditionsEnPlus: j.conditions_en_plus,
    retirer: j.retirer,
  });
}

function surTout<T, U>(objet: Record<string, T>, f: (v: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(objet).map(([k, v]) => [k, f(v)]));
}

function normaliser(b: ConfigBrute): Config {
  return {
    version: 1,
    utilisateur: b.utilisateur,
    sommeil: {
      cibleMin: b.sommeil.cible,
      minimumMin: b.sommeil.minimum,
      plancherNuitMin: b.sommeil.plancher_nuit,
      leverPlancher: b.sommeil.lever_plancher,
    },
    reveilLibre: b.reveil_libre,
    engagements: surTout(b.engagements, (e): Engagement =>
      sansIndefinis({
        heure: e.heure,
        preparationMin: e.preparation,
        reveil: e.reveil,
        annulable: e.annulable,
        decalable: e.decalable,
        verification: e.verification && { mesure: e.verification.mesure as TypeMesure },
      }),
    ),
    apps: surTout(b.apps, (a): App => sansIndefinis({ nom: a.nom, domaines: a.domaines, iphone: a.iphone })),
    groupes: b.groupes,
    appareils: surTout(b.appareils, (a) => ({ type: a.type, comptesDeTravail: a.comptes_de_travail })),
    modes: surTout(b.modes, (m): Mode =>
      sansIndefinis({
        quand: m.quand,
        effets: sansIndefinis({
          bloque: m.effets.bloque,
          sauf: m.effets.sauf,
          verrouillerSession: m.effets.verrouiller_session,
          fermerComptesHorsTravail: m.effets.fermer_comptes_hors_travail,
        }),
        appareils: m.appareils,
        sessions: m.sessions,
        parametres: m.parametres,
      }),
    ),
    routines: surTout(b.routines, (r): Routine =>
      sansIndefinis({
        fuseau: r.fuseau,
        modes: r.modes,
        reveilLibre: r.reveil_libre,
        engagements: r.engagements && surTout(r.engagements, normaliserSurcharge),
        parametres: r.parametres,
        jours: Object.fromEntries(
          Object.entries(r.jours)
            .filter((e): e is [string, JourBrut] => e[1] !== undefined)
            .map(([j, jour]) => [j, normaliserJour(jour)]),
        ),
      }),
    ),
    routineParDefaut: b.routine_par_defaut,
    calendrier: b.calendrier,
    todoist: {
      etiquettePlanning: b.todoist.etiquette_planning,
      etiquetteRecap: b.todoist.etiquette_recap,
      recapToleranceJours: b.todoist.recap_tolerance_jours,
      prioritaires: b.todoist.prioritaires as Priorite[],
      etiquettesExclues: b.todoist.etiquettes_exclues,
    },
    prixDuReport: {
      parReportMin: b.prix_du_report.par_report,
      plafondMin: b.prix_du_report.plafond,
      commentaireMin: b.prix_du_report.commentaire_min,
      deadline: {
        reportsMax: b.prix_du_report.deadline.reports_max,
        joursMinimum: b.prix_du_report.deadline.jours_minimum,
      },
    },
    sessions: {
      plafondQuotidienMin: b.sessions.plafond_quotidien,
      attentesS: b.sessions.attentes_s,
      delaiNouvelleTacheMin: b.sessions.delai_nouvelle_tache,
      expirationQuestionS: b.sessions.expiration_question_s,
      intervalleQuestionMin: b.sessions.intervalle_question,
    },
  };
}

// ─── Cohérence : références, heures, calendrier ───────────────────────────────

function verifierCoherence(c: Config): string[] {
  const erreurs: string[] = [];
  const signaler: Signaler = (chemin, message) => erreurs.push(`${cheminTexte(chemin)} : ${message}`);

  verifierIdentifiants(c, signaler);
  verifierSommeil(c, signaler);
  verifierGroupes(c, signaler);
  for (const [nom, mode] of Object.entries(c.modes)) verifierMode(c, nom, mode, signaler);
  for (const [nom, routine] of Object.entries(c.routines)) verifierRoutine(c, nom, routine, signaler);
  if (!c.routines[c.routineParDefaut]) {
    signaler(['routine_par_defaut'], inconnu('routine inconnue', c.routineParDefaut, Object.keys(c.routines)));
  }
  verifierCalendrier(c, signaler);
  return erreurs;
}

function verifierIdentifiants(c: Config, signaler: Signaler): void {
  const sections: [string, Record<string, unknown>][] = [
    ['engagements', c.engagements],
    ['apps', c.apps],
    ['groupes', c.groupes],
    ['appareils', c.appareils],
    ['modes', c.modes],
    ['routines', c.routines],
  ];
  for (const [section, objet] of sections) {
    for (const id of Object.keys(objet)) {
      if (!RE_ID.test(id)) {
        signaler([section, id], 'identifiant invalide : lettres, chiffres, _ ou -, et commence par une lettre');
      }
    }
  }
  for (const id of Object.keys(c.apps)) {
    if (id === 'tout') signaler(['apps', id], '« tout » est réservé (toutes les apps du catalogue)');
    if (c.groupes[id]) signaler(['groupes', id], `nom déjà pris par une app : un groupe et une app ne peuvent pas porter le même nom`);
  }
  if (c.groupes.tout) signaler(['groupes', 'tout'], '« tout » est réservé (toutes les apps du catalogue)');
}

function verifierSommeil(c: Config, signaler: Signaler): void {
  const s = c.sommeil;
  if (s.cibleMin <= 0) signaler(['sommeil', 'cible'], 'la cible doit être positive');
  if (s.minimumMin > s.cibleMin) signaler(['sommeil', 'minimum'], 'le minimum dépasse la cible');
  if (s.plancherNuitMin > s.minimumMin) signaler(['sommeil', 'plancher_nuit'], 'le plancher de nuit dépasse le minimum');
  const plancher = minutesDe(s.leverPlancher);
  if (plancher > minutesDe(c.reveilLibre)) {
    signaler(['sommeil', 'lever_plancher'], `après reveil_libre (${c.reveilLibre})`);
  }
  for (const [nom, r] of Object.entries(c.routines)) {
    if (r.reveilLibre && plancher > minutesDe(r.reveilLibre)) {
      signaler(['routines', nom, 'reveil_libre'], `avant sommeil.lever_plancher (${s.leverPlancher})`);
    }
  }
}

function verifierGroupes(c: Config, signaler: Signaler): void {
  for (const [nom, membres] of Object.entries(c.groupes)) {
    membres.forEach((membre, i) => {
      if (c.apps[membre]) return;
      signaler(['groupes', nom, i], c.groupes[membre]
        ? `« ${membre} » est un groupe ; un groupe ne contient que des apps`
        : inconnu('app inconnue', membre, Object.keys(c.apps)));
    });
  }
}

function verifierCibles(c: Config, liste: string[], chemin: Chemin, signaler: Signaler): void {
  const connus = [...Object.keys(c.groupes), ...Object.keys(c.apps)];
  liste.forEach((id, i) => {
    if (id === 'tout') signaler([...chemin, i], 'tout s\'écrit seul (bloque: tout), pas dans une liste');
    else if (!c.groupes[id] && !c.apps[id]) signaler([...chemin, i], inconnu('groupe ou app inconnu', id, connus));
  });
}

function verifierMode(c: Config, nom: string, mode: Mode, signaler: Signaler): void {
  const ici = ['modes', nom];
  mode.appareils?.forEach((a, i) => {
    if (!c.appareils[a]) signaler([...ici, 'appareils', i], inconnu('appareil inconnu', a, Object.keys(c.appareils)));
  });
  if (Array.isArray(mode.effets.bloque)) verifierCibles(c, mode.effets.bloque, [...ici, 'effets', 'bloque'], signaler);
  if (mode.effets.sauf) verifierCibles(c, mode.effets.sauf, [...ici, 'effets', 'sauf'], signaler);
  for (const [p, valeur] of Object.entries(mode.parametres ?? {})) {
    verifierParametre(p, valeur, [...ici, 'parametres', p], signaler);
  }
}

/** Un paramètre ne peut citer que $lever et $coucher (pas d'autre paramètre : pas de cycle). */
function verifierParametre(nom: string, valeur: string, chemin: Chemin, signaler: Signaler): void {
  if ((VARIABLES_RESERVEES as readonly string[]).includes(nom)) {
    signaler(chemin, `« ${nom} » est réservé : un paramètre ne peut pas s'appeler lever ou coucher`);
  }
  const v = variableDe(valeur);
  if (v !== undefined && !(VARIABLES_RESERVEES as readonly string[]).includes(v)) {
    signaler(chemin, `la valeur d'un paramètre ne peut citer que $lever ou $coucher, pas $${v}`);
  }
}

function verifierRoutine(c: Config, nom: string, r: Routine, signaler: Signaler): void {
  const ici = ['routines', nom];
  const vus = new Set<string>();
  r.modes.forEach((m, i) => {
    if (!c.modes[m]) signaler([...ici, 'modes', i], inconnu('mode inconnu', m, Object.keys(c.modes)));
    else if (vus.has(m)) signaler([...ici, 'modes', i], `mode « ${m} » cité deux fois`);
    vus.add(m);
  });
  const modes = r.modes.filter((m) => c.modes[m]);

  for (const e of Object.keys(r.engagements ?? {})) {
    if (!c.engagements[e]) signaler([...ici, 'engagements', e], inconnu('engagement inconnu', e, Object.keys(c.engagements)));
  }
  verifierParametresParMode(c, r, r.parametres ?? {}, modes, [...ici, 'parametres'], signaler);

  for (const j of JOURS_SEMAINE) {
    const jour = r.jours[j];
    if (!jour) continue;
    const cheminJour = [...ici, 'jours', j];
    jour.engagements?.forEach((e, i) => {
      if (!c.engagements[e]) signaler([...cheminJour, 'engagements', i], inconnu('engagement inconnu', e, Object.keys(c.engagements)));
    });
    jour.retirer?.forEach((m, i) => {
      if (!modes.includes(m)) signaler([...cheminJour, 'retirer', i], inconnu(`mode absent de la routine ${nom}`, m, modes));
    });
    verifierParametresParMode(c, r, jour.parametres ?? {}, modes, [...cheminJour, 'parametres'], signaler);
    for (const [m, conditions] of Object.entries(jour.conditionsEnPlus ?? {})) {
      const cheminMode = [...cheminJour, 'conditions_en_plus', m];
      if (!modes.includes(m)) {
        signaler(cheminMode, inconnu(`mode absent de la routine ${nom}`, m, modes));
        continue;
      }
      const definis = parametresDefinis(c, r, m, j);
      for (const p of parametresCites(conditions)) {
        if (!definis.has(p)) signaler(cheminMode, `paramètre $${p} sans valeur pour le mode ${m} le ${j}`);
      }
    }
  }
  verifierParametresResolus(c, nom, r, modes, signaler);
  verifierModesParAppareil(c, nom, r, modes, signaler);
}

function parametresConnus(c: Config, r: Routine, mode: string): Set<string> {
  const conditionsEnPlus = JOURS_SEMAINE.flatMap((j) => r.jours[j]?.conditionsEnPlus?.[mode] ?? []);
  const m = c.modes[mode]!;
  return new Set([...Object.keys(m.parametres ?? {}), ...parametresCites([m.quand, ...conditionsEnPlus])]);
}

function parametresDefinis(c: Config, r: Routine, mode: string, j: JourSemaine): Set<string> {
  return new Set([
    ...Object.keys(c.modes[mode]?.parametres ?? {}),
    ...Object.keys(r.parametres?.[mode] ?? {}),
    ...Object.keys(r.jours[j]?.parametres?.[mode] ?? {}),
  ]);
}

function verifierParametresParMode(
  c: Config,
  r: Routine,
  parMode: Record<string, Record<string, string>>,
  modes: string[],
  chemin: Chemin,
  signaler: Signaler,
): void {
  for (const [m, valeurs] of Object.entries(parMode)) {
    if (!modes.includes(m)) {
      signaler([...chemin, m], inconnu('mode absent de la routine', m, modes));
      continue;
    }
    const connus = [...parametresConnus(c, r, m)];
    for (const [p, valeur] of Object.entries(valeurs)) {
      if (!connus.includes(p)) {
        signaler([...chemin, m, p], connus.length === 0
          ? `le mode ${m} n'a aucun paramètre`
          : inconnu(`paramètre inconnu pour le mode ${m}`, p, connus));
      }
      verifierParametre(p, valeur, [...chemin, m, p], signaler);
    }
  }
}

/** Chaque $paramètre cité par un mode doit avoir une valeur chaque jour où le mode est actif. */
function verifierParametresResolus(c: Config, nom: string, r: Routine, modes: string[], signaler: Signaler): void {
  for (const m of modes) {
    for (const p of parametresCites([c.modes[m]!.quand])) {
      const manquants = JOURS_SEMAINE.filter(
        (j) => !r.jours[j]?.retirer?.includes(m) && !parametresDefinis(c, r, m, j).has(p),
      );
      if (manquants.length > 0) {
        signaler(['routines', nom], `le paramètre $${p} du mode ${m} n'a pas de valeur (ni dans modes.${m}.parametres, ` +
          `ni dans routines.${nom}.parametres.${m}) pour : ${manquants.join(', ')}`);
      }
    }
  }
}

function verifierModesParAppareil(c: Config, nom: string, r: Routine, modes: string[], signaler: Signaler): void {
  for (const j of JOURS_SEMAINE) {
    const actifs = modes.filter((m) => !r.jours[j]?.retirer?.includes(m));
    for (const a of Object.keys(c.appareils)) {
      if (!actifs.some((m) => !c.modes[m]!.appareils || c.modes[m]!.appareils!.includes(a))) {
        signaler(['routines', nom, 'jours', j], `aucun mode ne s'applique à l'appareil ${a} ce jour-là`);
      }
    }
  }
}

function verifierCalendrier(c: Config, signaler: Signaler): void {
  c.calendrier.forEach((p, i) => {
    if (!c.routines[p.routine]) signaler(['calendrier', i, 'routine'], inconnu('routine inconnue', p.routine, Object.keys(c.routines)));
    if (p.du > p.au) signaler(['calendrier', i], `plage inversée : du ${p.du} est après au ${p.au}`);
  });
  for (let i = 0; i < c.calendrier.length; i++) {
    for (let k = i + 1; k < c.calendrier.length; k++) {
      const a = c.calendrier[i]!;
      const b = c.calendrier[k]!;
      if (a.du <= a.au && b.du <= b.au && a.du <= b.au && b.du <= a.au) {
        signaler(['calendrier', k], `chevauche la plage calendrier[${i}] (${a.du} → ${a.au})`);
      }
    }
  }
}

// ─── Messages ─────────────────────────────────────────────────────────────────

/** Clés connues du YAML, pour suggérer la bonne en cas de faute de frappe. */
const CLES_CONNUES = [
  'version', 'utilisateur', 'sommeil', 'cible', 'minimum', 'plancher_nuit', 'lever_plancher', 'reveil_libre',
  'engagements', 'heure', 'preparation', 'reveil', 'annulable', 'decalable', 'apps', 'nom', 'domaines', 'iphone',
  'groupes', 'appareils', 'type', 'comptes_de_travail', 'modes', 'quand', 'effets', 'bloque', 'sauf',
  'verrouiller_session', 'fermer_comptes_hors_travail', 'sessions', 'parametres', 'routines', 'fuseau', 'jours',
  'lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim', 'conditions_en_plus', 'retirer', 'routine_par_defaut',
  'calendrier', 'routine', 'du', 'au', 'todoist', 'etiquette_planning', 'etiquette_recap', 'recap_tolerance_jours',
  'prioritaires', 'etiquettes_exclues', 'prix_du_report', 'par_report', 'plafond', 'commentaire_min', 'deadline',
  'reports_max', 'jours_minimum', 'plafond_quotidien', 'attentes_s', 'delai_nouvelle_tache',
  'expiration_question_s', 'intervalle_question', 'pc', 'apres', 'avant', 'decale_par', 'filtre', 'au_plus',
  'priorites', 'etiquettes_incluses', 'verification', 'mesure',
];

/** Distance d'édition avec transposition (« WROK » est à 1 de « WORK »). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, k) => (i === 0 ? k : k === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let k = 1; k <= b.length; k++) {
      const cout = a[i - 1] === b[k - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![k]! + 1, d[i]![k - 1]! + 1, d[i - 1]![k - 1]! + cout);
      if (i > 1 && k > 1 && a[i - 1] === b[k - 2] && a[i - 2] === b[k - 1]) v = Math.min(v, d[i - 2]![k - 2]! + 1);
      d[i]![k] = v;
    }
  }
  return d[a.length]![b.length]!;
}

function suggestion(nom: string, candidats: readonly string[]): string {
  let meilleur: string | undefined;
  let min = Math.max(1, Math.floor(nom.length / 3));
  for (const c of candidats) {
    const d = distance(nom.toLowerCase(), c.toLowerCase());
    if (d <= min && c !== nom) {
      min = d;
      meilleur = c;
    }
  }
  return meilleur ? ` (vouliez-vous dire « ${meilleur} » ?)` : '';
}

function inconnu(quoi: string, nom: string, connus: string[]): string {
  return `${quoi} « ${nom} »${suggestion(nom, connus)}`;
}

function typeDe(v: unknown): string {
  if (v === null || v === undefined) return 'rien';
  if (Array.isArray(v)) return 'une liste';
  if (typeof v === 'object') return 'un objet';
  if (typeof v === 'number') return `le nombre ${v}`;
  if (typeof v === 'boolean') return `le booléen ${v}`;
  return `le texte « ${String(v)} »`;
}

const NOMS_TYPES: Record<string, string> = {
  string: 'texte',
  number: 'nombre',
  int: 'nombre entier',
  boolean: 'booléen (true ou false)',
  object: 'objet',
  array: 'liste',
};

function messageIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.input === undefined) return 'champ obligatoire manquant';
      return `${NOMS_TYPES[issue.expected] ?? issue.expected} attendu, reçu ${typeDe(issue.input)}`;
    case 'unrecognized_keys':
      return issue.keys.map((k) => `clé inconnue « ${k} »${suggestion(k, CLES_CONNUES)}`).join(' ; ');
    case 'invalid_value':
      return `valeur ${typeof issue.input === 'string' ? `« ${issue.input} »` : String(issue.input)} invalide ; attendu : ${issue.values.map(String).join(', ')}`;
    case 'too_small':
      if (issue.origin === 'array') return `liste trop courte : au moins ${issue.minimum} élément(s)`;
      if (issue.origin === 'string') return 'texte vide';
      return `doit être au moins ${issue.minimum}`;
    case 'too_big':
      return `doit être au plus ${issue.maximum}`;
    default:
      return issue.message;
  }
}

function cheminTexte(chemin: Chemin): string {
  if (chemin.length === 0) return '(racine)';
  return chemin.reduce<string>(
    (acc, p) => (typeof p === 'number' ? `${acc}[${p}]` : acc ? `${acc}.${p}` : p),
    '',
  );
}

const ERREURS_YAML: Record<string, string> = {
  DUPLICATE_KEY: 'clé en double',
  BAD_INDENT: 'indentation incorrecte',
  TAB_AS_INDENT: 'tabulation utilisée pour indenter',
  MISSING_CHAR: 'caractère manquant',
  MULTILINE_IMPLICIT_KEY: 'clé implicite sur plusieurs lignes',
  BLOCK_AS_IMPLICIT_KEY: 'bloc utilisé comme clé',
  UNEXPECTED_TOKEN: 'symbole inattendu',
  BAD_SCALAR_START: 'valeur mal commencée',
};

// ─── Point d'entrée ───────────────────────────────────────────────────────────

export function validerConfig(yaml: string): ResultatValidation {
  const doc = parseDocument(yaml, { version: '1.2', uniqueKeys: true, prettyErrors: true });
  if (doc.errors.length > 0) {
    return {
      ok: false,
      erreurs: doc.errors.map((e) => {
        const pos = e.linePos?.[0];
        const ou = pos ? ` (ligne ${pos.line}, colonne ${pos.col})` : '';
        const cause = ERREURS_YAML[e.code] ?? `erreur de syntaxe ${e.code}`;
        return `YAML invalide${ou} : ${cause}`;
      }),
    };
  }
  const brut: unknown = doc.toJS();
  if (brut === null || brut === undefined) return { ok: false, erreurs: ['(racine) : la configuration est vide'] };

  const forme = schemaConfig.safeParse(brut, { reportInput: true });
  if (!forme.success) {
    return { ok: false, erreurs: forme.error.issues.map((i) => `${cheminTexte(i.path as Chemin)} : ${messageIssue(i)}`) };
  }
  const config = normaliser(forme.data);
  const erreurs = verifierCoherence(config);
  return erreurs.length > 0 ? { ok: false, erreurs } : { ok: true, config };
}

/** Comme validerConfig, mais lève une erreur listant toutes les causes. */
export function lireConfig(yaml: string): Config {
  const r = validerConfig(yaml);
  if (!r.ok) throw new Error(`configuration refusée :\n- ${r.erreurs.join('\n- ')}`);
  return r.config;
}
