import { BedDouble, CircleCheck, Moon, Sun, TrendingDown, TrendingUp, Watch } from 'lucide-react';
import { Bar, BarChart, Cell, ReferenceLine, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import type { NuitPassee, PhasesSommeil, ReponseStatut } from '@/api/contrat';
import { ajouterJours, formaterDateCourte, formaterDuree, formaterHeure } from '@/lib/temps';
import { cn } from '@/lib/utils';

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

/** « rattrapée » ou « rattrapées », accordé à la durée (« 29 min rattrapées », « 1 h 05 rattrapée »). */
export function rattrapee(minutes: number): string {
  const m = Math.round(Math.abs(minutes));
  const pluriel = m < 60 ? m > 1 : Math.floor(m / 60) > 1;
  return pluriel ? 'rattrapées' : 'rattrapée';
}

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

function GraphiqueNuits({ nuits, objectif, aujourdhui, siestesDuJour }: { nuits: NuitPassee[]; objectif: number; aujourdhui: string; siestesDuJour: number }) {
  const donnees = nuits.map((n) => {
    const m = dormi(n);
    const sieste = siesteApresNuit(n.nuit, nuits, aujourdhui, siestesDuJour);
    return {
      jour: formaterDateCourte(n.nuit).split(' ')[0] ?? n.nuit,
      date: formaterDateCourte(n.nuit),
      // 0 plutôt que null : la barre est invisible mais l'infobulle dit « pas de mesure ».
      heures: m === null ? 0 : m / 60,
      sieste: sieste / 60,
      minutes: m,
      siesteMin: sieste,
    };
  });
  const max = Math.max(objectif / 60, ...donnees.map((d) => d.heures + d.sieste)) * 1.08;
  const sansMesure = donnees.some((d) => d.minutes === null && d.siesteMin === 0);
  const avecSieste = donnees.some((d) => d.siesteMin > 0);
  return (
    <div className="grid gap-1.5">
      <ChartContainer config={config} className="aspect-auto h-32 w-full [&_.recharts-wrapper]:outline-none [&_g]:outline-none">
        <BarChart data={donnees} margin={{ top: 6, right: 4, left: 4, bottom: 0 }} accessibilityLayer={false}>
          <XAxis dataKey="jour" tickLine={false} axisLine={false} tickMargin={6} fontSize={11} />
          <YAxis hide domain={[0, max]} />
          <ChartTooltip
            cursor={false}
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as (typeof donnees)[number] | undefined;
              if (!active || !d) return null;
              return (
                <div className="border-border/50 bg-background grid gap-0.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
                  <span className="font-medium">{d.date}</span>
                  <span className="text-muted-foreground">{detailNuit(d.minutes, d.siesteMin)}</span>
                </div>
              );
            }}
          />
          <Bar dataKey="heures" stackId="sommeil" maxBarSize={28} isAnimationActive={false}>
            {donnees.map((d) => (
              <Cell key={d.date} fill="var(--sommeil-nuit)" radius={(d.siesteMin > 0 ? [0, 0, 4, 4] : 4) as never} />
            ))}
          </Bar>
          <Bar dataKey="sieste" stackId="sommeil" maxBarSize={28} isAnimationActive={false}>
            {donnees.map((d) => (
              <Cell
                key={d.date}
                fill="var(--sommeil-sieste)"
                stroke="var(--card)"
                strokeWidth={d.minutes === null ? 0 : 2}
                radius={(d.minutes === null ? 4 : [4, 4, 0, 0]) as never}
              />
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
          <li key={d.date}>
            {d.date} : {detailNuit(d.minutes, d.siesteMin)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CarteSommeil({ statut }: { statut: ReponseStatut }) {
  const nuits = statut.nuits ?? [];
  const objectif = statut.objectif_sommeil_min ?? OBJECTIF_PAR_DEFAUT_MIN;
  const mesurees = nuits.filter((n) => dormi(n) !== null);
  const derniere = mesurees.at(-1);
  const jetonExpire = statut.sommeil_mesure?.erreur === 'jeton_xiaomi_expire';

  const titreNuit = derniere
    ? derniere.nuit === ajouterJours(statut.journee.date, -1)
      ? 'Cette nuit'
      : `Nuit du ${formaterDateCourte(derniere.nuit)}`
    : null;
  // Sieste de la journée qui suit la dernière nuit (D + 1) : celle d'aujourd'hui pour « Cette nuit ».
  const siesteApres = derniere ? siesteApresNuit(derniere.nuit, nuits, statut.journee.date, statut.siestes_du_jour_min ?? 0) : 0;
  const ecart = derniere ? ecartNuitEnMots(dormi(derniere)! - objectif, siesteApres) : null;
  const siestesDuJour = statut.siestes_du_jour_min ?? 0;
  // Les siestes de la période rattrapent la dette des nuits (journées des 7 nuits et aujourd'hui).
  const siestesTotal = statut.siestes_total_min ?? nuits.reduce((t, n) => t + siestesDe(n), 0) + siestesDuJour;
  const nbSiestes = nuits.reduce((t, n) => t + (n.siestes?.length ?? (siestesDe(n) > 0 ? 1 : 0)), 0) + (statut.siestes_du_jour?.length ?? 0);
  const ecartTotal = mesurees.reduce((t, n) => t + dormi(n)! - objectif, 0) + siestesTotal;
  const total = ecartEnMots(ecartTotal, ' au total');
  const rattrape = siestesTotal > 0 ? `, dont ${formaterDuree(siestesTotal)} ${rattrapee(siestesTotal)} en sieste${nbSiestes > 1 ? 's' : ''}` : '';
  const IconeTotal = Math.abs(ecartTotal) <= TOLERANCE_MIN ? CircleCheck : ecartTotal < 0 ? TrendingDown : TrendingUp;
  const libelleTotal =
    Math.abs(ecartTotal) <= TOLERANCE_MIN ? 'objectif atteint' : `${formaterDuree(ecartTotal)} ${ecartTotal < 0 ? 'manquantes' : 'en plus'}`;
  const tardive = statut.sieste_tardive ?? null;

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
        {mesurees.length > 0 ? (
          <section className="grid gap-2" aria-label={`${nuits.length} dernières nuits`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="text-muted-foreground">{nuits.length} dernières nuits</span>
              {mesurees.length < nuits.length ? (
                <span className="text-muted-foreground text-xs">
                  {mesurees.length}/{nuits.length} mesurées
                </span>
              ) : null}
            </div>
            {/* Phrase complète pour les lecteurs d'écran ; à l'écran, deux pastilles courtes. */}
            <p className="sr-only">
              {total.texte}
              {rattrape}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm" aria-hidden>
              <span className={cn('bg-muted/60 flex items-center gap-1.5 rounded-md px-2 py-1 font-medium tabular-nums', total.classe)} title="Écart à l'objectif sur les nuits mesurées, siestes comprises">
                <IconeTotal className="size-4 shrink-0" /> {libelleTotal}
              </span>
              {siestesTotal > 0 ? (
                <span className="bg-muted/60 flex items-center gap-1.5 rounded-md px-2 py-1 font-medium tabular-nums" title="Siestes comptées dans le total">
                  <Sun className="size-4 shrink-0" style={{ color: 'var(--sommeil-sieste)' }} /> {formaterDuree(siestesTotal)}
                  <span className="text-muted-foreground font-normal">de sieste</span>
                </span>
              ) : null}
            </div>
            <GraphiqueNuits nuits={nuits} objectif={objectif} aujourdhui={statut.journee.date} siestesDuJour={statut.siestes_du_jour_min ?? 0} />
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
      </CardContent>
    </Card>
  );
}
