// Explication de la décision (docs/conception.md §3.7) : pour chaque mode du jour, ses
// conditions jugées maintenant, et comment on sort du mode actuel. Contrairement au planning,
// rien ici ne suppose les faits Todoist constants : ce qui dépend d'une action est dit tel quel.

import type {
  Condition,
  ConditionExpliquee,
  Config,
  Contexte,
  DateLocale,
  Journee,
  ModeExplique,
  SortieMode,
  Tache,
  TypeConditionExpliquee,
} from './types';
import {
  bornes,
  juger,
  planningRestant,
  prioritairesRestantes,
  recapRestant,
  retardsRestants,
  tachesFiltrees,
  type ConditionHeure,
  type Environnement,
} from './conditions';
import { etatA, verifierAppareil } from './etat';
import { lireExpression } from './expressions';
import { journeeCourante, parametresDuMode, routineDuJour } from './journee';
import { ajouterJours, dateCourte, ecrireInstant, jourSemaine, lireInstant, local } from './temps';

export const NOMS_DES_MODES: Record<string, string> = {
  NIGHT_LOCK: 'Nuit',
  MORNING_LOCK: 'Matin verrouillé',
  EVENING_FREE: 'Soirée libre',
  WORK: 'Travail',
};

/** Condition jugée, avec ce qu'il faut pour raisonner sur la sortie. */
interface Feuille {
  type: TypeConditionExpliquee;
  /** Le fait, énoncé positivement, même sous `pas` (« Planning du matin »). */
  libelle: string;
  /** Vrai si le mode s'applique de ce côté-là (négation comprise) : sert à la sortie. */
  vraie: boolean;
  detail: string | null;
  /** Heure : instant où le fait positif devient vrai (ce que l'API expose). */
  aPositif: number | null;
  /** Heure : instant où elle devient vraie. */
  a: number | null;
  /** Heure : instant où elle devient fausse (null : pas dans la journée). */
  finA: number | null;
  /** Énoncée sous forme niée (`pas`). */
  nie: boolean;
  /** Condition de tâches, forme positive : « … est fait » / « … sera fait ». */
  present: string | null;
  futur: string | null;
}

interface ModeInterne {
  explique: Omit<ModeExplique, 'conditions'>;
  feuilles: Feuille[];
}

// ─── Libellés ─────────────────────────────────────────────────────────────────

function pluriel(n: number, singulier: string, pluriel = `${singulier}s`): string {
  return `${n} ${n > 1 ? pluriel : singulier}`;
}

function heure(t: number, env: Environnement): string {
  return local(t, env.journee.fuseau).heure;
}

function enumerer(morceaux: string[]): string {
  return morceaux.length <= 1 ? (morceaux[0] ?? '') : `${morceaux.slice(0, -1).join(', ')} et ${morceaux.at(-1)}`;
}

function prioritesLisibles(config: Config): string {
  return config.todoist.prioritaires.map((p) => p.toUpperCase()).join('/');
}

function recapLisible(config: Config): string {
  const n = config.todoist.recapToleranceJours;
  return n === 0 ? 'récap du jour' : n === 1 ? "récap d'hier" : `récap d'il y a ${n} jours`;
}

