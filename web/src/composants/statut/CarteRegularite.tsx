import { CalendarClock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Bar, ComposedChart, ReferenceArea, Scatter, XAxis, YAxis } from 'recharts';

import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CoucherDeLaNuit, DateLocale, LeverDuJour, RegulariteCouchers, RegulariteLevers, ReponseStatut } from '@/api/contrat';
import { formaterDateCourte, formaterDuree, formaterHeure, instantLocal } from '@/lib/temps';
import { cn } from '@/lib/utils';
import { nuitEnMots } from './CarteSommeil';

/** En deçà, l'écart au prévu n'est pas dit : « comme prévu ». */
const TOLERANCE_MIN = 5;
const MINUTE = 60_000;

const config = { mesure: { label: 'Mesuré', color: 'var(--sommeil-nuit)' } } satisfies ChartConfig;

/** Les deux journaux ont la même forme : seuls les mots et le pivot changent. */
interface Mots {
  /** « limite » (levers, contrainte du plan) ou « repère » (couchers, affichage seul). */
  borne: 'limite' | 'repère';
  /** « jour » (levers) ou « nuit » (couchers). */
  unite: 'jour' | 'nuit';
}

const MOTS_LEVERS: Mots = { borne: 'limite', unite: 'jour' };
const MOTS_COUCHERS: Mots = { borne: 'repère', unite: 'nuit' };

type Entree = { prevu: string; mesure: string | null; ecart_min: number | null; ignore?: 'decalage_horaire'; fuseau?: string };
type Amplitude = RegulariteLevers['amplitude'];

