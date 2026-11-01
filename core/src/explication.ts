// Explication de la décision (docs/conception.md §3.7) : pour chaque mode du jour, ses
// conditions jugées maintenant, et comment on sort du mode actuel. Contrairement au planning,
// rien ici ne suppose les faits Todoist constants : ce qui dépend d'une action est dit tel quel.

import type {
  Condition,
  ConditionExpliquee,
  Config,
  Contexte,
  Journee,
  ModeExplique,
  SortieMode,
  TypeConditionExpliquee,
} from './types';
import {
  bornes,
  juger,
  planningRestant,
  prioritairesRestantes,
  recapRestant,
  repere,
  retardsRestants,
  tachesFiltrees,
  type ConditionHeure,
  type Environnement,
} from './conditions';
import { etatA, verifierAppareil } from './etat';
import { lireExpression, resoudreExpression } from './expressions';
import { journeeCourante, parametresDuMode, routineDuJour } from './journee';
import { ecrireInstant, jourSemaine, lireInstant, local } from './temps';

export const NOMS_DES_MODES: Record<string, string> = {
  NIGHT_LOCK: 'Nuit',
  MORNING_LOCK: 'Matin verrouillé',
  EVENING_FREE: 'Soirée libre',
  WORK: 'Travail',
};

/** Condition jugée, avec ce qu'il faut pour raisonner sur la sortie. */
interface Feuille {
  type: TypeConditionExpliquee;
  libelle: string;
  vraie: boolean;
  detail: string | null;
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

// ─── Feuilles ─────────────────────────────────────────────────────────────────

function feuilleHeure(h: ConditionHeure, env: Environnement, nie: boolean): Feuille {
  const b = bornes(h, env);
  const t = env.instant;
  const dansPlage = (b.apres === undefined || t >= b.apres) && (b.avant === undefined || t < b.avant);
  const report = h.decalePar === 'prix_du_report' && env.journee.prixDuReportMin > 0
    ? ` (+${env.journee.prixDuReportMin} min de report)`
    : '';
  let debut = '';
  if (h.apres !== undefined) {
    const e = lireExpression(h.apres);
    const base = resoudreExpression(h.apres, repere(env));
    const variable = e && 'variable' in e && e.decalageMin === 0 && ['coucher', 'lever'].includes(e.variable) ? e.variable : null;
    debut = variable ? `le ${variable} ${heure(base, env)}` : `${heure(base, env)}${report}`;
  }
  const fin = b.avant !== undefined ? heure(b.avant, env) : '';
  const parNom = debut.startsWith('le ');

  let libelle: string;
  let a: number | null;
  let finA: number | null;
  if (!nie) {
    libelle = b.apres !== undefined && b.avant !== undefined
      ? `de ${debut.replace(/^le /, '')} à ${fin}`
      : b.apres !== undefined ? (parNom ? `dès ${debut}` : `après ${debut}`) : `avant ${fin}`;
    a = b.apres ?? null;
    finA = b.avant ?? null;
  } else {
    libelle = b.apres !== undefined && b.avant !== undefined
      ? `avant ${debut.replace(/^le /, '')} ou à partir de ${fin}`
      : b.apres !== undefined ? `avant ${debut}` : `à partir de ${fin}`;
    a = b.avant ?? null;
    finA = b.apres !== undefined && t < b.apres ? b.apres : null;
  }
  return { type: 'heure', libelle, vraie: dansPlage !== nie, detail: null, a, finA, nie, present: null, futur: null };
}

function feuilleTaches(
  type: TypeConditionExpliquee,
  n: number,
  textes: { oui: string; non: string; present: string; futur: string; detail: string },
  nie: boolean,
  vraiSiAucune = n === 0,
): Feuille {
  return {
    type,
    libelle: nie ? textes.non : textes.oui,
    vraie: vraiSiAucune !== nie,
    detail: n > 0 ? textes.detail : null,
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
    return { type: 'toujours', libelle: nie ? 'jamais' : 'toujours', vraie: !nie, detail: null, a: null, finA: null, nie, present: null, futur: null };
  }
  if (condition === 'planning_fait') {
    const n = planningRestant(config, faits, jour).length;
    return feuilleTaches('planning', n, {
      oui: 'planning du matin fait',
      non: 'planning du matin pas encore fait',
      present: 'le planning du matin est fait',
      futur: 'le planning du matin sera fait',
      detail: `${n} à faire`,
    }, nie);
  }
  if (condition === 'recap_fait') {
    const n = recapRestant(config, faits, jour).length;
    const r = recapLisible(config);
    return feuilleTaches('recap', n, {
      oui: `${r} fait`,
      non: `${r} pas encore fait`,
      present: `le ${r} est fait`,
      futur: `le ${r} sera fait`,
      detail: `${n} en retard`,
    }, nie);
  }
  if (condition === 'prioritaires_faites') {
    const n = prioritairesRestantes(config, faits, jour).length;
    const p = prioritesLisibles(config);
    return feuilleTaches('prioritaires', n, {
      oui: `tâches ${p} du jour faites`,
      non: `tâches ${p} du jour pas toutes faites`,
      present: `les tâches ${p} du jour sont faites`,
      futur: `les tâches ${p} du jour seront faites`,
      detail: pluriel(n, 'restante'),
    }, nie);
  }
  if (condition === 'aucun_retard') {
    const n = retardsRestants(faits, jour).length;
    return feuilleTaches('retard', n, {
      oui: 'aucun retard (photo de 00:00)',
      non: 'retards de la photo de 00:00 pas soldés',
      present: 'les retards de la photo de 00:00 sont soldés',
      futur: 'les retards de la photo de 00:00 seront soldés',
      detail: pluriel(n, 'restant'),
    }, nie);
  }
  if ('heure' in condition) return feuilleHeure(condition.heure, env, nie);
  if ('nombreDeTaches' in condition) {
    const { filtre, auPlus } = condition.nombreDeTaches;
    const n = tachesFiltrees(faits, jour, filtre).length;
    const quoi = `${pluriel(auPlus, 'tâche')} ${filtre.jour === 'aujourd_hui' ? 'du jour' : filtre.jour === 'retard' ? 'en retard' : 'du jour ou en retard'}`;
    return feuilleTaches('taches', n, {
      oui: `au plus ${quoi}`,
      non: `plus de ${quoi}`,
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
  let libelle = sous.map((f) => f.libelle).join(lien);
  if (typeof condition === 'object' && 'pas' in condition) libelle = `non (${libelle})`;
  if (nie) libelle = `non (${libelle})`;
  return {
    type: sous.find((f) => f.type !== 'toujours')?.type ?? 'toujours',
    libelle,
    vraie: juger(condition, env).vrai !== nie,
    detail: null,
    a: null,
    finA: null,
    nie,
    present: libelle,
    futur: libelle,
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
    conditions: feuilles.map((f) => ({
      type: f.type,
      libelle: f.libelle,
      vraie: f.vraie,
      detail: f.detail,
      a: f.a === null ? null : ecrireInstant(f.a),
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
