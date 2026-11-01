// Format réel des réponses de l'API (api/src/planning.ts, sessions.ts, exceptions.ts) et sa
// conversion vers le contrat de l'interface (contrat.ts). Tout écart avec l'API se corrige ici.
import type { ActionsIphone, ActionsPc } from '../../../core/src/types';
import type {
  ActionsStatut,
  AppBloquee,
  GroupeBloque,
  CorpsException,
  EngagementDemain,
  EtapeParcours,
  Journee,
  NuitPassee,
  Phase,
  PrixException,
  Priorite,
  Question,
  ReponseStatut,
  ReponseTaches,
  SessionOuverte,
  SortieMode,
  StatutAppareil,
  TypeAppareil,
} from './contrat';

export interface JourneeFil {
  date: string;
  routine: string;
  fuseau: string;
  engagements: string[];
  lever: string;
  lever_suivant: string;
  coucher_prevu: string;
  coucher_applique: string;
  ouverture: string;
  prix_du_report_min: number;
  dette_nuit_min: number;
  decision_de_nuit_prise: boolean;
}

export interface SessionFil {
  id: string;
  type?: string;
  tache: { id: string; nom: string } | null;
  appareil: string;
  apps: string[];
  domaines?: string[];
  identifiants_iphone?: string[];
  ouverte_le: string;
  fermee_le?: string | null;
  motif_fin?: string | null;
  question: Question | null;
  prochaine_question_a?: string | null;
}

export interface StatutFil {
  heure_serveur: string;
  config_version: string | null;
  journee: JourneeFil;
  appareils: {
    nom: string;
    type: TypeAppareil;
    mode: string;
    sessions: 'autorisees' | 'interdites';
    session_possible?: boolean;
    session_motif?: string | null;
    raison: string;
    actions?: ActionsPc | ActionsIphone;
    apps_bloquees?: AppBloquee[];
    groupes_bloques?: GroupeBloque[];
    dernier_ping: string | null;
    jusqua?: string | null;
    parcours?: EtapeParcours[];
    sortie?: SortieMode;
  }[];
  appareil_principal?: string;
  sessions: SessionFil[];
  sessions_du_jour?: { cumul_min: number; plafond_min: number };
  nuits?: NuitPassee[];
  dette_cumulee_min?: number;
  dette_semaine?: ReponseStatut['dette_semaine'];
  bilans_semaines?: ReponseStatut['bilans_semaines'];
  levers?: ReponseStatut['levers'];
  couchers?: ReponseStatut['couchers'];
  sommeil_mesure?: ReponseStatut['sommeil_mesure'];
  objectif_sommeil_min?: number;
  siestes_total_min?: number;
  siestes_du_jour?: ReponseStatut['siestes_du_jour'];
  siestes_du_jour_min?: number;
  sieste_tardive?: ReponseStatut['sieste_tardive'];
  phase?: Phase;
  actions?: ActionsStatut;
  engagements_demain?: EngagementDemain[];
  aujourdhui?: string;
  engagements_verifies?: ReponseStatut['engagements_verifies'];
  sautes_semaine?: number;
  seances_mesurees?: ReponseStatut['seances_mesurees'];
  todoist?: ReponseStatut['todoist'];
  taches_bloquantes?: ReponseStatut['taches_bloquantes'];
}

export interface TachesFil {
  journee?: string;
  taches: { id: string; nom: string; priorite: Priorite; eligible_le: string; eligible?: boolean }[];
}

export interface PrixFil {
  admissible: boolean;
  motif_refus: string | null;
  friction: 'aucune' | 'raison' | 'raison_phrase';
  friction_manquante?: boolean;
  resserre: boolean;
  coucher_avant: string;
  coucher_apres: string;
  lever_avant: string;
  lever_apres: string;
  dette_avant_min: number;
  dette_apres_min: number;
}

export function journeeDepuisFil(j: JourneeFil): Journee {
  return {
    date: j.date,
    routine: j.routine,
    fuseau: j.fuseau,
    engagements: j.engagements,
    lever: j.lever,
    leverSuivant: j.lever_suivant,
    coucherPrevu: j.coucher_prevu,
    coucherApplique: j.coucher_applique,
    ouverture: j.ouverture,
    prixDuReportMin: j.prix_du_report_min,
    detteNuitMin: j.dette_nuit_min,
    decisionDeNuitPrise: j.decision_de_nuit_prise,
  };
}

function sessionDepuisFil(s: SessionFil): SessionOuverte {
  return {
    id: s.id,
    appareil: s.appareil,
    tache: s.tache,
    apps: s.apps,
    domaines: s.domaines ?? [],
    ouverte_le: s.ouverte_le,
    question: s.question,
    ...(s.prochaine_question_a !== undefined ? { prochaine_question_a: s.prochaine_question_a } : {}),
  };
}

