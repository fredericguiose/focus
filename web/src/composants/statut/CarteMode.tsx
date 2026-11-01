import { Briefcase, CircleHelp, Moon, Sunrise, Sunset, type LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { ReponseStatut } from '@/api/contrat';
import { libelleAppareil } from '@/lib/appareils';
import { prochainRepere, reperes } from '@/lib/journee';
import { type FamilleMode, infoMode, raisonLisible, STYLES_FAMILLE } from '@/lib/modes';
import { formaterDuree, formaterHeureRelative } from '@/lib/temps';
import { cn } from '@/lib/utils';

export const ICONES_FAMILLE: Record<FamilleMode, LucideIcon> = {
  nuit: Moon,
  matin: Sunrise,
  travail: Briefcase,
  soiree: Sunset,
  inconnu: CircleHelp,
};

/** Grande carte « mode actuel » : mode, temps restant avant le prochain changement, raison. */
export function CarteMode({ statut, maintenant }: { statut: ReponseStatut; maintenant: number }) {
  const j = statut.journee;
  const principal = statut.appareils[0];
  const mode = infoMode(principal?.mode ?? '');
  const styles = STYLES_FAMILLE[mode.famille];
  const Icone = ICONES_FAMILLE[mode.famille];
  const repere = prochainRepere(j, maintenant);
  const echeanceMs = principal?.jusqua ? Date.parse(principal.jusqua) : (repere?.ms ?? null);
  const restantMin = echeanceMs === null ? null : Math.max(0, (echeanceMs - maintenant) / 60_000);
  // Début du segment en cours : le dernier repère passé de la journée.
  const debutMs = [...reperes(j)].reverse().find((r) => r.ms <= maintenant)?.ms ?? null;
  const progression =
    debutMs !== null && echeanceMs !== null && echeanceMs > debutMs ? Math.min(100, ((maintenant - debutMs) / (echeanceMs - debutMs)) * 100) : null;
  const autres = statut.appareils.slice(1).filter((a) => a.mode !== principal?.mode);

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
              <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Mode actuel</span>
              <span className={cn('text-2xl font-semibold tracking-tight', styles.texte)}>{mode.libelle}</span>
            </div>
          </div>
          {principal ? <p className="text-foreground/80 max-w-prose text-sm text-pretty">{raisonLisible(principal.raison)}</p> : null}
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="bg-background/60">
              Sessions {principal?.sessions === 'interdites' ? 'interdites' : 'autorisées'}
            </Badge>
            {autres.map((a) => (
              <Badge key={a.appareil} variant="outline" className="bg-background/60">
                {libelleAppareil(a)} : {infoMode(a.mode).libelle}
              </Badge>
            ))}
          </div>
        </div>
        {restantMin !== null && echeanceMs !== null ? (
          <div className="grid gap-0.5 md:text-right">
            <span className="text-muted-foreground text-xs font-medium">
              {repere && !principal?.jusqua ? repere.libelle : 'Prochain changement'} à {formaterHeureRelative(new Date(echeanceMs).toISOString(), j.fuseau, maintenant)}
            </span>
            <span className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{formaterDuree(restantMin)}</span>
            <span className="text-muted-foreground text-xs">restant</span>
          </div>
        ) : null}
        </div>
        {progression !== null && debutMs !== null ? (
          <div className="grid gap-2">
            <Progress value={progression} aria-label="Avancement du mode en cours" className={cn('h-2 bg-background/70', styles.indicateur)} />
            <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
              <span>depuis {formaterHeureRelative(new Date(debutMs).toISOString(), j.fuseau, maintenant)}</span>
              <span>{Math.round(progression)} %</span>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
