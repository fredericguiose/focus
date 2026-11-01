import { Briefcase, CircleHelp, Moon, Sunrise, Sunset, type LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { ReponseStatut } from '@/api/contrat';
import { libelleAppareil } from '@/lib/appareils';
import { type FamilleMode, infoMode, raisonLisible, STYLES_FAMILLE } from '@/lib/modes';
import { appareilPrincipal, ceQuiManque } from '@/lib/parcours';
import { formaterDuree, formaterHeureRelative } from '@/lib/temps';
import { cn } from '@/lib/utils';

export const ICONES_FAMILLE: Record<FamilleMode, LucideIcon> = {
  nuit: Moon,
  matin: Sunrise,
  travail: Briefcase,
  soiree: Sunset,
  inconnu: CircleHelp,
};

/**
 * Grande carte « mode actuel » de l'appareil principal (les autres sont dans le tableau). Le compte à
 * rebours n'apparaît que si l'API dit la sortie certaine ; sinon on montre ce qui manque.
 */
export function CarteMode({ statut, maintenant }: { statut: ReponseStatut; maintenant: number }) {
  const j = statut.journee;
  const principal = appareilPrincipal(statut);
  const mode = infoMode(principal?.mode ?? '');
  const styles = STYLES_FAMILLE[mode.famille];
  const Icone = ICONES_FAMILLE[mode.famille];
  const sortie = principal?.sortie;
  const finMs = sortie ? Date.parse(sortie.au_plus_tard) : null;
  const restantMin = finMs === null ? null : Math.max(0, (finMs - maintenant) / 60_000);
  const manque = sortie && !sortie.certaine ? ceQuiManque(principal, j) : [];
  const heureFin = sortie ? formaterHeureRelative(sortie.au_plus_tard, j.fuseau, maintenant) : null;

  return (
    <Card className={cn('relative overflow-hidden border bg-gradient-to-br to-card py-0', styles.bordure, styles.degrade)}>
      <CardContent className="flex h-full flex-col justify-between gap-6 p-5 sm:p-6">
        <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
          <div className="grid gap-3">
            <div className="flex items-center gap-3">
              <span className={cn('flex size-11 items-center justify-center rounded-xl text-white shadow-sm', styles.fond)}>
                <Icone className="size-5" />
              </span>
              <div className="grid">
                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Mode actuel{principal ? ` · ${libelleAppareil(principal)}` : ''}
                </span>
                <span className={cn('text-2xl font-semibold tracking-tight', styles.texte)}>{mode.libelle}</span>
              </div>
            </div>
            {sortie ? (
              <p className="text-foreground/80 max-w-prose text-sm text-pretty">
                <span className="text-muted-foreground">Fin : </span>
                {sortie.texte}
              </p>
            ) : principal ? (
              <p className="text-foreground/80 max-w-prose text-sm text-pretty">{raisonLisible(principal.raison)}</p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="bg-background/60">
                Sessions {principal?.sessions === 'interdites' ? 'interdites' : 'autorisées'}
              </Badge>
            </div>
          </div>
          {sortie && sortie.certaine && restantMin !== null ? (
            <div className="grid gap-0.5 md:text-right" data-testid="compte-a-rebours">
              <span className="text-muted-foreground text-xs font-medium">Jusqu'à {heureFin}</span>
              <span className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{formaterDuree(restantMin)}</span>
              <span className="text-muted-foreground text-xs">restant</span>
            </div>
          ) : sortie ? (
            <div className="grid gap-1 md:max-w-64 md:text-right" data-testid="sortie-incertaine">
              <span className="text-muted-foreground text-xs font-medium">Pour en sortir</span>
              {manque.length > 0 ? (
                <ul className="grid gap-0.5">
                  {manque.map((m) => (
                    <li key={m} className="text-2xl font-semibold tracking-tight text-pretty sm:text-3xl">
                      {m}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-xl font-semibold tracking-tight text-pretty">{sortie.texte}</span>
              )}
              <span className="text-muted-foreground text-xs tabular-nums">au plus tard {heureFin}</span>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
