import { Laptop, Monitor, Smartphone, type LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { StatutAppareil, TypeAppareil } from '@/api/contrat';
import { type EtatPing, etatPing, libelleAppareil } from '@/lib/appareils';
import { infoMode, STYLES_FAMILLE } from '@/lib/modes';
import { ilYA } from '@/lib/temps';
import { cn } from '@/lib/utils';

const ICONES: Record<TypeAppareil, LucideIcon> = { pc_linux: Laptop, pc_windows: Monitor, iphone: Smartphone };

export const STYLES_PING: Record<EtatPing, { point: string; badge: string; libelle: string }> = {
  recent: { point: 'bg-succes', badge: 'text-succes border-succes/40', libelle: 'en ligne' },
  retard: { point: 'bg-avertissement', badge: 'text-avertissement border-avertissement/40', libelle: 'en retard' },
  absent: { point: 'bg-destructive', badge: 'text-destructive border-destructive/40', libelle: 'hors ligne' },
};

export function BadgePing({ appareil, maintenant }: { appareil: StatutAppareil; maintenant: number }) {
  const etat = etatPing(appareil.vu_le, maintenant);
  const s = STYLES_PING[etat];
  return (
    <Badge variant="outline" className={cn('gap-1.5 tabular-nums', s.badge)} title={s.libelle}>
      <span className={cn('size-1.5 rounded-full', s.point)} aria-hidden />
      {ilYA(appareil.vu_le, maintenant)}
      <span className="sr-only"> ({s.libelle})</span>
    </Badge>
  );
}

export function TableauAppareils({ appareils, maintenant }: { appareils: StatutAppareil[]; maintenant: number }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Appareils</CardTitle>
        <CardDescription>Mode appliqué et dernier signe de vie</CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Appareil</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="hidden sm:table-cell">Sessions</TableHead>
              <TableHead className="text-right">Dernier ping</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appareils.map((a) => {
              const Icone = ICONES[a.type];
              const mode = infoMode(a.mode);
              const styles = STYLES_FAMILLE[mode.famille];
              return (
                <TableRow key={a.appareil}>
                  <TableCell>
                    <span className="flex items-center gap-2 font-medium">
                      <span className="bg-muted flex size-7 items-center justify-center rounded-md">
                        <Icone className="size-4" />
                      </span>
                      {libelleAppareil(a)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn('gap-1.5', styles.texte, styles.bordure)}>
                      <span className={cn('size-1.5 rounded-full', styles.fond)} aria-hidden />
                      {mode.libelle}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden sm:table-cell">{a.sessions === 'interdites' ? 'Interdites' : 'Autorisées'}</TableCell>
                  <TableCell className="text-right">
                    <BadgePing appareil={a} maintenant={maintenant} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
