import { Sunrise } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LeverDuJour, RegulariteLevers, ReponseStatut } from '@/api/contrat';
import { formaterDateCourte, formaterDuree, formaterHeure } from '@/lib/temps';
import { cn } from '@/lib/utils';

/** En deçà, l'écart au prévu n'est pas dit : « comme prévu ». */
const TOLERANCE_MIN = 5;

/**
 * « de 04:32 à 06:10 · écart 1 h 38 (limite 2 h) », ou « …· écart 2 h 20, au-dessus de la limite
 * de 2 h ». `morceaux` : les mêmes, à ne pas couper en fin de ligne.
 */
export function resumeLevers(levers: RegulariteLevers, fuseau: string): { texte: string; morceaux: string[]; classe: string } {
  const a = levers.amplitude;
  if (!a) return { texte: 'pas encore assez de mesures', morceaux: ['pas encore assez de mesures'], classe: 'text-muted-foreground' };
  const plage = `de ${formaterHeure(a.plus_tot, fuseau)} à ${formaterHeure(a.plus_tard, fuseau)}`;
  const limite = formaterDuree(levers.limite_min);
  const depasse = a.ecart_min > levers.limite_min;
  const ecart = depasse ? `écart ${formaterDuree(a.ecart_min)}, au-dessus de la limite de ${limite}` : `écart ${formaterDuree(a.ecart_min)} (limite ${limite})`;
  return { texte: `${plage} · ${ecart}`, morceaux: [plage, ecart], classe: depasse ? 'text-avertissement' : 'text-foreground' };
}

/** « comme prévu », « 20 min plus tard que prévu (05:50) », « prévu 06:00, pas de mesure ». */
export function detailLever(j: LeverDuJour, fuseau: string, aujourdhui: boolean): string {
  const prevu = formaterHeure(j.prevu, fuseau);
  if (j.mesure === null || j.ecart_min === null) return aujourdhui ? `prévu ${prevu}, pas encore mesuré` : `prévu ${prevu}, pas de mesure`;
  if (Math.abs(j.ecart_min) <= TOLERANCE_MIN) return 'comme prévu';
  return `${formaterDuree(j.ecart_min)} plus ${j.ecart_min > 0 ? 'tard' : 'tôt'} que prévu (${prevu})`;
}

export function CarteRegularite({ statut }: { statut: ReponseStatut }) {
  const levers = statut.levers;
  if (!levers) return null;
  const fuseau = statut.journee.fuseau;
  const resume = resumeLevers(levers, fuseau);

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sunrise className="text-muted-foreground size-4" /> Régularité des levers
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm">
          <span className="text-muted-foreground">Levers sur {levers.jours.length} jours : </span>
          <span className={cn('font-medium', resume.classe)}>
            {resume.morceaux.map((m, i) => (
              <span key={m}>
                {i > 0 ? ' · ' : null}
                <span className="whitespace-nowrap">{m}</span>
              </span>
            ))}
          </span>
        </p>
        <ul className="grid gap-1.5 text-sm" aria-label="Lever de chaque jour">
          {levers.jours.map((j) => {
            const aujourdhui = j.date === statut.journee.date;
            return (
              <li key={j.date} className="grid grid-cols-[6.5rem_3.25rem_1fr] items-baseline gap-x-2">
                <span className="text-muted-foreground truncate">{aujourdhui ? "aujourd'hui" : formaterDateCourte(j.date)}</span>
                <span className={cn('font-medium tabular-nums', j.mesure === null && 'text-muted-foreground')}>
                  {j.mesure === null ? '–' : formaterHeure(j.mesure, fuseau)}
                </span>
                <span className="text-muted-foreground min-w-0 text-xs">{detailLever(j, fuseau, aujourdhui)}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
