import { cn } from '@/lib/utils';
import { ECRANS, type Ecran, LISTE_ECRANS } from './navigation';

/** Barre d'onglets fixe en bas, au téléphone seulement. */
export function OngletsBas({ ecran, allerA, indicateurs }: { ecran: Ecran; allerA: (e: Ecran) => void; indicateurs: Partial<Record<Ecran, string>> }) {
  return (
    <nav
      aria-label="Écrans"
      className="bg-background/90 fixed inset-x-0 bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-2">
        {LISTE_ECRANS.map((e) => {
          const { libelle, icone: Icone } = ECRANS[e];
          const actif = ecran === e;
          return (
            <li key={e}>
              <button
                type="button"
                aria-current={actif ? 'page' : undefined}
                onClick={() => allerA(e)}
                className={cn(
                  'relative flex w-full flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium transition-colors',
                  actif ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', actif && 'bg-accent')}>
                  <Icone className="size-5" />
                </span>
                {libelle}
                {indicateurs[e] ? (
                  <span aria-label={indicateurs[e]} className="bg-avertissement ring-background absolute top-2 left-[calc(50%+0.6rem)] size-2 rounded-full ring-2" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
