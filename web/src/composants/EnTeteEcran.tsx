import type { ReactNode } from 'react';

export function EnTeteEcran({ titre, description, action }: { titre: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{titre}</h1>
        {description ? <p className="text-muted-foreground max-w-prose text-sm text-pretty">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
