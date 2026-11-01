import { ArrowRight, CircleCheck, CircleX, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { PrixException } from '@/api/contrat';
import { formaterDette, formaterHeureRelative } from '@/lib/temps';
import { cn } from '@/lib/utils';

function Comparaison({ terme, avant, apres, alerte = false }: { terme: string; avant: string; apres: string; alerte?: boolean }) {
  const change = avant !== apres;
  return (
    <div className="bg-background/60 flex items-center justify-between gap-3 px-3 py-2.5 sm:grid sm:justify-start sm:gap-1 sm:rounded-lg sm:border">
      <span className="text-muted-foreground text-xs font-medium">{terme}</span>
      <div className="flex flex-wrap items-center justify-end gap-x-1.5 text-sm font-semibold tabular-nums sm:justify-start">
        {change ? (
          <>
            <span className="text-muted-foreground font-normal line-through">{avant}</span>
            <ArrowRight className="text-muted-foreground size-3.5" aria-label="devient" />
          </>
        ) : null}
        <span className={cn(change && alerte && 'text-avertissement')}>{apres}</span>
      </div>
    </div>
  );
}

export function ApercuPrix({
  prix,
  calcul,
  fuseau,
  maintenantMs,
}: {
  prix: PrixException | null;
  calcul: boolean;
  fuseau: string;
  maintenantMs: number;
}) {
  if (!prix) {
    return (
      <section aria-label="Prix de l'exception" className="bg-muted/40 grid gap-3 rounded-xl border border-dashed p-4">
        {calcul ? (
          <>
            <Skeleton className="h-5 w-32" />
            <div className="grid gap-2 sm:grid-cols-3">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">Le prix s'affiche ici dès que la saisie est complète.</p>
        )}
      </section>
    );
  }
  const heure = (instant: string) => formaterHeureRelative(instant, fuseau, maintenantMs);
  return (
    <section
      aria-label="Prix de l'exception"
      aria-live="polite"
      className={cn('grid gap-3 rounded-xl border p-4', prix.admissible ? 'bg-muted/40' : 'border-destructive/40 bg-destructive/5')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Prix</span>
        {prix.admissible ? (
          <Badge variant="outline" className="text-succes border-succes/40">
            <CircleCheck /> {prix.resserre ? 'Resserre : toujours permis' : 'Admissible'}
          </Badge>
        ) : (
          <Badge variant="destructive">
            <CircleX /> Refusée
          </Badge>
        )}
        {prix.friction === 'raison_phrase' ? (
          <Badge variant="outline" className="text-avertissement border-avertissement/40">
            <ShieldAlert /> Raison + phrase exigées
          </Badge>
        ) : (
          <Badge variant="secondary">Sans friction</Badge>
        )}
      </div>
      <div className="divide-y overflow-hidden rounded-lg border sm:grid sm:grid-cols-3 sm:gap-2 sm:divide-y-0 sm:overflow-visible sm:rounded-none sm:border-0">
        <Comparaison terme="Coucher" avant={heure(prix.coucherAvant)} apres={heure(prix.coucherApres)} alerte={!prix.resserre} />
        <Comparaison terme="Lever" avant={heure(prix.leverAvant)} apres={heure(prix.leverApres)} />
        <Comparaison
          terme="Dette de la nuit"
          avant={formaterDette(prix.detteAvantMin)}
          apres={formaterDette(prix.detteApresMin)}
          alerte={prix.detteApresMin > prix.detteAvantMin}
        />
      </div>
      {prix.admissible ? null : <p className="text-destructive text-sm font-medium">{prix.motifRefus ?? 'Exception non admissible.'}</p>}
    </section>
  );
}
