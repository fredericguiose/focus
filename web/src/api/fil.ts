// Format réel des réponses de l'API (api/src/planning.ts, sessions.ts, exceptions.ts) et sa
// conversion vers le contrat de l'interface (contrat.ts). Tout écart avec l'API se corrige ici.
import type { ActionsIphone, ActionsPc } from '../../../core/src/types';
import type {
  AppBloquee,
  CorpsException,
  Journee,
  PrixException,
  Priorite,
  Question,
  ReponseStatut,
  ReponseTaches,
  SessionOuverte,
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
    raison: string;
    actions?: ActionsPc | ActionsIphone;
    apps_bloquees?: AppBloquee[];
    dernier_ping: string | null;
  }[];
  sessions: SessionFil[];
  sessions_du_jour?: { cumul_min: number; plafond_min: number };
  nuits?: { nuit: string; dette_min: number }[];
  dette_cumulee_min?: number;
}

export interface TachesFil {
  journee?: string;
  taches: { id: string; nom: string; priorite: Priorite; eligible_le: string; eligible?: boolean }[];
}

export interface PrixFil {
  admissible: boolean;
  motif_refus: string | null;
  friction: 'aucune' | 'raison_phrase';
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
    appareils: s.appareils.map(
      (a): StatutAppareil => ({
        appareil: a.nom,
        type: a.type,
        mode: a.mode,
        raison: a.raison,
        sessions: a.sessions,
        vu_le: a.dernier_ping,
        ...(a.actions ? { actions: a.actions } : {}),
        ...(a.apps_bloquees ? { apps_bloquees: a.apps_bloquees } : {}),
      }),
    ),
    sessions: s.sessions.filter((x) => !x.fermee_le).map(sessionDepuisFil),
    ...(s.sessions_du_jour ? { sessions_du_jour: s.sessions_du_jour } : {}),
    ...(s.nuits ? { nuits: s.nuits } : {}),
    ...(s.dette_cumulee_min !== undefined ? { dette_cumulee_min: s.dette_cumulee_min } : {}),
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
    case 'ajoute': {
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
