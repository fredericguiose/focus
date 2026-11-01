import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Journee } from '@/api/contrat';
import { positionSurFrise, reperes } from '@/lib/journee';
import { formaterEcart, formaterHeure, heureLocale } from '@/lib/temps';
import { cn } from '@/lib/utils';

const COULEUR_REPERE = {
  lever: 'bg-mode-matin',
  ouverture: 'bg-mode-soiree',
  coucher: 'bg-mode-nuit',
  leverSuivant: 'bg-mode-matin',
} as const;

/** Frise lever → ouverture de la soirée → coucher → lever suivant, avec un repère « maintenant ». */
export function FriseJournee({ journee: j, maintenant }: { journee: Journee; maintenant: number }) {
  const liste = reperes(j);
  const pos = (ms: number) => positionSurFrise(j, ms) * 100;
  const [lever, ouverture, coucher] = liste;
  const segments = [
    { debut: lever?.ms ?? 0, fin: ouverture?.ms ?? 0, classe: 'bg-mode-travail/70', nom: 'Journée' },
    { debut: ouverture?.ms ?? 0, fin: coucher?.ms ?? 0, classe: 'bg-mode-soiree/70', nom: 'Soirée' },
    { debut: coucher?.ms ?? 0, fin: Date.parse(j.leverSuivant), classe: 'bg-mode-nuit/70', nom: 'Nuit' },
  ];
  const maintenantPos = pos(maintenant);

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle>Frise de la journée</CardTitle>
        <CardDescription>Du lever au lever suivant</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="relative pt-7">
          <div
            className="bg-foreground text-background absolute top-0 -translate-x-1/2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums shadow-sm"
            style={{ left: `clamp(1.5rem, ${maintenantPos}%, calc(100% - 1.5rem))` }}
          >
            {heureLocale(maintenant, j.fuseau)}
          </div>
          <div className="bg-muted relative flex h-3 overflow-hidden rounded-full" role="img" aria-label="Frise de la journée">
            {segments.map((s) => (
              <div
                key={s.nom}
                className={cn('h-full', s.classe)}
                style={{ width: `${Math.max(0, pos(s.fin) - pos(s.debut))}%` }}
                title={s.nom}
              />
            ))}
            <div className="bg-background/55 absolute inset-y-0 right-0" style={{ left: `${maintenantPos}%` }} />
          </div>
          <div className="bg-foreground absolute top-5 bottom-[-6px] w-0.5 -translate-x-1/2 rounded-full" style={{ left: `${maintenantPos}%` }} aria-hidden />
          {liste.slice(1, 3).map((r) => (
            <Tooltip key={r.cle}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`${r.libelle} : ${formaterHeure(new Date(r.ms).toISOString(), j.fuseau)}`}
                  className={cn('ring-background absolute top-[1.625rem] size-4 -translate-x-1/2 rounded-full ring-3', COULEUR_REPERE[r.cle])}
                  style={{ left: `${pos(r.ms)}%` }}
                />
              </TooltipTrigger>
              <TooltipContent>
                {r.libelle} · {formaterHeure(new Date(r.ms).toISOString(), j.fuseau)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {liste.map((r) => {
            const passe = r.ms <= maintenant;
            return (
              <li key={r.cle} className={cn('grid gap-0.5 rounded-lg border px-3 py-2.5', passe && 'bg-muted/40')}>
                <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                  <span className={cn('size-2 rounded-full', COULEUR_REPERE[r.cle])} />
                  {r.libelle}
                </span>
                <span className={cn('text-lg font-semibold tabular-nums', passe && 'text-muted-foreground')}>
                  {formaterHeure(new Date(r.ms).toISOString(), j.fuseau)}
                </span>
                <span className="text-muted-foreground text-xs">{passe ? 'passé' : formaterEcart(r.ms - maintenant)}</span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
