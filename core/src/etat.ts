// Choix du mode et actions par appareil (docs/conception.md §3.2, §3.3).

import type { ActionsIphone, ActionsPc, Condition, Config, Contexte, Effets, EtatAppareil, Journee } from './types';
import { juger, type Environnement, type Jugement } from './conditions';
import { journeeCourante, modesActifs, parametresDuMode, routineDuJour } from './journee';
import { jourSemaine, lireInstant } from './temps';

export function verifierAppareil(config: Config, appareil: string): void {
  if (!config.appareils[appareil]) {
    throw new Error(`appareil inconnu « ${appareil} » (connus : ${Object.keys(config.appareils).join(', ')})`);
  }
}

/** Modes candidats de la journée pour l'appareil, dans l'ordre, avec leurs conditions complètes. */
export function modesCandidats(config: Config, journee: Journee, appareil: string): { mode: string; conditions: Condition[]; parametres: Record<string, string> }[] {
  const { routine } = routineDuJour(config, journee.date);
  const jour = jourSemaine(journee.date);
  return modesActifs(routine, jour)
    .filter((m) => {
      const cibles = config.modes[m]!.appareils;
      return !cibles || cibles.includes(appareil);
    })
    .map((m) => ({
      mode: m,
      conditions: [config.modes[m]!.quand, ...(routine.jours[jour]?.conditionsEnPlus?.[m] ?? [])],
      parametres: parametresDuMode(config, routine, m, jour),
    }));
}

function environnement(contexte: Contexte, journee: Journee, instant: number, parametres: Record<string, string>): Environnement {
  return { config: contexte.config, faits: contexte.faits, journee, instant, parametres };
}

function choisirMode(contexte: Contexte, journee: Journee, appareil: string, instant: number): { mode: string; raison: string } {
  const candidats = modesCandidats(contexte.config, journee, appareil);
  let ecarte: { mode: string; jugement: Jugement } | undefined;
  for (const c of candidats) {
    const condition: Condition = c.conditions.length === 1 ? c.conditions[0]! : { tous: c.conditions };
    const jugement = juger(condition, environnement(contexte, journee, instant, c.parametres));
    if (jugement.vrai) {
      const raison = condition === 'toujours' && ecarte
        ? `${ecarte.mode} non atteint : ${ecarte.jugement.pourquoi}`
        : jugement.pourquoi;
      return { mode: c.mode, raison: `${c.mode} — ${raison}` };
    }
    ecarte = { mode: c.mode, jugement };
  }
  const defaut = candidats.at(-1);
  if (!defaut) throw new Error(`aucun mode ne s'applique à l'appareil ${appareil} le ${journee.date}`);
  return { mode: defaut.mode, raison: `${defaut.mode} — mode par défaut (aucune condition vraie)` };
}

function appsCiblees(config: Config, cibles: Effets['bloque']): Set<string> {
  if (cibles === undefined) return new Set();
  if (cibles === 'tout') return new Set(Object.keys(config.apps));
  return new Set(cibles.flatMap((id) => config.groupes[id] ?? [id]));
}

function triesSansDoublon(valeurs: string[], exclues: Set<string>): string[] {
  return [...new Set(valeurs)].filter((v) => !exclues.has(v)).sort();
}

/** Les apps de `sauf` ne sont jamais bloquées, même si un de leurs domaines figure ailleurs. */
export function actionsDuMode(config: Config, mode: string, appareil: string): ActionsPc | ActionsIphone {
  const effets = config.modes[mode]!.effets;
  const epargnees = appsCiblees(config, effets.sauf);
  const bloquees = [...appsCiblees(config, effets.bloque)].filter((a) => !epargnees.has(a)).map((a) => config.apps[a]!);
  const protegees = [...epargnees].map((a) => config.apps[a]!);

  if (config.appareils[appareil]!.type === 'iphone') {
    const ids = (apps: typeof bloquees) => apps.flatMap((a) => (a.iphone ? [a.iphone] : []));
    return { bloquer_apps: triesSansDoublon(ids(bloquees), new Set(ids(protegees))) };
  }
  return {
    bloquer_domaines: triesSansDoublon(
      bloquees.flatMap((a) => a.domaines),
      new Set(protegees.flatMap((a) => a.domaines)),
    ),
    verrouiller_session: effets.verrouillerSession ?? false,
    fermer_comptes_hors_travail: effets.fermerComptesHorsTravail ?? false,
  };
}

export function etatA(contexte: Contexte, appareil: string, journee: Journee, instant: number): EtatAppareil {
  const { mode, raison } = choisirMode(contexte, journee, appareil, instant);
  return {
    journee,
    mode,
    sessions: contexte.config.modes[mode]!.sessions,
    actions: actionsDuMode(contexte.config, mode, appareil),
    raison,
  };
}

export function etat(contexte: Contexte, appareil: string): EtatAppareil {
  verifierAppareil(contexte.config, appareil);
  return etatA(contexte, appareil, journeeCourante(contexte), lireInstant(contexte.maintenant));
}
