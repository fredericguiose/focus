import { ArrowRight, CircleCheck, CircleX, PenLine, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { PrixException } from '@/api/contrat';
import { formaterDuree, formaterHeureRelative } from '@/lib/temps';

/** Minutes de sommeil entre un coucher et un lever (instants ISO). */
const sommeil = (coucher: string, lever: string) => Math.round((Date.parse(lever) - Date.parse(coucher)) / 60000);
import { phrase } from '@/lib/texte';
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

const BADGES_FRICTION = { raison: 'Raison exigée', raison_phrase: 'Décision de nuit : raison et phrase' } as const;

/** Ce qui manque encore quand seule la justification fait défaut : rien n'est refusé. */
function aJustifier(friction: PrixException['friction']): string {
  return friction === 'raison_phrase'
    ? "Pour valider, écrivez ci-dessous une raison d'au moins 50 caractères et recopiez la phrase."
    : "Pour valider, écrivez ci-dessous une raison d'au moins 50 caractères.";
}

/**
 * `frictionValide` : la raison (et la phrase) saisies suffisent. L'aperçu est demandé sans elles :
 * un refus qui ne porte que sur la justification (`frictionManquante`) n'est donc pas un refus.
 */
export function ApercuPrix({
  prix,
  calcul,
  fuseau,
  maintenantMs,
  frictionValide = false,
}: {
  prix: PrixException | null;
  calcul: boolean;
  fuseau: string;
  maintenantMs: number;
  frictionValide?: boolean;
}) {
  if (!prix) {
    return (
      <section aria-label="Prix du changement" className="bg-muted/40 grid gap-3 rounded-xl border border-dashed p-4">
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
  const enAttente = !prix.admissible && prix.frictionManquante === true;
  const refuse = !prix.admissible && !enAttente;
  const sansEffet = prix.coucherAvant === prix.coucherApres && prix.leverAvant === prix.leverApres;
  return (
    <section
      aria-label="Prix du changement"
      aria-live="polite"
      className={cn('grid gap-3 rounded-xl border p-4', refuse ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/40')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Prix</span>
        {prix.admissible || (enAttente && frictionValide) ? (
          <Badge variant="outline" className="text-succes border-succes/40">
            <CircleCheck /> {sansEffet ? 'Sans effet sur la nuit : accepté' : prix.resserre ? 'Plus strict : toujours accepté' : 'Accepté'}
          </Badge>
        ) : enAttente ? (
          <Badge variant="outline">
            <PenLine /> À justifier
          </Badge>
        ) : (
          <Badge variant="destructive">
            <CircleX /> Refusé
          </Badge>
        )}
        {prix.friction !== 'aucune' ? (
          <Badge variant="outline" className="text-avertissement border-avertissement/40">
            <ShieldAlert /> {BADGES_FRICTION[prix.friction]}
          </Badge>
        ) : (
          <Badge variant="secondary">Sans justification</Badge>
        )}
      </div>
      <div className="divide-y overflow-hidden rounded-lg border sm:grid sm:grid-cols-3 sm:gap-2 sm:divide-y-0 sm:overflow-visible sm:rounded-none sm:border-0">
        <Comparaison terme="Coucher" avant={heure(prix.coucherAvant)} apres={heure(prix.coucherApres)} alerte={!prix.resserre} />
        <Comparaison terme="Lever" avant={heure(prix.leverAvant)} apres={heure(prix.leverApres)} />
        <Comparaison
          terme="Sommeil prévu"
          avant={formaterDuree(sommeil(prix.coucherAvant, prix.leverAvant))}
          apres={formaterDuree(sommeil(prix.coucherApres, prix.leverApres))}
          alerte={sommeil(prix.coucherApres, prix.leverApres) < sommeil(prix.coucherAvant, prix.leverAvant)}
        />
      </div>
      {prix.leverPlafonne ? (
        <p className="text-avertissement text-sm">
          Lever ramené à {heure(prix.leverApres)} au lieu de {heure(prix.leverPlafonne.voulu)} :{' '}
          {prix.leverPlafonne.cause === 'reveil_libre'
            ? 'plafond du réveil libre.'
            : "règle des levers réguliers (écart maximal avec les levers de la semaine)."}
        </p>
      ) : null}
      {prix.friction === 'raison_phrase' && !refuse ? (
        <p className="text-avertissement text-sm">Ce changement utilise votre décision de nuit : il n'y en a qu'une par nuit.</p>
      ) : null}
      {enAttente && !frictionValide ? <p className="text-muted-foreground text-sm">{aJustifier(prix.friction)}</p> : null}
      {refuse ? <p className="text-destructive text-sm font-medium">{prix.motifRefus ? `${phrase(prix.motifRefus.replace(/\.$/, ''))}.` : 'Changement refusé.'}</p> : null}
    </section>
  );
}
