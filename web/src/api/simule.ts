// API simulée en mémoire (VITE_API_SIMULEE=1), pour développer et tester sans serveur.
// Horaires fictifs repris de config/exemple.yaml. Le fuseau est celui du navigateur, pour que la
// journée simulée suive celle de la personne qui développe. Ce n'est pas le moteur : seules les
// règles visibles par l'interface (§3.4 exceptions, §4.5 sessions) sont reproduites, simplifiées.
import type { DateLocale, HeureLocale } from '../../../core/src/types';
import { PHRASE_NUIT, RAISON_MIN, longueurRaison } from '@/lib/decisionNuit';
import { ajouterJours, dateLocale, formaterDuree, heureLocale, instantLocal, jourDeSemaine, versInstant } from '@/lib/temps';
import type {
  ApiFocus,
  AppBloquee,
  CorpsException,
  DemandeException,
  Exception,
  Journee,
  PrixException,
  ReponseStatut,
  ReponseTaches,
  SessionOuverte,
  StatutAppareil,
  TacheSession,
  TypeAppareil,
} from './contrat';
import { ErreurFocus } from './erreur';

const MINUTE = 60_000;
const CIBLE_MIN = 8 * 60;
const MINIMUM_MIN = 7 * 60;
const PLANCHER_NUIT_MIN = 6 * 60;
const REVEIL_LIBRE = '07:00';
const PRIX_DU_REPORT_MIN = 20;
const ATTENTES_S = [0, 3, 5, 10, 15, 20];
const EXPIRATION_QUESTION_S = 60;
const DELAI_NOUVELLE_TACHE_MIN = 15;
const PLAFOND_SESSIONS_MIN = 180;
/** Dettes fictives des sept dernières nuits, en minutes (négatif = avance). */
const DETTES_FICTIVES = [35, -10, 50, 0, 75, 20, -25];
// La vraie API pose la question après 25 min (PC) ou 10 min (iPhone) ; 30 s suffisent pour essayer.
const INTERVALLE_QUESTION_SIMULE_S = 30;

