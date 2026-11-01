import { BedDouble, ChartNoAxesColumn } from 'lucide-react';
import { Bar, BarChart, Cell, ReferenceLine, XAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { ReponseStatut } from '@/api/contrat';
import { formaterDateCourte, formaterDuree } from '@/lib/temps';
import { cn } from '@/lib/utils';

const config = { dette: { label: 'Dette', color: 'var(--avertissement)' } } satisfies ChartConfig;

/** « en retard » (dette), « en avance », « à l'équilibre », avec la couleur qui va avec. */
export function sensDette(minutes: number): { libelle: string; classe: string } {
  if (Math.round(minutes) === 0) return { libelle: "à l'équilibre", classe: 'text-muted-foreground' };
  return minutes > 0 ? { libelle: 'en retard', classe: 'text-avertissement' } : { libelle: 'en avance', classe: 'text-succes' };
}

const signe = (minutes: number) => (Math.round(minutes) === 0 ? '0 min' : `${minutes > 0 ? '+' : '−'}${formaterDuree(minutes)}`);

export function CarteDette({ statut }: { statut: ReponseStatut }) {
  const j = statut.journee;
  const nuits = statut.nuits ?? [];
  const cumul = statut.dette_cumulee_min;
  const sens = sensDette(j.detteNuitMin);
  const donnees = nuits.map((n) => ({ jour: formaterDateCourte(n.nuit).split(' ')[0] ?? n.nuit, date: formaterDateCourte(n.nuit), dette: n.dette_min }));

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5 font-medium">
          <BedDouble className="size-3.5" /> Dette de sommeil
        </CardDescription>
        <CardTitle className={cn('text-3xl font-semibold tracking-tight tabular-nums', sens.classe)}>{signe(j.detteNuitMin)}</CardTitle>
        <span className="text-muted-foreground text-xs">prévue cette nuit</span>
        <CardAction>
          <Badge variant="outline" className={sens.classe}>
            {sens.libelle}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {donnees.length > 0 ? (
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
                    formatter={(valeur) => {
                      const m = Number(valeur);
                      return `${signe(m)} · ${sensDette(m).libelle}`;
                    }}
                  />
                }
              />
              <Bar dataKey="dette" radius={4} maxBarSize={28}>
                {donnees.map((d) => (
                  <Cell key={d.date} fill={d.dette > 0 ? 'var(--avertissement)' : 'var(--succes)'} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        ) : (
          <div className="text-muted-foreground flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center text-sm">
            <ChartNoAxesColumn className="size-5" />
            L'historique des nuits n'est pas encore disponible.
          </div>
        )}
      </CardContent>
      <CardFooter className="text-muted-foreground flex-wrap justify-between gap-2 text-sm">
        <span>
          Cumul {nuits.length > 0 ? `sur ${nuits.length} nuits` : ''} :{' '}
          {cumul === undefined ? (
            <span className="text-foreground font-medium">non disponible</span>
          ) : (
            <span className={cn('font-semibold tabular-nums', sensDette(cumul).classe)}>{signe(cumul)}</span>
          )}
        </span>
        <span className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="bg-avertissement size-2 rounded-full" /> retard
          </span>
          <span className="flex items-center gap-1">
            <span className="bg-succes size-2 rounded-full" /> avance
          </span>
        </span>
      </CardFooter>
    </Card>
  );
}