export function statutDepuisFil(s: StatutFil): ReponseStatut {
  return {
    heure_serveur: s.heure_serveur,
    config_version: s.config_version,
    journee: journeeDepuisFil(s.journee),
    ...(s.appareil_principal ? { appareil_principal: s.appareil_principal } : {}),
    appareils: s.appareils.map(
      (a): StatutAppareil => ({
        appareil: a.nom,
        type: a.type,
        mode: a.mode,
        raison: a.raison,
        sessions: a.sessions,
        session_possible: a.session_possible ?? a.sessions === 'autorisees',
        session_motif: a.session_motif ?? null,
        vu_le: a.dernier_ping,
        ...(a.jusqua !== undefined ? { jusqua: a.jusqua } : {}),
        ...(a.parcours ? { parcours: a.parcours } : {}),
        ...(a.sortie ? { sortie: a.sortie } : {}),
        ...(a.actions ? { actions: a.actions } : {}),
        ...(a.apps_bloquees ? { apps_bloquees: a.apps_bloquees } : {}),
        ...(a.groupes_bloques ? { groupes_bloques: a.groupes_bloques } : {}),
      }),
    ),
    sessions: s.sessions.filter((x) => !x.fermee_le).map(sessionDepuisFil),
    ...(s.sessions_du_jour ? { sessions_du_jour: s.sessions_du_jour } : {}),
    ...(s.nuits ? { nuits: s.nuits } : {}),
    ...(s.dette_cumulee_min !== undefined ? { dette_cumulee_min: s.dette_cumulee_min } : {}),
    ...(s.dette_semaine ? { dette_semaine: s.dette_semaine } : {}),
    ...(s.bilans_semaines ? { bilans_semaines: s.bilans_semaines } : {}),
    ...(s.levers ? { levers: s.levers } : {}),
    ...(s.couchers ? { couchers: s.couchers } : {}),
    ...(s.sommeil_mesure !== undefined ? { sommeil_mesure: s.sommeil_mesure } : {}),
    ...(s.objectif_sommeil_min !== undefined ? { objectif_sommeil_min: s.objectif_sommeil_min } : {}),
    ...(s.siestes_total_min !== undefined ? { siestes_total_min: s.siestes_total_min } : {}),
    ...(s.siestes_du_jour ? { siestes_du_jour: s.siestes_du_jour } : {}),
    ...(s.siestes_du_jour_min !== undefined ? { siestes_du_jour_min: s.siestes_du_jour_min } : {}),
    ...(s.sieste_tardive !== undefined ? { sieste_tardive: s.sieste_tardive } : {}),
    ...(s.phase ? { phase: s.phase } : {}),
    ...(s.actions ? { actions: s.actions } : {}),
    ...(s.engagements_demain ? { engagements_demain: s.engagements_demain } : {}),
    ...(s.aujourdhui ? { aujourdhui: s.aujourdhui } : {}),
    ...(s.engagements_verifies ? { engagements_verifies: s.engagements_verifies } : {}),
    ...(s.sautes_semaine !== undefined ? { sautes_semaine: s.sautes_semaine } : {}),
    ...(s.seances_mesurees !== undefined ? { seances_mesurees: s.seances_mesurees } : {}),
    ...(s.todoist ? { todoist: s.todoist } : {}),
    ...(s.taches_bloquantes ? { taches_bloquantes: s.taches_bloquantes } : {}),
  };
}

export function tachesDepuisFil(t: TachesFil): ReponseTaches {
  return { taches: t.taches.map(({ id, nom, priorite, eligible_le }) => ({ id, nom, priorite, eligible_le })) };
}

export function prixDepuisFil(p: PrixFil): PrixException {
  return {
    admissible: p.admissible,
    ...(p.motif_refus ? { motifRefus: p.motif_refus } : {}),
    friction: p.friction,
    ...(p.friction_manquante ? { frictionManquante: true } : {}),
    resserre: p.resserre,
    coucherAvant: p.coucher_avant,
    coucherApres: p.coucher_apres,
    leverAvant: p.lever_avant,
    leverApres: p.lever_apres,
    detteAvantMin: p.dette_avant_min,
    detteApresMin: p.dette_apres_min,
  };
}

/** L'API lit un corps à plat : champs de la demande, puis `raison` et `phrase`. */
export function corpsExceptionVersFil({ demande, friction }: CorpsException): Record<string, unknown> {
  let champs: Record<string, unknown>;
  switch (demande.type) {
    case 'ajoute':
    case 'decale': {
      const { preparationMin, ...reste } = demande;
      champs = { ...reste, ...(preparationMin !== undefined ? { preparation_min: preparationMin } : {}) };
      break;
    }
    case 'avancer_coucher':
      // L'heure est celle du serveur : l'instant du client n'est pas envoyé.
      champs = { type: demande.type, nuit: demande.nuit };
      break;
    default:
      champs = { ...demande };
  }
  return {
    ...champs,
    ...(friction?.raison !== undefined ? { raison: friction.raison } : {}),
    ...(friction?.phrase !== undefined ? { phrase: friction.phrase } : {}),
  };
}