const CATALOGUE: Record<string, { nom: string; domaines: string[]; iphone?: string }> = {
  youtube: { nom: 'YouTube', domaines: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'], iphone: 'com.google.ios.youtube' },
  x: { nom: 'X', domaines: ['x.com', 'twitter.com', 'www.x.com'], iphone: 'com.atebits.Tweetie2' },
  chatgpt: { nom: 'ChatGPT', domaines: ['chatgpt.com', 'chat.openai.com'], iphone: 'com.openai.chat' },
  gemini: { nom: 'Gemini', domaines: ['gemini.google.com'], iphone: 'com.google.gemini' },
  claude_ai: { nom: 'Claude', domaines: ['claude.ai'], iphone: 'com.anthropic.claude' },
  gmail: { nom: 'Gmail', domaines: ['mail.google.com', 'gmail.com'], iphone: 'com.google.Gmail' },
  safari: { nom: 'Safari', domaines: [], iphone: 'com.apple.mobilesafari' },
};
const BLOQUEES_WORK = ['chatgpt', 'gemini', 'claude_ai', 'youtube', 'x', 'safari'];

interface EngagementSimule {
  heure: HeureLocale;
  preparationMin: number;
}
const ENGAGEMENTS: Record<string, EngagementSimule> = {
  sport: { heure: '06:00', preparationMin: 30 },
  travail: { heure: '06:30', preparationMin: 0 },
};
/** Index = jour de semaine (0 = dimanche). */
const ENGAGEMENTS_PAR_JOUR: string[][] = [[], ['sport', 'travail'], ['travail'], ['sport', 'travail'], ['travail'], ['sport', 'travail'], []];
/** null = « $coucher - 2h ». */
const OUVERTURE_PAR_JOUR: (HeureLocale | null)[] = ['14:00', null, null, null, null, '18:00', '14:00'];

const APPAREILS: { appareil: string; type: TypeAppareil }[] = [
  { appareil: 'pc_linux', type: 'pc_linux' },
  { appareil: 'pc_windows', type: 'pc_windows' },
  { appareil: 'iphone', type: 'iphone' },
];

interface TacheSimulee {
  id: string;
  nom: string;
  priorite: TacheSession['priorite'];
  creeeLe: number;
}

interface SessionInterne {
  session: SessionOuverte;
  prochaineQuestion: number | null;
}

export interface OptionsSimulation {
  maintenant?: () => number;
  fuseau?: string;
  /** Délai artificiel de chaque réponse, pour voir les états de chargement. */
  latenceMs?: number;
}

const enMinutes = (h: HeureLocale) => {
  const [a, b] = h.split(':').map(Number);
  return (a ?? 0) * 60 + (b ?? 0);
};
const versHeure = (minutes: number) => {
  const m = Math.max(0, minutes);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
// Copie par JSON, comme un passage par le réseau ; `undefined` (réponse sans corps) reste tel quel.
const copie = <T,>(valeur: T): T => (valeur === undefined ? valeur : (JSON.parse(JSON.stringify(valeur)) as T));
const HEURE_VALIDE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_VALIDE = /^\d{4}-\d{2}-\d{2}$/;

function fuseauDuNavigateur(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function nuitDe(demande: DemandeException): DateLocale {
  return demande.type === 'coucher' || demande.type === 'avancer_coucher' ? demande.nuit : ajouterJours(demande.date, -1);
}

export function creerApiSimulee(options: OptionsSimulation = {}): ApiFocus {
  const maintenant = options.maintenant ?? (() => Date.now());
  const fuseau = options.fuseau ?? fuseauDuNavigateur();
  const latenceMs = options.latenceMs ?? 0;
  const debut = maintenant();

  const taches: TacheSimulee[] = [
    { id: 't1', nom: 'Exercices de probabilités', priorite: 'p1', creeeLe: debut - 3 * 60 * MINUTE },
    { id: 't2', nom: 'Fiche de révision : suites numériques', priorite: 'p2', creeeLe: debut - 50 * MINUTE },
    { id: 't3', nom: 'Relire le chapitre 4', priorite: 'p3', creeeLe: debut - 5 * MINUTE },
    { id: 't4', nom: "Préparer l'exposé d'histoire", priorite: 'p4', creeeLe: debut - 24 * 60 * MINUTE },
  ];
  const exceptions: Exception[] = [];
  let sessions: SessionInterne[] = [];
  const continues = new Map<string, number>();
  let compteur = 0;

  // ─── Journée ────────────────────────────────────────────────────────────────

  /** Engagement → réveil en minutes depuis minuit (null = sans heure). */
  function engagementsDuJour(date: DateLocale, liste: Exception[]): Map<string, number | null> {
    const resultat = new Map<string, number | null>();
    for (const nom of ENGAGEMENTS_PAR_JOUR[jourDeSemaine(date)] ?? []) {
      const e = ENGAGEMENTS[nom];
      if (e) resultat.set(nom, enMinutes(e.heure) - e.preparationMin);
    }
    for (const { demande: d } of liste) {
      if (d.type === 'ajoute' && d.date === date) {
        const reveil = d.reveil ?? (d.heure ? versHeure(enMinutes(d.heure) - (d.preparationMin ?? 0)) : null);
        resultat.set(d.libelle, reveil ? enMinutes(reveil) : null);
      } else if (d.type === 'retire' && d.date === date) {
        resultat.delete(d.engagement);
      } else if (d.type === 'decale' && d.date === date && resultat.has(d.engagement)) {
        resultat.set(d.engagement, enMinutes(d.heure) - (ENGAGEMENTS[d.engagement]?.preparationMin ?? 0));
      }
    }
    return resultat;
  }

  function lever(date: DateLocale, liste: Exception[]): number {
    const reveils = [...engagementsDuJour(date, liste).values()].filter((r): r is number => r !== null);
    return instantLocal(date, versHeure(Math.min(enMinutes(REVEIL_LIBRE), ...reveils)), fuseau);
  }

  function coucherApplique(nuit: DateLocale, liste: Exception[]): number {
    let coucher = lever(ajouterJours(nuit, 1), liste) - CIBLE_MIN * MINUTE;
    for (const { demande: d } of liste) {
      if (d.type === 'coucher' && d.nuit === nuit) {
        coucher = instantLocal(d.heure >= '12:00' ? nuit : ajouterJours(nuit, 1), d.heure, fuseau);
      } else if (d.type === 'avancer_coucher' && d.nuit === nuit) {
        coucher = Date.parse(d.a);
      }
    }
    return coucher;
  }

  function ouverture(nuit: DateLocale, liste: Exception[]): number {
    const coucher = coucherApplique(nuit, liste);
    const parametre = OUVERTURE_PAR_JOUR[jourDeSemaine(nuit)];
    const base = parametre ? instantLocal(nuit, parametre, fuseau) : coucher - 120 * MINUTE;
    return Math.min(base + PRIX_DU_REPORT_MIN * MINUTE, coucher);
  }

  function decisionPrise(nuit: DateLocale): boolean {
    return exceptions.some((e) => e.pendantNuit && nuitDe(e.demande) === nuit);
  }

  function dateCourante(t: number): DateLocale {
    const jour = dateLocale(t, fuseau);
    return t < lever(jour, exceptions) ? ajouterJours(jour, -1) : jour;
  }

  function journee(t: number): Journee {
    const date = dateCourante(t);
    const leverSuivant = lever(ajouterJours(date, 1), exceptions);
    const coucher = coucherApplique(date, exceptions);
    return {
      date,
      routine: 'semaine',
      fuseau,
      engagements: [...engagementsDuJour(date, exceptions).keys()],
      lever: versInstant(lever(date, exceptions)),
      leverSuivant: versInstant(leverSuivant),
      coucherPrevu: versInstant(leverSuivant - CIBLE_MIN * MINUTE),
      coucherApplique: versInstant(coucher),
      ouverture: versInstant(ouverture(date, exceptions)),
      prixDuReportMin: PRIX_DU_REPORT_MIN,
      detteNuitMin: Math.round(CIBLE_MIN - (leverSuivant - coucher) / MINUTE),
      decisionDeNuitPrise: decisionPrise(date),
    };
  }

  // ─── Appareils ──────────────────────────────────────────────────────────────

  function appsPour(type: TypeAppareil, ids: string[]): AppBloquee[] {
    return ids.flatMap((id) => {
      const app = CATALOGUE[id];
      if (!app) return [];
      if (type === 'iphone') return app.iphone ? [{ id, nom: app.nom, domaines: [] }] : [];
      return app.domaines.length > 0 ? [{ id, nom: app.nom, domaines: [...app.domaines] }] : [];
    });
  }

  function vuLe(appareil: string, t: number): string | null {
    // pc_linux interroge l'API chaque minute ; l'iPhone moins souvent ; pc_windows est éteint.
    if (appareil === 'pc_linux') return versInstant(t - ((t - debut + 40_000) % MINUTE));
    if (appareil === 'iphone') return versInstant(debut - 4 * MINUTE);
    return versInstant(debut - 3 * 24 * 60 * MINUTE);
  }

  function etatAppareil(appareil: string, type: TypeAppareil, t: number): StatutAppareil {
    const date = dateCourante(t);
    const coucher = coucherApplique(date, exceptions);
    if (t >= coucher) {
      const leverSuivant = lever(ajouterJours(date, 1), exceptions);
      return {
        appareil,
        type,
        mode: 'NIGHT_LOCK',
        raison: `NIGHT_LOCK — nuit jusqu'au lever de ${heureLocale(leverSuivant, fuseau)}`,
        sessions: 'interdites',
        jusqua: versInstant(leverSuivant),
        vu_le: vuLe(appareil, t),
        apps_bloquees: appsPour(type, Object.keys(CATALOGUE)),
      };
    }
    const prioritaires = taches.filter((x) => x.priorite === 'p1' || x.priorite === 'p2').length;
    return {
      appareil,
      type,
      mode: 'WORK',
      raison: `WORK — tâches prioritaires restantes : ${prioritaires}`,
      sessions: 'autorisees',
      jusqua: versInstant(coucher),
      vu_le: vuLe(appareil, t),
      apps_bloquees: appsPour(type, BLOQUEES_WORK),
    };
  }

  function trouverAppareil(appareil: string, t: number): StatutAppareil {
    const a = APPAREILS.find((x) => x.appareil === appareil);
    if (!a) throw new ErreurFocus('appareil_inconnu', `Appareil inconnu : ${appareil}.`, 404);
    return etatAppareil(a.appareil, a.type, t);
  }

  // ─── Sessions ───────────────────────────────────────────────────────────────

  const cleContinue = (tacheId: string, t: number) => `${dateCourante(t)}|${tacheId}`;

  function poserQuestion(interne: SessionInterne, a: number) {
    const n = continues.get(cleContinue(interne.session.tache?.id ?? '', a)) ?? 0;
    const attente = ATTENTES_S[Math.min(n, ATTENTES_S.length - 1)] ?? 0;
    compteur += 1;
    interne.session.question = {
      id: `q_${compteur}`,
      posee_a: versInstant(a),
      attente_s: attente,
      expire_a: versInstant(a + (EXPIRATION_QUESTION_S + attente) * 1000),
    };
    interne.prochaineQuestion = null;
  }

  /** Fait passer le temps : questions expirées (session fermée), questions à poser. */
  function avancer(t: number) {
    sessions = sessions.filter((s) => !s.session.question || t < Date.parse(s.session.question.expire_a));
    for (const s of sessions) {
      if (!s.session.question && s.prochaineQuestion !== null && t >= s.prochaineQuestion) {
        poserQuestion(s, s.prochaineQuestion);
      }
    }
    sessions = sessions.filter((s) => !s.session.question || t < Date.parse(s.session.question.expire_a));
  }

  function trouverSession(id: string): SessionInterne {
    const s = sessions.find((x) => x.session.id === id);
    if (!s) throw new ErreurFocus('session_inconnue', 'Session introuvable ou déjà fermée.', 404);
    return s;
  }

  function domainesDe(type: TypeAppareil, apps: string[]): string[] {
    return [...new Set(appsPour(type, apps).flatMap((a) => a.domaines))].sort();
  }

  // Session de démonstration : une question en attente, avec l'attente du 3e « continue ».
  if (etatAppareil('pc_linux', 'pc_linux', debut).sessions === 'autorisees') {
    continues.set(cleContinue('t1', debut), 2);
    const demo: SessionInterne = {
      session: {
        id: 's_demo',
        appareil: 'pc_linux',
        tache: { id: 't1', nom: 'Exercices de probabilités' },
        apps: ['chatgpt'],
        domaines: domainesDe('pc_linux', ['chatgpt']),
        ouverte_le: versInstant(debut - 26 * MINUTE),
        question: null,
      },
      prochaineQuestion: null,
    };
    poserQuestion(demo, debut - 1000);
    sessions.push(demo);
  }

  // ─── Exceptions ─────────────────────────────────────────────────────────────

  function verifierDemande(d: DemandeException) {
    const dateOk = d.type === 'coucher' || d.type === 'avancer_coucher' ? DATE_VALIDE.test(d.nuit) : DATE_VALIDE.test(d.date);
    const heures = [
      d.type === 'ajoute' ? d.heure : undefined,
      d.type === 'ajoute' ? d.reveil : undefined,
      d.type === 'decale' || d.type === 'coucher' ? d.heure : undefined,
    ].filter((h): h is string => h !== undefined);
    if (!dateOk || heures.some((h) => !HEURE_VALIDE.test(h))) {
      throw new ErreurFocus('demande_invalide', 'Demande invalide : date ou heure mal formée.', 400);
    }
    if (d.type === 'ajoute' && (!d.libelle.trim() || (!d.heure && !d.reveil))) {
      throw new ErreurFocus('demande_invalide', 'Demande invalide : libellé et heure (ou réveil) requis.', 400);
    }
  }

  function calculerPrix(demande: DemandeException, t: number): PrixException {
    verifierDemande(demande);
    const nuit = nuitDe(demande);
    const apres = [...exceptions, { id: 'essai', demande, creeeLe: versInstant(t), pendantNuit: false }];
    const lendemain = ajouterJours(nuit, 1);
    const coucherAvant = coucherApplique(nuit, exceptions);
    const coucherApres = coucherApplique(nuit, apres);
    const leverAvant = lever(lendemain, exceptions);
    const leverApres = lever(lendemain, apres);
    const dette = (coucher: number, leverMs: number) => Math.round(CIBLE_MIN - (leverMs - coucher) / MINUTE);
    const base = {
      coucherAvant: versInstant(coucherAvant),
      coucherApres: versInstant(coucherApres),
      leverAvant: versInstant(leverAvant),
      leverApres: versInstant(leverApres),
      detteAvantMin: dette(coucherAvant, leverAvant),
      detteApresMin: dette(coucherApres, leverApres),
    };

    if ((demande.type === 'retire' || demande.type === 'decale') && !engagementsDuJour(demande.date, exceptions).has(demande.engagement)) {
      return { ...base, admissible: false, motifRefus: `Aucun engagement « ${demande.engagement} » le ${demande.date}.`, friction: 'aucune', resserre: false };
    }
    if (coucherApres <= coucherAvant && leverApres <= leverAvant) {
      return { ...base, admissible: true, friction: 'aucune', resserre: true };
    }

    const sommeil = (leverApres - coucherApres) / MINUTE;
    if (t < ouverture(nuit, exceptions)) {
      const admissible = sommeil >= MINIMUM_MIN;
      return {
        ...base,
        admissible,
        motifRefus: admissible ? undefined : `Sommeil prévu ${formaterDuree(sommeil)} : moins que le minimum de ${formaterDuree(MINIMUM_MIN)}.`,
        friction: 'aucune',
        resserre: false,
      };
    }
    if (t < leverAvant) {
      let motifRefus: string | undefined;
      if (decisionPrise(nuit)) motifRefus = 'Décision de nuit déjà prise cette nuit : une seule par nuit.';
      else if (sommeil < PLANCHER_NUIT_MIN) {
        motifRefus = `Sommeil prévu ${formaterDuree(sommeil)} : moins que le plancher de nuit de ${formaterDuree(PLANCHER_NUIT_MIN)}.`;
      }
      return { ...base, admissible: motifRefus === undefined, motifRefus, friction: 'raison_phrase', resserre: false };
    }
    return { ...base, admissible: false, motifRefus: 'Cette nuit est passée.', friction: 'aucune', resserre: false };
  }

  // ─── Points d'entrée ────────────────────────────────────────────────────────

  async function servir<T>(calcul: () => T): Promise<T> {
    if (latenceMs > 0) await new Promise((r) => setTimeout(r, latenceMs));
    return copie(calcul());
  }

  return {
    statut: () =>
      servir((): ReponseStatut => {
        const t = maintenant();
        avancer(t);
        const j = journee(t);
        const nuits = DETTES_FICTIVES.map((dette_min, i) => ({ nuit: ajouterJours(j.date, i - DETTES_FICTIVES.length), dette_min }));
        const cumulMin = sessions.reduce((total, s) => total + Math.max(0, Math.round((t - Date.parse(s.session.ouverte_le)) / MINUTE)), 0);
        return {
          heure_serveur: versInstant(t),
          config_version: 'simulee',
          journee: j,
          appareils: APPAREILS.map((a) => etatAppareil(a.appareil, a.type, t)),
          sessions: sessions.map((s) => ({
            ...s.session,
            prochaine_question_a: s.prochaineQuestion === null ? null : versInstant(s.prochaineQuestion),
          })),
          sessions_du_jour: { cumul_min: Math.min(cumulMin + 35, PLAFOND_SESSIONS_MIN), plafond_min: PLAFOND_SESSIONS_MIN },
          nuits,
          dette_cumulee_min: nuits.reduce((total, n) => total + n.dette_min, 0),
        };
      }),

    taches: () =>
      servir((): ReponseTaches => ({
        taches: taches.map((x) => ({
          id: x.id,
          nom: x.nom,
          priorite: x.priorite,
          eligible_le: versInstant(x.creeeLe + DELAI_NOUVELLE_TACHE_MIN * MINUTE),
        })),
      })),

    appsBloquees: (appareil) => servir(() => trouverAppareil(appareil.appareil, maintenant()).apps_bloquees ?? []),

    ouvrirSession: (corps) =>
      servir(() => {
        const t = maintenant();
        avancer(t);
        const appareil = trouverAppareil(corps.appareil, t);
        if (appareil.sessions === 'interdites') {
          throw new ErreurFocus('sessions_interdites', `Sessions interdites en ce moment (${appareil.mode}).`, 409);
        }
        const tache = taches.find((x) => x.id === corps.tache_id);
        if (!tache) throw new ErreurFocus('tache_inconnue', 'Tâche introuvable ou déjà terminée.', 404);
        const eligibleLe = tache.creeeLe + DELAI_NOUVELLE_TACHE_MIN * MINUTE;
        if (t < eligibleLe) {
          throw new ErreurFocus(
            'tache_trop_recente',
            `Tâche créée il y a moins de ${DELAI_NOUVELLE_TACHE_MIN} min : éligible à ${heureLocale(eligibleLe, fuseau)}.`,
            409,
          );
        }
        const permises = new Set((appareil.apps_bloquees ?? []).map((a) => a.id));
        if (corps.apps.length === 0 || corps.apps.some((a) => !permises.has(a))) {
          throw new ErreurFocus('apps_invalides', 'Choisissez au moins une app bloquée sur cet appareil.', 400);
        }
        compteur += 1;
        sessions.push({
          session: {
            id: `s_${compteur}`,
            appareil: appareil.appareil,
            tache: { id: tache.id, nom: tache.nom },
            apps: [...corps.apps],
            domaines: domainesDe(appareil.type, corps.apps),
            ouverte_le: versInstant(t),
            question: null,
          },
          prochaineQuestion: t + INTERVALLE_QUESTION_SIMULE_S * 1000,
        });
      }),

    ajouterApp: (sessionId, app) =>
      servir(() => {
        const t = maintenant();
        avancer(t);
        const s = trouverSession(sessionId);
        const appareil = trouverAppareil(s.session.appareil, t);
        if (!(appareil.apps_bloquees ?? []).some((a) => a.id === app)) {
          throw new ErreurFocus('app_invalide', "Cette app n'est pas bloquée sur cet appareil.", 400);
        }
        if (!s.session.apps.includes(app)) s.session.apps.push(app);
        s.session.domaines = domainesDe(appareil.type, s.session.apps);
      }),

    repondre: (sessionId, corps) =>
      servir(() => {
        const t = maintenant();
        avancer(t);
        const s = trouverSession(sessionId);
        const q = s.session.question;
        if (!q || q.id !== corps.question_id) {
          throw new ErreurFocus('question_inconnue', "Cette question n'est plus en attente.", 409);
        }
        if (corps.reponse === 'arrete') {
          sessions = sessions.filter((x) => x !== s);
          return;
        }
        const continuerDes = Date.parse(q.posee_a) + q.attente_s * 1000;
        if (t < continuerDes) {
          throw new ErreurFocus('trop_tot', `Trop tôt : attendez encore ${Math.ceil((continuerDes - t) / 1000)} s.`, 409);
        }
        const cle = cleContinue(s.session.tache?.id ?? '', t);
        continues.set(cle, (continues.get(cle) ?? 0) + 1);
        s.session.question = null;
        s.prochaineQuestion = t + INTERVALLE_QUESTION_SIMULE_S * 1000;
      }),

    fermerSession: (sessionId) =>
      servir(() => {
        avancer(maintenant());
        const s = trouverSession(sessionId);
        sessions = sessions.filter((x) => x !== s);
      }),

    prixException: (corps: CorpsException) => servir(() => calculerPrix(corps.demande, maintenant())),

    enregistrerException: (corps) =>
      servir(() => {
        const t = maintenant();
        const prix = calculerPrix(corps.demande, t);
        if (!prix.admissible) throw new ErreurFocus('exception_refusee', prix.motifRefus ?? 'Exception refusée.', 409);
        if (prix.friction === 'raison_phrase') {
          const raison = corps.friction?.raison ?? '';
          if (longueurRaison(raison) < RAISON_MIN || corps.friction?.phrase !== PHRASE_NUIT) {
            throw new ErreurFocus(
              'friction_requise',
              `Décision de nuit : une raison d'au moins ${RAISON_MIN} caractères et la phrase exacte « ${PHRASE_NUIT} » sont exigées.`,
              400,
            );
          }
        }
        compteur += 1;
        exceptions.push({
          id: `e_${compteur}`,
          demande: copie(corps.demande),
          creeeLe: versInstant(t),
          raison: corps.friction?.raison,
          pendantNuit: prix.friction === 'raison_phrase',
        });
      }),
  };
}
