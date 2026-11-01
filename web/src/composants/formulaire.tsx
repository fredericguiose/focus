import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';

export function Champ({ id, libelle, aide, children }: { id: string; libelle: string; aide?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{libelle}</Label>
      {children}
      {aide ? <div className="text-muted-foreground text-xs">{aide}</div> : null}
    </div>
  );
}
