import { Briefcase, Circle, CircleHelp, Moon, Sunrise, Sunset, type LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { ListeTachesBloquantes, ReponseStatut } from '@/api/contrat';
import { libelleAppareil } from '@/lib/appareils';
import { type FamilleMode, infoMode, raisonLisible, STYLES_FAMILLE } from '@/lib/modes';
import { STYLES_ETAT } from '@/lib/etats';
import { appareilPrincipal, ceQuiManque, type Manque, precisionTache, urlTacheTodoist } from '@/lib/parcours';
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
  const manque = sortie && !sortie.certaine ? ceQuiManque(principal, j, statut.taches_bloquantes) : [];
  const avecTaches = manque.some((m) => m.taches);
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
                Se termine {sortie.texte}
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
            <div
              className={cn('grid min-w-0 gap-1 md:text-right', avecTaches ? 'md:w-80' : 'md:max-w-64')}
              data-testid="sortie-incertaine"
            >
              <span className="text-muted-foreground text-xs font-medium">Pour en sortir</span>
              {manque.length > 0 ? (
                <ul className="grid min-w-0 gap-1">
                  {manque.map((m) => (m.taches ? (
                    <li key={m.texte} className="min-w-0">
                      <TachesQuiRetiennent manque={m} taches={m.taches} aujourdhui={j.date} />
                    </li>
                  ) : (
                    <LigneManque key={m.texte} manque={m} />
                  )))}
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

/** Un fait qui manque (planning, récap…) : une seule action, en gros. */
function LigneManque({ manque: m }: { manque: Manque }) {
  const { Icone, couleur, texte } = STYLES_ETAT[m.etat];
  return (
    <li className="flex items-start gap-2 text-xl font-semibold tracking-tight text-pretty sm:text-2xl md:flex-row-reverse md:text-right">
      <Icone className={cn('mt-1 size-5 shrink-0 sm:size-6', couleur)} aria-hidden />
      <span className="grid gap-0.5">
        <span>
          {m.texte}
          <span className="sr-only"> ({texte})</span>
        </span>
        {m.detail ? <span className="text-avertissement text-sm font-medium tracking-normal">{m.detail}</span> : null}
      </span>
    </li>
  );
}

/**
 * Condition de tâches (P1/P2, retards) : les tâches elles-mêmes plutôt que leur compte, déjà dans
 * le parcours. Les plus importantes d'abord (l'API trie), chacune ouvre la tâche dans Todoist.
 */
function TachesQuiRetiennent({ manque: m, taches, aujourdhui }: { manque: Manque; taches: ListeTachesBloquantes; aujourdhui: string }) {
  const reste = taches.total - taches.taches.length;
  return (
    <div className="grid min-w-0 gap-0.5" data-testid="taches-bloquantes">
      <ul className="grid min-w-0" aria-label={`${m.texte} (${STYLES_ETAT[m.etat].texte})`}>
        {taches.taches.map((t) => {
          const precision = precisionTache(t, aujourdhui);
          return (
            <li key={t.id} className="min-w-0">
              <a
                href={urlTacheTodoist(t.id)}
                target="_blank"
                rel="noopener noreferrer"
                title={t.titre}
                className="group hover:bg-background/60 focus-visible:ring-ring/50 -mx-2 flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-[3px]"
              >
                <Circle className="text-avertissement size-4 shrink-0" strokeWidth={2.5} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight underline-offset-4 group-hover:underline">
                  {t.titre}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-xs font-medium whitespace-nowrap',
                    t.en_retard ? 'text-avertissement' : 'text-muted-foreground',
                  )}
                >
                  {precision}
                </span>
                <span className="sr-only"> (ouvre la tâche dans Todoist, nouvel onglet)</span>
              </a>
            </li>
          );
        })}
      </ul>
      {reste > 0 ? (
        <span className="text-muted-foreground pl-[1.625rem] text-left text-sm">
          + {reste} {reste > 1 ? 'autres' : 'autre'}
        </span>
      ) : null}
    </div>
  );
}
