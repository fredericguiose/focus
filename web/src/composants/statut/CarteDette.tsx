import { BedDouble, ChartNoAxesColumn, Watch } from 'lucide-react';
import { Bar, BarChart, Cell, ReferenceLine, XAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { NuitPassee, PhasesSommeil, ReponseStatut } from '@/api/contrat';
import { formaterDateCourte, formaterDuree } from '@/lib/temps';
import { cn } from '@/lib/utils';

const config = { dette: { label: 'Dette', color: 'var(--avertissement)' } } satisfies ChartConfig;

/** « en retard » (dette), « en avance », « à l'équilibre », avec la couleur qui va avec. */
export function sensDette(minutes: number): { libelle: string; classe: string } {
  if (Math.round(minutes) === 0) return { libelle: "à l'équilibre", classe: 'text-muted-foreground' };
  return minutes > 0 ? { libelle: 'en dette', classe: 'text-avertissement' } : { libelle: 'en avance', classe: 'text-succes' };
}

const signe = (minutes: number) => (Math.round(minutes) === 0 ? '0 min' : `${minutes > 0 ? '+' : '−'}${formaterDuree(minutes)}`);

const reelle = (n: NuitPassee) => (typeof n.dette_reelle_min === 'number' ? n.dette_reelle_min : null);

const PHASES: { cle: keyof PhasesSommeil; nom: string; couleur: string }[] = [
  { cle: 'profonde', nom: 'Profond', couleur: 'var(--phase-profond)' },
  { cle: 'rem', nom: 'REM', couleur: 'var(--phase-rem)' },
  { cle: 'legere', nom: 'Léger', couleur: 'var(--phase-legere)' },
  { cle: 'eveil', nom: 'Éveil', couleur: 'var(--phase-eveil)' },
];

/** Barre empilée des phases d'une nuit, chaque phase nommée avec sa durée sous la barre. */
export function BarrePhases({ phases, nuit }: { phases: PhasesSommeil; nuit: string }) {
  const total = PHASES.reduce((t, p) => t + phases[p.cle], 0);
  if (total <= 0) return null;
  return (
    <div className="grid gap-2" aria-label={`Phases de la nuit du ${formaterDateCourte(nuit)}`}>
      <div className="text-muted-foreground flex items-baseline justify-between text-xs">
        <span>Phases · nuit du {formaterDateCourte(nuit)}</span>
        <span className="tabular-nums">{formaterDuree(total - phases.eveil)} endormi</span>
      </div>
      <div className="flex h-3 w-full gap-0.5" role="img" aria-hidden>
        {PHASES.filter((p) => phases[p.cle] > 0).map((p) => (
          <div
            key={p.cle}
            className="h-full first:rounded-l last:rounded-r"
            style={{ width: `${(phases[p.cle] / total) * 100}%`, background: p.couleur }}
            title={`${p.nom} : ${formaterDuree(phases[p.cle])}`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
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

export function CarteDette({ statut }: { statut: ReponseStatut }) {
  const j = statut.journee;
  const nuits = statut.nuits ?? [];
  const mesurees = nuits.filter((n) => reelle(n) !== null);
  const enReel = mesurees.length > 0;
  const sansMesure = nuits.filter((n) => reelle(n) === null);
  const derniere = mesurees.at(-1);
  const avecPhases = [...nuits].reverse().find((n) => n.phases);
  const cumulReel = statut.dette_cumulee_reelle_min ?? null;
  const cumulPrevu = statut.dette_cumulee_min;
  const titre = derniere ? reelle(derniere)! : j.detteNuitMin;
  const sens = sensDette(titre);
  const donnees = nuits.map((n) => ({
    jour: formaterDateCourte(n.nuit).split(' ')[0] ?? n.nuit,
    date: formaterDateCourte(n.nuit),
    dette: enReel ? reelle(n) : n.dette_min,
    prevue: n.dette_min,
  }));
  const jetonExpire = statut.sommeil_mesure?.erreur === 'jeton_xiaomi_expire';

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5 font-medium">
          <BedDouble className="size-3.5" /> Dette de sommeil
        </CardDescription>
        <CardTitle className={cn('text-3xl font-semibold tracking-tight tabular-nums', sens.classe)}>{signe(titre)}</CardTitle>
        {derniere ? (
          <span className="text-muted-foreground text-xs">
            mesurée la nuit du {formaterDateCourte(derniere.nuit)} · prévue cette nuit :{' '}
            <span className={cn('font-medium tabular-nums', sensDette(j.detteNuitMin).classe)}>{signe(j.detteNuitMin)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">prévue cette nuit</span>
        )}
        <CardAction>
          <Badge variant="outline" className={sens.classe}>
            {sens.libelle}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {donnees.length > 0 ? (
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs">{enReel ? 'Dette mesurée des 7 dernières nuits' : 'Dette prévue des 7 dernières nuits'}</span>
            <ChartContainer config={config} className="aspect-auto h-32 w-full">
              <BarChart data={donnees} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="jour" tickLine={false} axisLine={false} tickMargin={6} fontSize={11} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      hideIndicator
                      labelFormatter={(_, charge) => (charge[0]?.payload as { date?: string } | undefined)?.date ?? ''}
                      formatter={(valeur, _nom, element) => {
                        const prevue = (element.payload as { prevue: number }).prevue;
                        if (valeur === null || valeur === undefined) return `pas de mesure · prévue ${signe(prevue)}`;
                        const m = Number(valeur);
                        return enReel ? `${signe(m)} mesurée · ${signe(prevue)} prévue` : `${signe(m)} · ${sensDette(m).libelle}`;
                      }}
                    />
                  }
                />
                <Bar dataKey="dette" radius={4} maxBarSize={28}>
                  {donnees.map((d) => (
                    <Cell key={d.date} fill={(d.dette ?? 0) > 0 ? 'var(--avertissement)' : 'var(--succes)'} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
            {enReel && sansMesure.length > 0 ? (
              <span className="text-muted-foreground text-xs">
                Pas de mesure de la montre : {sansMesure.map((n) => formaterDateCourte(n.nuit)).join(', ')}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="text-muted-foreground flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center text-sm">
            <ChartNoAxesColumn className="size-5" />
            L'historique des nuits n'est pas encore disponible.
          </div>
        )}
        {avecPhases?.phases ? <BarrePhases phases={avecPhases.phases} nuit={avecPhases.nuit} /> : null}
        {jetonExpire ? (
          <p className="text-avertissement flex items-center gap-1.5 text-xs">
            <Watch className="size-3.5" /> La connexion au compte Xiaomi a expiré : le sommeil mesuré n'est plus mis à jour.
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="text-muted-foreground flex-wrap justify-between gap-2 text-sm">
        <span>
          {cumulReel !== null ? (
            <>
              Cumul mesuré ({mesurees.length} {mesurees.length > 1 ? 'nuits' : 'nuit'}) :{' '}
              <span className={cn('font-semibold whitespace-nowrap tabular-nums', sensDette(cumulReel).classe)}>{signe(cumulReel)}</span>
              {cumulPrevu !== undefined ? (
                <span className="text-xs whitespace-nowrap">
                  {' '}
                  · prévu <span className="tabular-nums">{signe(cumulPrevu)}</span>
                </span>
              ) : null}
            </>
          ) : (
            <>
              Cumul {nuits.length > 0 ? `sur ${nuits.length} nuits` : ''} :{' '}
              {cumulPrevu === undefined ? (
                <span className="text-foreground font-medium">non disponible</span>
              ) : (
                <span className={cn('font-semibold whitespace-nowrap tabular-nums', sensDette(cumulPrevu).classe)}>{signe(cumulPrevu)}</span>
              )}
            </>
          )}
        </span>
        <span className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="bg-avertissement size-2 rounded-full" /> dette
          </span>
          <span className="flex items-center gap-1">
            <span className="bg-succes size-2 rounded-full" /> avance
          </span>
        </span>
      </CardFooter>
    </Card>
  );
}