/** « Paris » pour Europe/Paris, « Cayenne » pour America/Cayenne. */
export function villeDuFuseau(fuseau: string): string {
  return (fuseau.split('/').at(-1) ?? fuseau).replaceAll('_', ' ');
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
/** « 2 nuits non comptées », « 1 jour non compté ». */
const nonComptes = (n: number, mots: Mots) => `${pluriel(n, mots.unite)} non compté${mots.unite === 'nuit' ? 'e' : ''}${n > 1 ? 's' : ''}`;

/**
 * Résumé chiffré en tête de l'onglet. `ecart` : la durée mise en avant (null sous 2 mesures
 * comptées) ; `legende` : ce qui l'accompagne, court ; `phrase` : le tout en une phrase, pour les
 * lecteurs d'écran.
 */
export interface Resume {
  ecart: string | null;
  legende: string;
  classe: string;
  phrase: string;
}

function resume(amplitude: Amplitude, limiteMin: number, entrees: Entree[], fuseau: string, mots: Mots): Resume {
  const exclues = entrees.filter((e) => e.ignore && e.mesure !== null).length;
  if (!amplitude) {
    const legende = exclues > 0 ? `Voyage : ${nonComptes(exclues, mots)}` : 'Pas encore assez de mesures';
    return { ecart: null, legende, classe: 'text-muted-foreground', phrase: `${legende}.` };
  }
  const borne = `${mots.borne} ${formaterDuree(limiteMin)}`;
  const depasse = amplitude.ecart_min > limiteMin;
  const morceaux = [`d'écart sur ${pluriel(amplitude.mesures, mots.unite)}`, borne, ...(exclues > 0 ? [`${nonComptes(exclues, mots)} (voyage)`] : [])];
  const heure = (instant: string) => formaterHeure(instant, entrees.find((e) => e.mesure === instant)?.fuseau ?? fuseau);
  const ecart = formaterDuree(amplitude.ecart_min);
  const sens = depasse ? `, au-dessus ${mots.borne === 'limite' ? 'de la limite' : 'du repère'} de ${formaterDuree(limiteMin)}` : `, ${borne}`;
  return {
    ecart,
    legende: morceaux.join(' · '),
    classe: depasse ? 'text-avertissement' : 'text-succes',
    phrase: `Écart de ${ecart} sur ${pluriel(amplitude.mesures, mots.unite)}, de ${heure(amplitude.plus_tot)} à ${heure(amplitude.plus_tard)}${sens}.`,
  };
}

/** « 1 h 38 » « d'écart sur 5 jours · limite 2 h », orange au-dessus de la limite. */
export function resumeLevers(levers: RegulariteLevers, fuseau: string): Resume {
  return resume(levers.amplitude, levers.limite_min, levers.jours, fuseau, MOTS_LEVERS);
}

/** Même résumé pour les endormissements : le repère n'est pas une contrainte. */
export function resumeCouchers(couchers: RegulariteCouchers, fuseau: string): Resume {
  return resume(couchers.amplitude, couchers.limite_min, couchers.nuits, fuseau, MOTS_COUCHERS);
}

/** `fuseau` : celui de la journée courante, à défaut du fuseau propre à l'entrée (API plus ancienne). */
function detail(x: Entree, fuseau: string, attendu: boolean): string {
  const prevu = formaterHeure(x.prevu, x.fuseau ?? fuseau);
  if (x.mesure === null || x.ecart_min === null) return attendu ? `prévu ${prevu}, pas encore mesuré` : `prévu ${prevu}, pas de mesure`;
  if (x.ignore === 'decalage_horaire') return 'décalage horaire, non compté';
  if (Math.abs(x.ecart_min) <= TOLERANCE_MIN) return 'comme prévu';
  return `${formaterDuree(x.ecart_min)} plus ${x.ecart_min > 0 ? 'tard' : 'tôt'} que prévu (${prevu})`;
}

/** « comme prévu », « 20 min plus tard que prévu (05:50) », « prévu 06:00, pas de mesure », « décalage horaire, non compté ». */
export function detailLever(j: LeverDuJour, fuseau: string, aujourdhui: boolean): string {
  return detail(j, fuseau, aujourdhui);
}

/** Même phrase pour l'endormissement : « 3 h 12 plus tard que prévu (22:00) ». */
export function detailCoucher(n: CoucherDeLaNuit, fuseau: string): string {
  return detail(n, fuseau, false);
}

// ─── Graphique ────────────────────────────────────────────────────────────────

/** Une colonne du graphique : un jour (levers) ou une nuit (couchers). */
export interface ColonneRegularite {
  cle: DateLocale;
  /** Étiquette de l'axe : « dim. 1 », « auj. ». */
  jour: string;
  /** Titre de l'infobulle : « nuit du dim. 1er au lun. 2 nov. », « lun. 2 nov. ». */
  titre: string;
  /** Fuseau du lieu (routine de ce jour-là) : celui dans lequel les heures sont lues. */
  fuseau: string;
  /** Minutes depuis le pivot (midi du soir pour les couchers, minuit pour les levers), dans ce fuseau. */
  prevuY: number;
  mesureY: number | null;
  prevu: string;
  mesure: string | null;
  /** Écart signé au prévu, en minutes ; null sans mesure. */
  ecartMin: number | null;
  /** Mesure non comptée (décalage horaire). */
  ignoree: boolean;
  /** Mesure comptée hors de la bande de régularité. */
  horsBande: boolean;
  /** Pas encore mesurable (le lever d'aujourd'hui avant qu'il ait lieu). */
  attendu: boolean;
  /** Phrase complète (lecteurs d'écran). */
  detail: string;
}

/** Bande de régularité : la fenêtre de la largeur du repère, centrée sur le milieu des mesures comptées. */
export interface Bande {
  bas: number;
  haut: number;
}

/**
 * La bande : `limiteMin` de large, centrée entre la mesure comptée la plus tôt et la plus tard
 * (celles de l'amplitude de l'API). Toutes les mesures y tiennent exactement quand l'écart est sous
 * le repère : la bande montre la même règle que le chiffre du résumé. Null sous 2 mesures comptées.
 */
export function bandeDeRegularite(colonnes: ColonneRegularite[], limiteMin: number): Bande | null {
  const ys = colonnes.filter((c) => c.mesureY !== null && !c.ignoree).map((c) => c.mesureY!);
  if (ys.length < 2) return null;
  const milieu = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { bas: milieu - limiteMin / 2, haut: milieu + limiteMin / 2 };
}

/** « dim. 1 » : jour de la semaine et quantième, sans le mois (l'infobulle le donne). */
function jourCourt(date: DateLocale): string {
  const [jour, quantieme] = formaterDateCourte(date).split(' ');
  return `${jour} ${quantieme}`;
}

const minutesDepuis = (instant: string, date: DateLocale, pivot: string, fuseau: string) => (Date.parse(instant) - instantLocal(date, pivot, fuseau)) / MINUTE;

function colonne(cle: DateLocale, e: Entree, fuseauJournee: string, pivot: string, textes: { jour: string; titre: string; detail: string; attendu: boolean }): ColonneRegularite {
  const fuseau = e.fuseau ?? fuseauJournee;
  return {
    cle,
    ...textes,
    fuseau,
    prevuY: minutesDepuis(e.prevu, cle, pivot, fuseau),
    mesureY: e.mesure === null ? null : minutesDepuis(e.mesure, cle, pivot, fuseau),
    prevu: e.prevu,
    mesure: e.mesure,
    ecartMin: e.mesure === null ? null : e.ecart_min,
    ignoree: e.mesure !== null && e.ignore === 'decalage_horaire',
    horsBande: false,
  };
}

/** Marque les mesures comptées hors de la bande. */
function avecBande(colonnes: ColonneRegularite[], limiteMin: number): { colonnes: ColonneRegularite[]; bande: Bande | null } {
  const bande = bandeDeRegularite(colonnes, limiteMin);
  if (!bande) return { colonnes, bande };
  const hors = (c: ColonneRegularite) => c.mesureY !== null && !c.ignoree && (c.mesureY < bande.bas - 0.5 || c.mesureY > bande.haut + 0.5);
  return { colonnes: colonnes.map((c) => ({ ...c, horsBande: hors(c) })), bande };
}

/** Couchers : minutes depuis midi du soir de la nuit (23:30 et 00:30 restent voisins). */
export function colonnesCouchers(couchers: RegulariteCouchers, fuseau: string) {
  const colonnes = couchers.nuits.map((n) =>
    colonne(n.nuit, n, fuseau, '12:00', { jour: jourCourt(n.nuit), titre: nuitEnMots(n.nuit), detail: detailCoucher(n, fuseau), attendu: false }),
  );
  return avecBande(colonnes, couchers.limite_min);
}

/** Levers : minutes depuis minuit du jour du lever. */
export function colonnesLevers(levers: RegulariteLevers, fuseau: string, aujourdhui: DateLocale) {
  const colonnes = levers.jours.map((j) => {
    const estAujourdhui = j.date === aujourdhui;
    return colonne(j.date, j, fuseau, '00:00', {
      jour: estAujourdhui ? 'auj.' : jourCourt(j.date),
      titre: estAujourdhui ? `aujourd'hui, ${formaterDateCourte(j.date)}` : formaterDateCourte(j.date),
      detail: detailLever(j, fuseau, estAujourdhui),
      attendu: estAujourdhui,
    });
  });
  return avecBande(colonnes, levers.limite_min);
}

/** « 22:00 » pour 600 minutes depuis midi. */
const heureDuPivot = (minutes: number, pivotMin: number) => {
  const m = (((pivotMin + Math.round(minutes)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Domaine de l'axe des heures, arrondi à l'heure, et ses graduations (toutes les heures, ou toutes les 2 h au-delà de 6 h). */
export function axeDesHeures(colonnes: ColonneRegularite[], bande: Bande | null): { domaine: [number, number]; graduations: number[] } {
  const valeurs = colonnes.flatMap((c) => [c.prevuY, ...(c.mesureY === null ? [] : [c.mesureY])]);
  if (bande) valeurs.push(bande.bas, bande.haut);
  const bas = Math.floor((Math.min(...valeurs) - 15) / 60) * 60;
  const haut = Math.ceil((Math.max(...valeurs) + 15) / 60) * 60;
  const pas = haut - bas > 6 * 60 ? 120 : 60;
  const graduations: number[] = [];
  for (let m = Math.ceil(bas / pas) * pas; m <= haut; m += pas) graduations.push(m);
  return { domaine: [bas, haut], graduations };
}

/** Étiquette d'une colonne sur deux lignes (« dim. » puis « 1 ») : lisible à 390 px. */
function EtiquetteJour({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const [jour, quantieme] = (payload?.value ?? '').split(' ');
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
      <tspan x={x} dy={10}>
        {jour}
      </tspan>
      {quantieme ? (
        <tspan x={x} dy={13}>
          {quantieme}
        </tspan>
      ) : null}
    </text>
  );
}

/** Point de la mesure : plein (compté), orange (hors de la bande), creux (non compté). */
function PointMesure({ cx, cy, payload }: { cx?: number; cy?: number; payload?: ColonneRegularite }) {
  if (cx === undefined || cy === undefined || !payload || payload.mesureY === null || Number.isNaN(cy)) return null;
  if (payload.ignoree) {
    return <circle cx={cx} cy={cy} r={4} fill="var(--card)" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeOpacity={0.8} />;
  }
  return <circle cx={cx} cy={cy} r={4.5} fill={payload.horsBande ? 'var(--avertissement)' : 'var(--sommeil-nuit)'} stroke="var(--card)" strokeWidth={1.5} />;
}

/** Repère de l'heure prévue : un petit trait horizontal. */
function TraitPrevu({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx === undefined || cy === undefined || Number.isNaN(cy)) return null;
  return <line x1={cx - 7} x2={cx + 7} y1={cy} y2={cy} stroke="var(--muted-foreground)" strokeWidth={2} strokeLinecap="round" />;
}

/** Fil entre le prévu et le mesuré : la longueur de l'écart. */
function Fil({ x, y, width, height }: { x?: number; y?: number; width?: number; height?: number }) {
  if (x === undefined || y === undefined || width === undefined || height === undefined || height === 0) return null;
  const milieu = x + width / 2;
  const haut = Math.min(y, y + height);
  return <line x1={milieu} x2={milieu} y1={haut} y2={haut + Math.abs(height)} stroke="var(--muted-foreground)" strokeOpacity={0.45} strokeWidth={1.5} />;
}

function Infobulle({ c, fuseau, pivotMin, mot }: { c: ColonneRegularite; fuseau: string; pivotMin: number; mot: string }) {
  const lieu = c.fuseau !== fuseau ? ` (${villeDuFuseau(c.fuseau)})` : '';
  const heure = (y: number) => `${heureDuPivot(y, pivotMin)}${lieu}`;
  const ecart =
    c.ecartMin === null ? null : Math.abs(c.ecartMin) <= TOLERANCE_MIN ? 'comme prévu' : `${formaterDuree(c.ecartMin)} plus ${c.ecartMin > 0 ? 'tard' : 'tôt'}`;
  const ligne = (libelle: string, valeur: string, classe?: string) => (
    <>
      <span className="text-muted-foreground">{libelle}</span>
      <span className={cn('text-right font-medium tabular-nums', classe)}>{valeur}</span>
    </>
  );
  return (
    <div className="border-border/50 bg-background grid min-w-40 gap-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      <span className="font-medium">{c.titre}</span>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {ligne(mot, c.mesureY === null ? (c.attendu ? 'pas encore' : 'pas de mesure') : heure(c.mesureY), c.mesureY === null ? 'text-muted-foreground font-normal' : undefined)}
        {ligne('prévu', heure(c.prevuY))}
        {ecart ? ligne('écart', ecart, c.horsBande ? 'text-avertissement' : undefined) : null}
      </div>
      {c.ignoree ? <span className="text-muted-foreground">Non compté : décalage horaire</span> : null}
    </div>
  );
}

function Legende({ items }: { items: { cle: string; marque: ReactNode; texte: string }[] }) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {items.map((i) => (
        <span key={i.cle} className="flex items-center gap-1.5">
          {i.marque}
          {i.texte}
        </span>
      ))}
    </div>
  );
}

function Graphique({
  colonnes,
  bande,
  fuseau,
  pivotMin,
  mot,
}: {
  colonnes: ColonneRegularite[];
  bande: Bande | null;
  fuseau: string;
  pivotMin: number;
  /** « endormi » ou « levé ». */
  mot: string;
}) {
  const { domaine, graduations } = axeDesHeures(colonnes, bande);
  const donnees = colonnes.map((c) => ({
    ...c,
    // Fil du prévu au mesuré (barre de plage) ; rien sans mesure.
    fil: c.mesureY === null ? null : ([Math.min(c.prevuY, c.mesureY), Math.max(c.prevuY, c.mesureY)] as [number, number]),
  }));
  const ignorees = colonnes.some((c) => c.ignoree);
  const villes = [...new Set(colonnes.filter((c) => c.fuseau !== fuseau).map((c) => villeDuFuseau(c.fuseau)))];
  return (
    <div className="grid gap-2">
      <ChartContainer config={config} className="aspect-auto h-44 w-full [&_.recharts-wrapper]:outline-none [&_g]:outline-none">
        <ComposedChart data={donnees} margin={{ top: 10, right: 4, left: 0, bottom: 0 }} accessibilityLayer={false}>
          <XAxis dataKey="jour" tickLine={false} axisLine={false} tickMargin={4} interval={0} height={36} tick={<EtiquetteJour />} />
          {/* Les heures descendent, comme dans un agenda : plus tard = plus bas. */}
          <YAxis
            reversed
            type="number"
            domain={domaine}
            ticks={graduations}
            tickFormatter={(m: number) => heureDuPivot(m, pivotMin)}
            tickLine={false}
            axisLine={false}
            width={38}
            fontSize={11}
            allowDataOverflow
          />
          {bande ? <ReferenceArea y1={bande.bas} y2={bande.haut} fill="var(--sommeil-nuit)" fillOpacity={0.1} stroke="none" ifOverflow="hidden" /> : null}
          <ChartTooltip
            cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              const c = payload?.[0]?.payload as ColonneRegularite | undefined;
              return active && c ? <Infobulle c={c} fuseau={fuseau} pivotMin={pivotMin} mot={mot} /> : null;
            }}
          />
          <Bar dataKey="fil" maxBarSize={14} isAnimationActive={false} shape={<Fil />} />
          <Scatter dataKey="prevuY" isAnimationActive={false} shape={<TraitPrevu />} />
          <Scatter dataKey="mesureY" isAnimationActive={false} shape={<PointMesure />} />
        </ComposedChart>
      </ChartContainer>
      <Legende
        items={[
          { cle: 'mesure', marque: <span className="size-2 rounded-full" style={{ background: 'var(--sommeil-nuit)' }} />, texte: mot },
          { cle: 'prevu', marque: <span className="border-muted-foreground w-3 rounded-full border-t-2" />, texte: 'prévu' },
          ...(bande ? [{ cle: 'bande', marque: <span className="h-2.5 w-3 rounded-[2px]" style={{ background: 'color-mix(in oklab, var(--sommeil-nuit) 18%, transparent)' }} />, texte: 'bande de régularité' }] : []),
          ...(ignorees ? [{ cle: 'voyage', marque: <span className="border-muted-foreground size-2 rounded-full border-[1.5px]" />, texte: 'non compté (voyage)' }] : []),
          ...(villes.length > 0 ? [{ cle: 'lieu', marque: null, texte: `heures du lieu (${villes.join(', ')} pendant le voyage)` }] : []),
        ]}
      />
    </div>
  );
}

function Journal({
  resume: r,
  colonnes,
  bande,
  fuseau,
  pivotMin,
  mot,
  etiquette,
}: {
  resume: Resume;
  colonnes: ColonneRegularite[];
  bande: Bande | null;
  fuseau: string;
  pivotMin: number;
  mot: string;
  etiquette: string;
}) {
  return (
    <div className="grid gap-3">
      <p className="sr-only">{r.phrase}</p>
      {r.ecart ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" aria-hidden>
          <span className={cn('text-2xl font-semibold tracking-tight tabular-nums', r.classe)}>{r.ecart}</span>
          <span className="text-muted-foreground text-sm">{r.legende}</span>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm" aria-hidden>
          {r.legende}
        </p>
      )}
      <div aria-hidden>
        <Graphique colonnes={colonnes} bande={bande} fuseau={fuseau} pivotMin={pivotMin} mot={mot} />
      </div>
      <ul className="sr-only" aria-label={etiquette}>
        {colonnes.map((c) => (
          <li key={c.cle}>
            {c.titre} : {c.mesure === null ? '' : `${mot} à ${formaterHeure(c.mesure, c.fuseau)}${c.fuseau !== fuseau ? ` (heure de ${villeDuFuseau(c.fuseau)})` : ''}, `}
            {c.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Régularité des couchers (endormissements mesurés) et des levers : affichage seul. */
export function CarteRegularite({ statut }: { statut: ReponseStatut }) {
  const { levers, couchers } = statut;
  if (!levers && !couchers) return null;
  const fuseau = statut.journee.fuseau;

  const partieLevers = levers ? (
    <Journal
      resume={resumeLevers(levers, fuseau)}
      {...colonnesLevers(levers, fuseau, statut.journee.date)}
      fuseau={fuseau}
      pivotMin={0}
      mot="levé"
      etiquette="Lever de chaque jour"
    />
  ) : null;
  const partieCouchers = couchers ? (
    <Journal
      resume={resumeCouchers(couchers, fuseau)}
      {...colonnesCouchers(couchers, fuseau)}
      fuseau={fuseau}
      pivotMin={12 * 60}
      mot="endormi"
      etiquette="Endormissement de chaque nuit"
    />
  ) : null;

  const titre = (
    <CardTitle className="flex items-center gap-2 text-base">
      <CalendarClock className="text-muted-foreground size-4" /> Régularité
    </CardTitle>
  );

  // API plus ancienne : une seule partie, sans onglets.
  if (!partieLevers || !partieCouchers) {
    return (
      <Card className="gap-4">
        <CardHeader>{titre}</CardHeader>
        <CardContent>{partieLevers ?? partieCouchers}</CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-4">
      <Tabs defaultValue="couchers" className="gap-4">
        <CardHeader className="grid-rows-1 items-center">
          {titre}
          <CardAction className="row-span-1 self-center">
            <TabsList aria-label="Couchers ou levers">
              <TabsTrigger value="couchers">Couchers</TabsTrigger>
              <TabsTrigger value="levers">Levers</TabsTrigger>
            </TabsList>
          </CardAction>
        </CardHeader>
        <CardContent>
          <TabsContent value="couchers">{partieCouchers}</TabsContent>
          <TabsContent value="levers">{partieLevers}</TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
