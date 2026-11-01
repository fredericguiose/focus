import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Journee } from '@/api/contrat';
import { construireFrise, type ClePeriode } from '@/lib/frise';
import { heureLocale } from '@/lib/temps';
import { cn } from '@/lib/utils';

// Classes écrites en entier pour Tailwind : mêmes couleurs que les modes.
const FOND: Record<ClePeriode, string> = {
  matin: 'bg-mode-matin',
  travail: 'bg-mode-travail',
  soiree: 'bg-mode-soiree',
  nuit: 'bg-mode-nuit',
};

const pct = (x: number) => `${x * 100}%`;

/** Frise lever → lever suivant : périodes nommées, repères avec l'heure dessous, « maintenant ». */
export function FriseJournee({
  journee: j,
  maintenant,
  modePrincipal,
  jusqua,
}: {
  journee: Journee;
  maintenant: number;
  modePrincipal?: string;
  jusqua?: string | null;
}) {
  const frise = construireFrise(j, maintenant, modePrincipal, jusqua);
  const heure = (ms: number) => heureLocale(ms, j.fuseau);
  const dernier = frise.reperes.length - 1;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Journée</CardTitle>
        <CardDescription>Du lever au lever suivant</CardDescription>
      </CardHeader>
      <CardContent>
        <figure aria-label="Frise de la journée" className="relative pt-8 pb-1">
          {frise.maintenant !== null ? (
            <>
              <div
                className="bg-foreground text-background absolute top-0 -translate-x-1/2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums shadow-sm"
                style={{ left: `clamp(2.75rem, ${pct(frise.maintenant)}, calc(100% - 2.75rem))` }}
              >
                Maintenant · {heure(maintenant)}
              </div>
              <div
                className="bg-foreground absolute top-6 z-10 h-12 w-0.5 -translate-x-1/2 rounded-full"
                style={{ left: pct(frise.maintenant) }}
                aria-hidden
              />
            </>
          ) : null}

          <div className="relative overflow-hidden rounded-lg">
          <ol className="flex h-9">
            {frise.periodes.map((p) => (
              <li
                key={p.cle}
                className={cn('flex min-w-0 items-center justify-center border-r-2 border-card px-1 last:border-r-0', FOND[p.cle])}
                style={{ width: pct(p.droite - p.gauche) }}
                title={`${p.nom} : ${heure(p.debut)} – ${heure(p.fin)}`}
              >
                <span className="truncate text-[11px] font-semibold text-white sm:text-xs">{p.nom}</span>
                <span className="sr-only">
                  {' '}
                  de {heure(p.debut)} à {heure(p.fin)}
                </span>
              </li>
            ))}
          </ol>
          </div>

          <ol className="relative mt-1 h-11" aria-label="Repères">
            {frise.reperes.map((r, i) => (
              <li
                key={r.cle}
                className={cn(
                  'absolute top-0 grid justify-items-center leading-tight',
                  i === 0 ? 'justify-items-start' : i === dernier ? '-translate-x-full justify-items-end' : '-translate-x-1/2',
                )}
                style={{ left: pct(r.position) }}
              >
                <span className="bg-foreground/60 h-2 w-px" aria-hidden />
                <span className="text-sm font-semibold tabular-nums">{heure(r.ms)}</span>
                <span className="text-muted-foreground text-[11px]">{r.libelle}</span>
              </li>
            ))}
          </ol>
        </figure>
      </CardContent>
    </Card>
  );
}
