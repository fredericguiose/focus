import type { ComponentProps, ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function Champ({ id, libelle, aide, children }: { id: string; libelle: string; aide?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{libelle}</Label>
      {children}
      {aide ? <div className="text-muted-foreground text-xs">{aide}</div> : null}
    </div>
  );
}

/** <select> natif aux couleurs de shadcn : meilleur au téléphone qu'un menu dessiné. */
export function Selecteur({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export function Lignes({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">{children}</dl>;
}

export function Ligne({ terme, children }: { terme: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{terme}</dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
    </>
  );
}