function majuscule(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function minuscule(texte: string): string {
  return texte.charAt(0).toLowerCase() + texte.slice(1);
}

/** La plus ancienne échéance d'une liste de tâches (null si aucune). */
function plusAncienne(taches: Tache[]): DateLocale | null {
  return taches.reduce<DateLocale | null>((min, t) => (t.echeance !== null && (min === null || t.echeance < min) ? t.echeance : min), null);
}

/** Planning et récap : la date depuis laquelle il manque, dite comme on la dirait (01/11, Frédéric). */
function detailEcheance(taches: Tache[], attendue: DateLocale, quoi: 'planning' | 'récap'): string {
  const d = plusAncienne(taches);
  if (d === null || d >= attendue) return 'à faire';
  return d === ajouterJours(attendue, -1) ? `pas de ${quoi} fait hier` : `pas de ${quoi} fait depuis le ${dateCourte(d)}`;
}

/** « 3 tâches restantes dont 2 en retard » (formulation choisie par Frédéric, 01/11). */
function detailPrioritaires(taches: Tache[], jour: DateLocale): string {
  const enRetard = taches.filter((t) => t.echeance !== null && t.echeance < jour).length;
  const total = `${taches.length} tâche${taches.length > 1 ? 's' : ''} restante${taches.length > 1 ? 's' : ''}`;
  return enRetard === 0 ? total : `${total} dont ${enRetard} en retard`;
}

// ─── Feuilles ─────────────────────────────────────────────────────────────────

function feuilleHeure(h: ConditionHeure, env: Environnement, nie: boolean): Feuille {
  const b = bornes(h, env);
  const t = env.instant;
  const dansPlage = (b.apres === undefined || t >= b.apres) && (b.avant === undefined || t < b.avant);
  const reportMin = h.decalePar === 'prix_du_report' ? env.journee.prixDuReportMin : 0;
  // L'heure effective (report compris), comme `journee.ouverture` : une seule mention.
  const debut = b.apres !== undefined ? heure(b.apres, env) : '';
  let nom = 'Ouverture';
  if (h.apres !== undefined) {
    const e = lireExpression(h.apres);
    if (e && 'variable' in e && e.decalageMin === 0 && e.variable === 'coucher') nom = 'Coucher';
    if (e && 'variable' in e && e.decalageMin === 0 && e.variable === 'lever') nom = 'Lever';
  }
  const fin = b.avant !== undefined ? heure(b.avant, env) : '';
  const libelle = b.apres !== undefined && b.avant !== undefined
    ? `De ${debut} à ${fin}`
    : b.apres !== undefined ? `${nom} à ${debut}` : `Avant ${fin}`;
  const detail = reportMin > 0 && b.apres !== undefined ? `+${reportMin} min de report` : null;

  let a: number | null;
  let finA: number | null;
  if (!nie) {
    a = b.apres ?? null;
    finA = b.avant ?? null;
  } else {
    a = b.avant ?? null;
    finA = b.apres !== undefined && t < b.apres ? b.apres : null;
  }
  return { type: 'heure', libelle, vraie: dansPlage !== nie, detail, aPositif: b.apres ?? null, a, finA, nie, present: null, futur: null };
}

function feuilleTaches(
  type: TypeConditionExpliquee,
  n: number,
  textes: { fait: string; present: string; futur: string; detail: string },
  nie: boolean,
  vraiSiAucune = n === 0,
): Feuille {
  return {
    type,
    libelle: textes.fait,
    vraie: vraiSiAucune !== nie,
    detail: vraiSiAucune ? null : textes.detail,
    aPositif: null,
    a: null,
    finA: null,
    nie,
    present: textes.present,
    futur: textes.futur,
  };
}

function feuille(condition: Condition, env: Environnement, nie: boolean): Feuille {
  const { config, faits } = env;
  const jour = env.journee.date;
  if (condition === 'toujours') {
    return { type: 'toujours', libelle: 'Par défaut', vraie: !nie, detail: null, aPositif: null, a: null, finA: null, nie, present: null, futur: null };
  }
  if (condition === 'planning_fait') {
    const restant = planningRestant(config, faits, jour);
    return feuilleTaches('planning', restant.length, {
      fait: 'Planning du matin',
      present: 'le planning du matin est fait',
      futur: 'le planning du matin sera fait',
      detail: detailEcheance(restant, jour, 'planning'),
    }, nie);
  }
  if (condition === 'recap_fait') {
    const restant = recapRestant(config, faits, jour);
    const r = recapLisible(config);
    return feuilleTaches('recap', restant.length, {
      fait: majuscule(r),
      present: `le ${r} est fait`,
      futur: `le ${r} sera fait`,
      detail: detailEcheance(restant, ajouterJours(jour, -config.todoist.recapToleranceJours), 'récap'),
    }, nie);
  }
  if (condition === 'prioritaires_faites') {
    const restant = prioritairesRestantes(config, faits, jour);
    const p = prioritesLisibles(config);
    return feuilleTaches('prioritaires', restant.length, {
      fait: `Tâches ${p} faites`,
      present: `les tâches ${p} sont faites`,
      futur: `les tâches ${p} seront faites`,
      detail: detailPrioritaires(restant, jour),
    }, nie);
  }
  if (condition === 'aucun_retard') {
    const n = retardsRestants(faits, jour).length;
    return feuilleTaches('retard', n, {
      fait: 'Retards rattrapés',
      present: 'les retards sont rattrapés',
      futur: 'les retards seront rattrapés',
      detail: `${pluriel(n, 'restante')} (en retard à minuit)`,
    }, nie);
  }
  if ('heure' in condition) return feuilleHeure(condition.heure, env, nie);
  if ('nombreDeTaches' in condition) {
    const { filtre, auPlus } = condition.nombreDeTaches;
    const n = tachesFiltrees(faits, jour, filtre).length;
    const quoi = `${pluriel(auPlus, 'tâche')} ${filtre.jour === 'aujourd_hui' ? 'du jour' : filtre.jour === 'retard' ? 'en retard' : 'du jour ou en retard'}`;
    return feuilleTaches('taches', n, {
      fait: `Au plus ${quoi}`,
      present: `il reste au plus ${quoi}`,
      futur: `il restera au plus ${quoi}`,
      detail: `${n} en tout`,
    }, nie, n <= auPlus);
  }
  if ('pas' in condition && !estCombinaison(condition.pas)) return feuille(condition.pas, env, !nie);
  return feuilleComposee(condition, env, nie);
}

function estCombinaison(c: Condition): boolean {
  return typeof c === 'object' && ('tous' in c || 'unParmi' in c || 'pas' in c);
}

/** Combinaison imbriquée : une seule ligne, libellé composé ; traitée comme dépendant d'une action. */
function feuilleComposee(condition: Condition, env: Environnement, nie: boolean): Feuille {
  const enfants = typeof condition === 'object' && 'tous' in condition ? condition.tous
    : typeof condition === 'object' && 'unParmi' in condition ? condition.unParmi
    : typeof condition === 'object' && 'pas' in condition ? [condition.pas] : [condition];
  const sous = enfants.map((c) => feuille(c, env, false));
  const lien = typeof condition === 'object' && 'unParmi' in condition ? ' ou ' : ' et ';
  let libelle = sous.map((f, i) => (i === 0 ? f.libelle : minuscule(f.libelle))).join(lien);
  if (typeof condition === 'object' && 'pas' in condition) libelle = `Pas : ${minuscule(libelle)}`;
  // Sous `pas`, le libellé reste positif : la négation est portée par `niee`.
  return {
    type: sous.find((f) => f.type !== 'toujours')?.type ?? 'toujours',
    libelle,
    vraie: juger(condition, env).vrai !== nie,
    detail: null,
    aPositif: null,
    a: null,
    finA: null,
    nie,
    present: minuscule(libelle),
    futur: minuscule(libelle),
  };
}

// ─── Modes ────────────────────────────────────────────────────────────────────

function modesInternes(contexte: Contexte, appareil: string, journee: Journee, instant: number): ModeInterne[] {
  const { config } = contexte;
  const { routine } = routineDuJour(config, journee.date);
  const jour = jourSemaine(journee.date);
  const retires = routine.jours[jour]?.retirer ?? [];
  const actif = etatA(contexte, appareil, journee, instant).mode;

  return routine.modes.map((id) => {
    const mode = config.modes[id]!;
    const env: Environnement = { config, faits: contexte.faits, journee, instant, parametres: parametresDuMode(config, routine, id, jour) };
    const enPlus = routine.jours[jour]?.conditionsEnPlus?.[id] ?? [];
    const q = mode.quand;
    let logique: ModeExplique['logique'];
    let feuilles: Feuille[];
    if (enPlus.length === 0 && typeof q === 'object' && 'tous' in q) {
      logique = 'tous';
      feuilles = q.tous.map((c) => feuille(c, env, false));
    } else if (enPlus.length === 0 && typeof q === 'object' && 'unParmi' in q) {
      logique = 'un_parmi';
      feuilles = q.unParmi.map((c) => feuille(c, env, false));
    } else if (enPlus.length === 0 && typeof q === 'object' && 'pas' in q) {
      logique = 'pas';
      feuilles = [estCombinaison(q.pas) ? feuilleComposee(q.pas, env, true) : feuille(q.pas, env, true)];
    } else if (enPlus.length === 0) {
      logique = 'simple';
      feuilles = [feuille(q, env, false)];
    } else {
      logique = 'tous';
      feuilles = [q, ...enPlus].flatMap((c) => (typeof c === 'object' && 'tous' in c ? c.tous : [c])).map((c) => feuille(c, env, false));
    }
    const applicable = !retires.includes(id) && (!mode.appareils || mode.appareils.includes(appareil));
    return { explique: { mode: id, nom: NOMS_DES_MODES[id] ?? id, applicable, actif: id === actif, logique }, feuilles };
  });
}

function versExplique({ explique, feuilles }: ModeInterne): ModeExplique {
  return {
    ...explique,
    // Toujours le fait positif : `vraie` est son état réel, `niee` dit qu'il joue à l'envers.
    conditions: feuilles.map((f) => ({
      type: f.type,
      libelle: f.libelle,
      vraie: f.nie ? !f.vraie : f.vraie,
      detail: f.detail,
      a: f.aPositif === null ? null : ecrireInstant(f.aPositif),
      niee: f.nie,
    }) satisfies ConditionExpliquee),
  };
}

export function expliquer(contexte: Contexte, appareil: string): ModeExplique[] {
  verifierAppareil(contexte.config, appareil);
  const journee = journeeCourante(contexte);
  return modesInternes(contexte, appareil, journee, lireInstant(contexte.maintenant)).map(versExplique);
}

// ─── Sortie du mode actuel ────────────────────────────────────────────────────

interface Chemin {
  /** Conditions de tâches à remplir (vide : la sortie ne dépend que de l'heure). */
  actions: Feuille[];
  /** Heure à atteindre, si le chemin en exige une. */
  heure: number | null;
}

/** Ce qu'il faut pour que des conditions fausses deviennent vraies ; null si inatteignable sans régression. */
function chemin(fausses: Feuille[], t: number): Chemin | null {
  const actions: Feuille[] = [];
  let heure: number | null = null;
  for (const f of fausses) {
    if (f.type === 'heure') {
      if (f.a === null || f.a <= t) return null;
      heure = Math.max(heure ?? f.a, f.a);
    } else if (f.type === 'toujours' || f.nie) {
      return null;
    } else {
      actions.push(f);
    }
  }
  return { actions, heure };
}

function cheminsVers(m: ModeInterne, t: number): Chemin[] {
  const fausses = m.feuilles.filter((f) => !f.vraie);
  if (m.explique.logique === 'un_parmi') return fausses.map((f) => chemin([f], t)).filter((c): c is Chemin => c !== null);
  const c = chemin(fausses, t);
  return c ? [c] : [];
}

/** Ce qui fait tomber le mode actif : une condition vraie qui cessera de l'être. */
function cheminsHors(m: ModeInterne, t: number): Chemin[] {
  const vraies = m.feuilles.filter((f) => f.vraie);
  if (m.explique.logique === 'un_parmi' && vraies.length !== 1) return [];
  const chemins: Chemin[] = [];
  for (const f of vraies) {
    if (f.type === 'heure' && f.finA !== null && f.finA > t) chemins.push({ actions: [], heure: f.finA });
    else if (f.type !== 'heure' && f.type !== 'toujours' && f.nie) chemins.push({ actions: [f], heure: null });
  }
  return chemins;
}

function texteCertain(t: number, journee: Journee, env: Environnement): string {
  if (t === lireInstant(journee.coucherApplique)) return `au coucher, ${heure(t, env)}`;
  if (t === lireInstant(journee.leverSuivant)) return `au lever, ${heure(t, env)}`;
  return `à ${heure(t, env)}`;
}

function texteIncertain(c: Chemin, t: number, env: Environnement): string {
  const apres = c.heure !== null && c.heure > t ? [`après ${heure(c.heure, env)}`] : [];
  if (c.actions.length === 1 && apres.length === 0) return `dès que ${c.actions[0]!.present}`;
  return `quand ${enumerer([...c.actions.map((f) => f.futur!), ...apres])}`;
}

export function sortie(contexte: Contexte, appareil: string): SortieMode {
  verifierAppareil(contexte.config, appareil);
  const journee = journeeCourante(contexte);
  const t = lireInstant(contexte.maintenant);
  const env = { config: contexte.config, faits: contexte.faits, journee, instant: t, parametres: {} };
  const modes = modesInternes(contexte, appareil, journee, t);
  const rang = modes.findIndex((m) => m.explique.actif);

  const coucher = lireInstant(journee.coucherApplique);
  const chemins = [
    ...cheminsHors(modes[rang]!, t),
    ...modes.slice(0, rang).filter((m) => m.explique.applicable).flatMap((m) => cheminsVers(m, t)),
  ];
  const certain = Math.min(
    t < coucher ? coucher : lireInstant(journee.leverSuivant),
    ...chemins.filter((c) => c.actions.length === 0 && c.heure !== null).map((c) => c.heure!),
  );
  const incertain = chemins.find((c) => c.actions.length > 0 && (c.heure === null || c.heure < certain));
  return incertain
    ? { texte: texteIncertain(incertain, t, env), certaine: false, auPlusTard: ecrireInstant(certain) }
    : { texte: texteCertain(certain, journee, env), certaine: true, auPlusTard: ecrireInstant(certain) };
}
