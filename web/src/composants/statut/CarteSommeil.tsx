import { ArrowDown, ArrowUp, BedDouble, CalendarX, CircleCheck, Equal, Moon, TrendingDown, Undo2, Watch } from 'lucide-react';
import { Bar, BarChart, Cell, ReferenceLine, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import type { BilanSemaine, DateLocale, DetteSemaine, NuitPassee, PhasesSommeil, ReponseStatut } from '@/api/contrat';
import { ajouterJours, formaterDateCourte, formaterDuree, formaterHeure } from '@/lib/temps';
import { cn } from '@/lib/utils';
import { semaineAffichee } from '../../../../core/src/dette';

const OBJECTIF_PAR_DEFAUT_MIN = 8 * 60;
/** En deçà, l'écart n'est pas dit : « objectif atteint ». */
const TOLERANCE_MIN = 5;

const config = { heures: { label: 'Heures dormies', color: 'var(--sommeil-nuit)' } } satisfies ChartConfig;

const dormi = (n: NuitPassee) => (typeof n.endormi_min === 'number' ? n.endormi_min : null);

/** « 29 min de moins que l'objectif », « 15 min de plus que l'objectif », « objectif atteint ». */
export function ecartEnMots(ecartMin: number, suffixe = " que l'objectif"): { texte: string; classe: string } {
  if (Math.abs(ecartMin) <= TOLERANCE_MIN) return { texte: 'objectif atteint', classe: 'text-succes' };
  return ecartMin < 0
    ? { texte: `${formaterDuree(ecartMin)} de moins${suffixe}`, classe: 'text-avertissement' }
    : { texte: `${formaterDuree(ecartMin)} de plus${suffixe}`, classe: 'text-succes' };
}

const PHASES: { cle: keyof PhasesSommeil; nom: string; couleur: string }[] = [
  { cle: 'legere', nom: 'Léger', couleur: 'var(--phase-legere)' },
  { cle: 'rem', nom: 'REM', couleur: 'var(--phase-rem)' },
  { cle: 'profonde', nom: 'Profond', couleur: 'var(--phase-profond)' },
  { cle: 'eveil', nom: 'Éveil', couleur: 'var(--phase-eveil)' },
];

/** Phases d'une nuit : léger, REM, profond côte à côte, l'éveil à part ; légende avec les durées. */
export function BarrePhases({ phases }: { phases: PhasesSommeil }) {
  const total = PHASES.reduce((t, p) => t + phases[p.cle], 0);
  if (total <= 0) return null;
  const endormi = total - phases.eveil;
  const segment = (p: (typeof PHASES)[number]) =>
    phases[p.cle] > 0 ? (
      <div
        key={p.cle}
        className="h-full rounded-[3px]"
        style={{ flex: `${phases[p.cle]} 1 0`, background: p.couleur }}
        title={`${p.nom} : ${formaterDuree(phases[p.cle])}`}
      />
    ) : null;
  return (
    <div className="grid gap-2">
      <div className="flex h-3 w-full" role="img" aria-hidden>
        <div className="flex h-full gap-0.5" style={{ flex: `${endormi} 1 0` }}>
          {PHASES.slice(0, 3).map(segment)}
        </div>
        {phases.eveil > 0 ? (
          <div className="ml-1.5 h-full rounded-[3px]" style={{ flex: `${phases.eveil} 1 0`, background: 'var(--phase-eveil)' }} title={`Éveil : ${formaterDuree(phases.eveil)}`} />
        ) : null}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4" aria-label="Phases de sommeil">
        {PHASES.map((p) => (
          <li key={p.cle} className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: p.couleur }} />
            <span className="text-muted-foreground">{p.nom}</span>
            <span className="text-foreground ml-auto font-medium tabular-nums sm:ml-0">{formaterDuree(phases[p.cle])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Participe accordé à la durée : « 29 min manquées », « 1 h 05 rattrapée », « 2 h rattrapées ». */
export function accorde(minutes: number, participe: string): string {
  const m = Math.round(Math.abs(minutes));
  const pluriel = m < 60 ? m > 1 : Math.floor(m / 60) > 1;
  return pluriel ? `${participe}s` : participe;
}

/** « rattrapée » ou « rattrapées », accordé à la durée (« 29 min rattrapées », « 1 h 05 rattrapée »). */
export const rattrapee = (minutes: number) => accorde(minutes, 'rattrapée');

/**
 * Écart d'une nuit en mots, avec la sieste de la journée qui suit : « 29 min de moins que
 * l'objectif, dont 20 min rattrapées en sieste », ou « …, rattrapées en sieste » si la sieste
 * couvre tout l'écart. Inchangé sans sieste ou sans manque.
 */
export function ecartNuitEnMots(ecartMin: number, siesteMin: number): { texte: string; classe: string } {
  const base = ecartEnMots(ecartMin);
  if (siesteMin <= 0 || ecartMin >= -TOLERANCE_MIN) return base;
  const manque = -ecartMin;
  if (siesteMin >= manque) return { ...base, texte: `${base.texte}, ${rattrapee(manque)} en sieste` };
  return { ...base, texte: `${base.texte}, dont ${formaterDuree(siesteMin)} ${rattrapee(siesteMin)} en sieste` };
}

/** Minutes de sieste de la journée D (champ de l'API, rangé sur la nuit D). */
const siestesDe = (n: NuitPassee) => n.siestes_min ?? 0;

/** Une sieste rattrape la nuit d'avant (Frédéric, 01/11) : sur la nuit D, la sieste de la journée D + 1. */
function siesteApresNuit(nuit: string, nuits: NuitPassee[], aujourdhui: string, siestesDuJour: number): number {
  const lendemain = ajouterJours(nuit, 1);
  if (lendemain === aujourdhui) return siestesDuJour;
  const n = nuits.find((x) => x.nuit === lendemain);
  return n ? siestesDe(n) : 0;
}

/** « 7 h 12 de nuit + 1 h 05 de sieste », « 7 h 12 dormies », « pas de mesure ». */
export function detailNuit(minutes: number | null, siestes: number): string {
  if (siestes <= 0) return minutes === null ? 'pas de mesure' : `${formaterDuree(minutes)} dormies`;
  const nuit = minutes === null ? 'nuit non mesurée' : `${formaterDuree(minutes)} de nuit`;
  return `${nuit} + ${formaterDuree(siestes)} de sieste`;
}

/** « dim. 1er », « lun. 2 » : jour de la semaine et quantième d'une date locale. */
function jourEtQuantieme(date: DateLocale): string {
  const [a, m, j] = date.split('-').map(Number);
  const jour = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short' }).format(new Date(Date.UTC(a ?? 0, (m ?? 1) - 1, j ?? 1)));
  return `${jour} ${j === 1 ? '1er' : j}`;
}

/** « nuit du dim. 1er au lun. 2 nov. », « nuit du sam. 31 oct. au dim. 1er nov. » : la nuit D, du soir D au matin D + 1. */
export function nuitEnMots(nuit: DateLocale): string {
  const matin = ajouterJours(nuit, 1);
  const mois = (d: DateLocale) => jourEtMois(d).replace(/^\d+\s*/, '');
  const soir = nuit.slice(5, 7) === matin.slice(5, 7) ? jourEtQuantieme(nuit) : `${jourEtQuantieme(nuit)} ${mois(nuit)}`;
  return `nuit du ${soir} au ${jourEtQuantieme(matin)} ${mois(matin)}`;
}

/** Une colonne du graphique : la nuit D, nommée par le matin où elle se termine (« lun. » : de dimanche à lundi). */
export interface ColonneNuit {
  nuit: DateLocale;
  /** « lun. » … « dim. ». */
  jour: string;
  /** Nuit pas encore finie (ce soir ou plus tard) : colonne vide en pointillés. */
  avenir: boolean;
  /** Minutes dormies mesurées ; null sans mesure (ou à venir). */
  minutes: number | null;
  /** Sieste de la journée D + 1, rangée sur la nuit D. */
  siesteMin: number;
}

/**
 * Les 7 colonnes de la semaine du lundi `debut` (lun. → dim.), même règle que la dette hebdomadaire :
 * la colonne « lun. » est la nuit de dimanche à lundi, « dim. » celle de samedi à dimanche. `nuits` :
 * toutes les nuits connues (celles de la semaine et les 7 dernières, pour la sieste du lendemain).
 * Une nuit qui commence ce soir (`aujourdhui`) ou plus tard est à venir.
 */
export function colonnesDeLaSemaine(debut: DateLocale, nuits: NuitPassee[], aujourdhui: DateLocale, siestesDuJour: number): ColonneNuit[] {
  return Array.from({ length: 7 }, (_, i) => {
    const nuit = ajouterJours(debut, i - 1);
    const avenir = nuit >= aujourdhui;
    const n = nuits.find((x) => x.nuit === nuit);
    return {
      nuit,
      jour: formaterDateCourte(ajouterJours(nuit, 1)).split(' ')[0] ?? nuit,
      avenir,
      minutes: avenir || !n ? null : dormi(n),
      siesteMin: avenir ? 0 : siesteApresNuit(nuit, nuits, aujourdhui, siestesDuJour),
    };
  });
}

/** Étiquette d'une colonne, atténuée pour une nuit à venir. */
function EtiquetteJour({ x, y, payload, avenirs }: { x?: number; y?: number; payload?: { value: string; index: number }; avenirs: boolean[] }) {
  const avenir = payload ? avenirs[payload.index] : false;
  return (
    <text x={x} y={y} dy={10} textAnchor="middle" fontSize={11} className="fill-muted-foreground" opacity={avenir ? 0.45 : 1}>
      {payload?.value}
    </text>
  );
}

function GraphiqueNuits({ colonnes, objectif }: { colonnes: ColonneNuit[]; objectif: number }) {
  const donnees = colonnes.map((c) => ({
    ...c,
    date: nuitEnMots(c.nuit),
    // 0 plutôt que null : la barre est invisible mais l'infobulle dit « pas de mesure ».
    heures: c.minutes === null ? 0 : c.minutes / 60,
    sieste: c.siesteMin / 60,
    // Nuit à venir : un contour en pointillés à la hauteur de l'objectif.
    aVenir: c.avenir ? objectif / 60 : 0,
  }));
  const max = Math.max(objectif / 60, ...donnees.map((d) => d.heures + d.sieste)) * 1.08;
  const sansMesure = donnees.some((d) => !d.avenir && d.minutes === null && d.siesteMin === 0);
  const avecSieste = donnees.some((d) => d.siesteMin > 0);
  const detail = (d: (typeof donnees)[number]) => (d.avenir ? 'à venir' : detailNuit(d.minutes, d.siesteMin));
  return (
    <div className="grid gap-1.5">
      <ChartContainer config={config} className="aspect-auto h-32 w-full [&_.recharts-wrapper]:outline-none [&_g]:outline-none">
        <BarChart data={donnees} margin={{ top: 6, right: 4, left: 4, bottom: 0 }} accessibilityLayer={false}>
          <XAxis dataKey="jour" tickLine={false} axisLine={false} tickMargin={6} interval={0} tick={<EtiquetteJour avenirs={donnees.map((d) => d.avenir)} />} />
          <YAxis hide domain={[0, max]} />
          <ChartTooltip
            cursor={false}
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as (typeof donnees)[number] | undefined;
              if (!active || !d) return null;
              return (
                <div className="border-border/50 bg-background grid gap-0.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
                  <span className="font-medium">{d.date}</span>
                  <span className="text-muted-foreground">{detail(d)}</span>
                </div>
              );
            }}
          />
          <Bar dataKey="heures" stackId="sommeil" maxBarSize={28} isAnimationActive={false}>
            {donnees.map((d) => (
              <Cell key={d.nuit} fill="var(--sommeil-nuit)" radius={(d.siesteMin > 0 ? [0, 0, 4, 4] : 4) as never} />
            ))}
          </Bar>
          <Bar dataKey="sieste" stackId="sommeil" maxBarSize={28} isAnimationActive={false}>
            {donnees.map((d) => (
              <Cell
                key={d.nuit}
                fill="var(--sommeil-sieste)"
                stroke="var(--card)"
                strokeWidth={d.minutes === null ? 0 : 2}
                radius={(d.minutes === null ? 4 : [4, 4, 0, 0]) as never}
              />
            ))}
          </Bar>
          <Bar dataKey="aVenir" stackId="sommeil" maxBarSize={28} isAnimationActive={false}>
            {donnees.map((d) => (
              <Cell key={d.nuit} fill="transparent" stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeWidth={1.25} strokeDasharray="3 3" radius={4 as never} />
            ))}
          </Bar>
          <ReferenceLine y={objectif / 60} stroke="var(--muted-foreground)" strokeDasharray="4 3" strokeWidth={1.5} ifOverflow="extendDomain" />
        </BarChart>
      </ChartContainer>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px]" style={{ background: 'var(--sommeil-nuit)' }} /> heures dormies
        </span>
        {avecSieste ? (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: 'var(--sommeil-sieste)' }} /> sieste
          </span>
        ) : null}
        <span className="flex items-center gap-1.5">
          <span className="border-muted-foreground w-3 border-t-[1.5px] border-dashed" /> objectif
        </span>
        {sansMesure ? <span>pas de barre : pas de mesure</span> : null}
      </div>
      <ul className="sr-only">
        {donnees.map((d) => (
          <li key={d.nuit}>
            {d.date} : {detail(d)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Une case de l'opération : icône et durée, le mot dessous. */
function Case({ icone: Icone, valeur, mot, classe, titre }: { icone: typeof Moon; valeur?: string; mot: string; classe?: string; titre?: string }) {
  return (
    <span className={cn('bg-muted/60 grid min-w-0 justify-items-center gap-0.5 rounded-md px-1.5 py-1.5 text-center', classe)} title={titre}>
      <span className="flex items-center gap-1 text-sm font-semibold whitespace-nowrap tabular-nums">
        <Icone className="size-3.5 shrink-0" />
        {valeur}
      </span>
      <span className="text-xs">{mot}</span>
    </span>
  );
}

/** Ce que le bloc « semaine » affiche : la semaine en cours, ou la dernière semaine close. */
interface SemaineAffichee {
  /** Lundi de la semaine : le graphique des nuits montre la même. */
  debut: DateLocale;
  /** « Cette semaine » ou « Semaine du 26 oct. · close ». */
  titre: string;
  close: boolean;
  dette_min: number;
  rattrape_min: number;
  /** Reste à rattraper (semaine en cours) ou non rattrapé (semaine close). */
  reste_min: number;
  nuits_mesurees: number;
  nuits_total: number;
}

/** « 26 oct. » : jour et mois d'une date locale. */
function jourEtMois(date: string): string {
  const [a, m, j] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(Date.UTC(a ?? 0, (m ?? 1) - 1, j ?? 1)));
}

/**
 * Semaine en cours, ou, tant qu'elle n'a aucune nuit mesurée (le dimanche : une nuit appartient à la
 * semaine du matin où elle se termine), la semaine qui vient de se clore ; null s'il n'y a rien à
 * montrer. `precedente` : la semaine à laquelle la comparer.
 */
export function semaineAAfficher(
  semaine: DetteSemaine | undefined,
  bilans: BilanSemaine[] | undefined,
): { semaine: SemaineAffichee; precedente: BilanSemaine | undefined } | null {
  const debut = semaineAffichee(semaine, bilans);
  if (debut === null) return null;
  if (semaine && debut === semaine.debut) {
    return { semaine: { ...semaine, titre: 'Cette semaine', close: false }, precedente: bilans?.[0] };
  }
  const close = bilans![0]!;
  return {
    semaine: { ...close, reste_min: close.non_rattrape_min, titre: `Semaine du ${jourEtMois(close.debut)} · close`, close: true },
    precedente: bilans?.[1],
  };
}

/**
 * Semaine (CDC §4, dette hebdomadaire) : « 3 h 10 manquées » moins « 1 h 05 rattrapées » (nuits
 * plus longues et siestes) = « 2 h 05 à rattraper » (semaine en cours) ou « 2 h 05 non
 * rattrapées » (semaine close) ; « tout rattrapé » ou « objectif atteint » sinon.
 */
function BlocSemaine({ semaine }: { semaine: SemaineAffichee }) {
  const { dette_min: dette, rattrape_min: rattrape, reste_min: reste } = semaine;
  const aRattraper = reste > TOLERANCE_MIN;
  const avecDette = dette > TOLERANCE_MIN;
  const motReste = semaine.close ? `non ${accorde(reste, 'rattrapée')}` : 'à rattraper';
  const phrase = !avecDette
    ? `${semaine.titre} : objectif atteint.`
    : `${semaine.titre} : ${formaterDuree(dette)} ${accorde(dette, 'manquée')}${rattrape > 0 ? `, ${formaterDuree(rattrape)} ${rattrapee(rattrape)} (nuits plus longues et siestes)` : ''}, ${aRattraper ? `${formaterDuree(reste)} ${motReste}` : 'tout rattrapé'}.`;
  const resultat = aRattraper ? (
    <Case icone={TrendingDown} valeur={formaterDuree(reste)} mot={motReste} classe="text-avertissement" />
  ) : (
    <Case icone={CircleCheck} mot={avecDette ? 'tout rattrapé' : 'objectif atteint'} classe="text-succes" />
  );
  return (
    <section className="grid gap-2" aria-label={semaine.titre}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="text-muted-foreground">{semaine.titre}</span>
        {semaine.nuits_mesurees < semaine.nuits_total ? (
          <span className="text-muted-foreground text-xs">
            {semaine.nuits_mesurees}/{semaine.nuits_total} mesurées
          </span>
        ) : null}
      </div>
      <p className="sr-only">{phrase}</p>
      {avecDette && rattrape > 0 ? (
        <div className="text-muted-foreground grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5 text-xs sm:max-w-md" aria-hidden>
          <Case icone={Moon} valeur={formaterDuree(dette)} mot={accorde(dette, 'manquée')} classe="text-foreground [&>span:last-child]:text-muted-foreground" titre="Manque des nuits de la semaine" />
          <span>moins</span>
          <Case
            icone={Undo2}
            valeur={formaterDuree(rattrape)}
            mot={rattrapee(rattrape)}
            classe="text-foreground [&_svg]:text-succes [&>span:last-child]:text-muted-foreground"
            titre="Nuits plus longues et siestes"
          />
          <span>=</span>
          {resultat}
        </div>
      ) : (
        <div className="flex" aria-hidden>
          {resultat}
        </div>
      )}
    </section>
  );
}

/** Manque net moyen par nuit mesurée (négatif : plus que l'objectif). */
const parNuit = (dette: number, rattrape: number, nuits: number) => (dette - rattrape) / nuits;

type ComptesSemaine = Pick<DetteSemaine, 'dette_min' | 'rattrape_min' | 'nuits_mesurees'>;

/**
 * Tendance face à la semaine d'avant (Frédéric, 01/11 : pas de tableau des semaines passées, juste
 * « plus ou moins » que la dernière). Comparaison par nuit mesurée, pour qu'une semaine en cours
 * incomplète ne paraisse pas meilleure qu'elle ne l'est. `reference` : « la semaine dernière » (face
 * à la semaine en cours) ou « la semaine d'avant » (face à une semaine close).
 */
export function tendanceEnMots(
  semaine: ComptesSemaine,
  precedente: ComptesSemaine,
  reference = 'la semaine dernière',
): { texte: string; classe: string; sens: -1 | 0 | 1 } | null {
  if (semaine.nuits_mesurees === 0 || precedente.nuits_mesurees === 0) return null;
  const diff = Math.round(
    parNuit(semaine.dette_min, semaine.rattrape_min, semaine.nuits_mesurees) -
      parNuit(precedente.dette_min, precedente.rattrape_min, precedente.nuits_mesurees),
  );
  if (Math.abs(diff) <= TOLERANCE_MIN) return { texte: `comme ${reference}`, classe: 'text-muted-foreground', sens: 0 };
  return diff > 0
    ? { texte: `${formaterDuree(diff)} de manque en plus par nuit que ${reference}`, classe: 'text-avertissement', sens: 1 }
    : { texte: `${formaterDuree(diff)} de manque en moins par nuit que ${reference}`, classe: 'text-succes', sens: -1 };
}

function Tendance({ semaine, precedente }: { semaine: SemaineAffichee; precedente: BilanSemaine }) {
  const t = tendanceEnMots(semaine, precedente, semaine.close ? "la semaine d'avant" : 'la semaine dernière');
  if (!t) return null;
  const Icone = t.sens > 0 ? ArrowUp : t.sens < 0 ? ArrowDown : Equal;
  return (
    <p className={cn('flex items-center gap-1.5 text-xs', t.classe)}>
      <Icone className="size-3.5 shrink-0" /> {t.texte}
    </p>
  );
}

/** Alerte discrète du bloc « Dormir » dans Google Agenda ; null si la dernière synchro a réussi. */
export function alerteAgenda(erreur: string | null | undefined): string | null {
  if (!erreur) return null;
  if (erreur === 'jeton_google_revoque' || erreur === 'client_google_refuse') {
    return "La connexion à Google Agenda a expiré : le bloc « Dormir » n'est plus mis à jour.";
  }
  if (erreur === 'google_acces_refuse') return "Google Agenda refuse l'accès : le bloc « Dormir » n'est plus mis à jour.";
  return "Google Agenda n'a pas répondu : le bloc « Dormir » n'est peut-être pas à jour.";
}

export function CarteSommeil({ statut }: { statut: ReponseStatut }) {
  const nuits = statut.nuits ?? [];
  const objectif = statut.objectif_sommeil_min ?? OBJECTIF_PAR_DEFAUT_MIN;
  const mesurees = nuits.filter((n) => dormi(n) !== null);
  const derniere = mesurees.at(-1);
  const jetonExpire = statut.sommeil_mesure?.erreur === 'jeton_xiaomi_expire';
  const agenda = alerteAgenda(statut.agenda?.erreur);

  const titreNuit = derniere
    ? derniere.nuit === ajouterJours(statut.journee.date, -1)
      ? 'Cette nuit'
      : `Nuit du ${formaterDateCourte(derniere.nuit)}`
    : null;
  // Sieste de la journée qui suit la dernière nuit (D + 1) : celle d'aujourd'hui pour « Cette nuit ».
  const siesteApres = derniere ? siesteApresNuit(derniere.nuit, nuits, statut.journee.date, statut.siestes_du_jour_min ?? 0) : 0;
  const ecart = derniere ? ecartNuitEnMots(dormi(derniere)! - objectif, siesteApres) : null;
  // Semaine en cours, ou la dernière close tant que la nouvelle n'a aucune nuit mesurée.
  const blocSemaine = semaineAAfficher(statut.dette_semaine, statut.bilans_semaines);
  const tardive = statut.sieste_tardive ?? null;
  // Graphique : la même semaine que le bloc, lun. → dim. (nuits de la semaine, et les 7 dernières pour
  // la sieste du lendemain ; `nuits_semaine` absent d'une API plus ancienne : les 7 dernières seules).
  const connues = [...(statut.nuits_semaine ?? []), ...nuits.filter((n) => !statut.nuits_semaine?.some((x) => x.nuit === n.nuit))];
  const colonnes = blocSemaine ? colonnesDeLaSemaine(blocSemaine.semaine.debut, connues, statut.journee.date, statut.siestes_du_jour_min ?? 0) : null;
  const titreGraphique = blocSemaine ? `Semaine du ${jourEtMois(blocSemaine.semaine.debut)}` : '';
  const colonnesFinies = colonnes?.filter((c) => !c.avenir).length ?? 0;
  const colonnesMesurees = colonnes?.filter((c) => c.minutes !== null).length ?? 0;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BedDouble className="text-muted-foreground size-4" /> Sommeil
        </CardTitle>
        <CardAction>
          <Badge variant="outline" className="text-muted-foreground">
            objectif {formaterDuree(objectif)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-5">
        {derniere ? (
          <section className="grid gap-3" aria-label={titreNuit ?? undefined}>
            <div className="grid gap-0.5">
              <span className="text-muted-foreground text-sm">
                {titreNuit}
              </span>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-3xl font-semibold tracking-tight tabular-nums">{formaterDuree(dormi(derniere)!)}</span>
                <span className={cn('text-sm font-medium', ecart!.classe)}>{ecart!.texte}</span>
              </div>
            </div>
            {derniere.phases ? <BarrePhases phases={derniere.phases} /> : null}
          </section>
        ) : (
          <p className="text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm">
            <Watch className="size-4 shrink-0" /> Pas encore de nuit mesurée par la montre.
          </p>
        )}
        {blocSemaine ? (
          <div className="grid gap-1.5">
            <BlocSemaine semaine={blocSemaine.semaine} />
            {blocSemaine.precedente ? <Tendance semaine={blocSemaine.semaine} precedente={blocSemaine.precedente} /> : null}
          </div>
        ) : null}
        {colonnes ? (
          <section className="grid gap-2" aria-label={titreGraphique}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="text-muted-foreground">{titreGraphique}</span>
              {colonnesMesurees < colonnesFinies ? (
                <span className="text-muted-foreground text-xs">
                  {colonnesMesurees}/{colonnesFinies} mesurées
                </span>
              ) : null}
            </div>
            <GraphiqueNuits colonnes={colonnes} objectif={objectif} />
          </section>
        ) : null}
        {tardive ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Moon className="size-3.5 shrink-0" /> Sieste tardive : vous endormir à {formaterHeure(tardive.coucher, statut.journee.fuseau)} pourrait être plus difficile.
          </p>
        ) : null}
        {jetonExpire ? (
          <p className="text-avertissement flex items-center gap-1.5 text-xs">
            <Watch className="size-3.5" /> La connexion au compte Xiaomi a expiré : le sommeil n'est plus mis à jour.
          </p>
        ) : null}
        {agenda ? (
          <p className="text-avertissement flex items-center gap-1.5 text-xs">
            <CalendarX className="size-3.5 shrink-0" /> {agenda}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
