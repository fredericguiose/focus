import { CalendarClock } from 'lucide-react';

import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CoucherDeLaNuit, LeverDuJour, RegulariteCouchers, RegulariteLevers, ReponseStatut } from '@/api/contrat';
import { formaterDateCourte, formaterDuree, formaterHeure } from '@/lib/temps';
import { cn } from '@/lib/utils';

/** En deçà, l'écart au prévu n'est pas dit : « comme prévu ». */
const TOLERANCE_MIN = 5;

type Resume = { texte: string; morceaux: string[]; classe: string };

/** Les deux journaux ont la même forme : seuls les mots changent. */
interface Mots {
  /** « limite » (levers, contrainte du plan) ou « repère » (couchers, affichage seul). */
  borne: 'limite' | 'repère';
  /** « jour » (levers) ou « nuit » (couchers), pour « 2 jours exclus » / « 2 nuits exclues ». */
  unite: 'jour' | 'nuit';
}

type Mesure = { mesure: string | null; ignore?: 'decalage_horaire'; fuseau?: string };
type Amplitude = RegulariteLevers['amplitude'];

/** « Paris » pour Europe/Paris, « Cayenne » pour America/Cayenne. */
export function villeDuFuseau(fuseau: string): string {
  return (fuseau.split('/').at(-1) ?? fuseau).replaceAll('_', ' ');
}

/**
 * Heure d'un instant dans le fuseau de sa ligne (celui de la routine de ce jour-là, donné par
 * l'API) : une nuit passée à Paris se lit en heure de Paris. Suivie de « (Paris) » si ce fuseau
 * n'est pas celui de la journée courante.
 */
function heureDansSonFuseau(instant: string, mesures: Mesure[], fuseau: string): string {
  const propre = mesures.find((m) => m.mesure === instant)?.fuseau ?? fuseau;
  const heure = formaterHeure(instant, propre);
  return propre === fuseau ? heure : `${heure} (${villeDuFuseau(propre)})`;
}

function resume(amplitude: Amplitude, limiteMin: number, mesures: Mesure[], fuseau: string, mots: Mots): Resume {
  const n = mesures.filter((m) => m.ignore && m.mesure !== null).length;
  const accord = mots.unite === 'nuit' ? 'e' : '';
  const exclus = n === 0 ? [] : [`${n} ${mots.unite}${n > 1 ? 's' : ''} exclu${accord}${n > 1 ? 's' : ''}`];
  const resultat = (morceaux: string[], classe: string) => ({ texte: morceaux.join(' · '), morceaux, classe });
  if (!amplitude) return resultat(['pas encore assez de mesures', ...exclus], 'text-muted-foreground');
  const plage = `de ${heureDansSonFuseau(amplitude.plus_tot, mesures, fuseau)} à ${heureDansSonFuseau(amplitude.plus_tard, mesures, fuseau)}`;
  const borne = formaterDuree(limiteMin);
  const depasse = amplitude.ecart_min > limiteMin;
  // Un repère n'est pas une règle : au-delà, la couleur le signale, pas une phrase de plus.
  const ecart =
    depasse && mots.borne === 'limite'
      ? `écart ${formaterDuree(amplitude.ecart_min)}, au-dessus de la limite de ${borne}`
      : `écart ${formaterDuree(amplitude.ecart_min)} (${mots.borne} ${borne})`;
  return resultat([plage, ecart, ...exclus], depasse ? 'text-avertissement' : 'text-foreground');
}

/**
 * « de 04:32 à 06:10 · écart 1 h 38 (limite 2 h) », ou « …· écart 2 h 20, au-dessus de la limite
 * de 2 h », suivi de « · 2 jours exclus » si des mesures ne comptent pas (décalage horaire).
 * `morceaux` : les mêmes, à ne pas couper en fin de ligne.
 */
export function resumeLevers(levers: RegulariteLevers, fuseau: string): Resume {
  return resume(levers.amplitude, levers.limite_min, levers.jours, fuseau, { borne: 'limite', unite: 'jour' });
}

/** « de 22:10 à 01:12 · écart 3 h 02 (repère 2 h) » : le repère n'est pas une contrainte. */
export function resumeCouchers(couchers: RegulariteCouchers, fuseau: string): Resume {
  return resume(couchers.amplitude, couchers.limite_min, couchers.nuits, fuseau, { borne: 'repère', unite: 'nuit' });
}

/** `fuseau` : celui de la journée courante, à défaut du fuseau propre à la ligne (API plus ancienne). */
function detail(x: { prevu: string; mesure: string | null; ecart_min: number | null; ignore?: 'decalage_horaire'; fuseau?: string }, fuseau: string, attendu: boolean): string {
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

interface Ligne {
  cle: string;
  libelle: string;
  mesure: string | null;
  /** Fuseau dans lequel lire les heures de la ligne (celui de la routine de ce jour-là). */
  fuseau: string;
  ignore?: 'decalage_horaire';
  detail: string;
}

function Journal({ titre, resume: r, lignes, etiquette, fuseau }: { titre: string; resume: Resume; lignes: Ligne[]; etiquette: string; fuseau: string }) {
  return (
    <div className="grid gap-4">
      <p className="text-sm">
        <span className="text-muted-foreground">{titre} : </span>
        <span className={cn('font-medium', r.classe)}>
          {r.morceaux.map((m, i) => (
            <span key={m}>
              {i > 0 ? ' · ' : null}
              <span className="whitespace-nowrap">{m}</span>
            </span>
          ))}
        </span>
      </p>
      <ul className="grid gap-1.5 text-sm" aria-label={etiquette}>
        {lignes.map((l) => (
          <li key={l.cle} className="grid grid-cols-[6.5rem_3.25rem_1fr] items-baseline gap-x-2">
            <span className="text-muted-foreground truncate">{l.libelle}</span>
            <span className={cn('font-medium tabular-nums', (l.mesure === null || l.ignore) && 'text-muted-foreground')}>
              {l.mesure === null ? '–' : formaterHeure(l.mesure, l.fuseau)}
            </span>
            <span className="text-muted-foreground min-w-0 text-xs">
              {l.detail}
              {l.fuseau !== fuseau ? <span className="text-muted-foreground/70 whitespace-nowrap"> · heure de {villeDuFuseau(l.fuseau)}</span> : null}
            </span>
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
      titre={`Levers sur ${levers.jours.length} jours`}
      resume={resumeLevers(levers, fuseau)}
      etiquette="Lever de chaque jour"
      fuseau={fuseau}
      lignes={levers.jours.map((j) => {
        const aujourdhui = j.date === statut.journee.date;
        return {
          cle: j.date,
          libelle: aujourdhui ? "aujourd'hui" : formaterDateCourte(j.date),
          mesure: j.mesure,
          fuseau: j.fuseau ?? fuseau,
          ...(j.ignore ? { ignore: j.ignore } : {}),
          detail: detailLever(j, fuseau, aujourdhui),
        };
      })}
    />
  ) : null;
  const partieCouchers = couchers ? (
    <Journal
      titre={`Endormissements sur ${couchers.nuits.length} nuits`}
      resume={resumeCouchers(couchers, fuseau)}
      etiquette="Endormissement de chaque nuit"
      fuseau={fuseau}
      lignes={couchers.nuits.map((n) => ({
        cle: n.nuit,
        libelle: formaterDateCourte(n.nuit),
        mesure: n.mesure,
        fuseau: n.fuseau ?? fuseau,
        ...(n.ignore ? { ignore: n.ignore } : {}),
        detail: detailCoucher(n, fuseau),
      }))}
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
