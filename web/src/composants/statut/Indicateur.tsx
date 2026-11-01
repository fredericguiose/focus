import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Carte indicateur à la manière des « section cards » du bloc dashboard-01. */
export function Indicateur({
  titre,
  valeur,
  icone: Icone,
  action,
  pied,
  classeValeur,
}: {
  titre: string;
  valeur: ReactNode;
  icone: LucideIcon;
  action?: ReactNode;
  pied?: ReactNode;
  classeValeur?: string;
}) {
  return (
    <Card className="@container/card gap-3 py-4 sm:py-5">
      <CardHeader className="px-4 sm:px-5">
        <CardDescription className="flex items-center gap-1.5 font-medium">
          <Icone className="size-3.5" />
          {titre}
        </CardDescription>
        <CardTitle className={cn('text-2xl font-semibold tracking-tight tabular-nums @[220px]/card:text-3xl', classeValeur)}>{valeur}</CardTitle>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      {pied ? <CardFooter className="text-muted-foreground px-4 text-xs sm:px-5 sm:text-sm">{pied}</CardFooter> : null}
    </Card>
  );
}
