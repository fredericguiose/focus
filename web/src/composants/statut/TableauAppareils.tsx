import { Laptop, Monitor, Smartphone, type LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SortieMode, StatutAppareil, TypeAppareil } from '@/api/contrat';
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

/** Quand le mode se termine : une phrase neutre, pas une icône d'état (ce n'est pas une erreur). */
function Sortie({ sortie }: { sortie: SortieMode }) {
  return (
    <span className="text-muted-foreground mt-1 block max-w-36 text-xs leading-snug sm:max-w-60">
      Se termine {sortie.texte}
    </span>
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
              <TableHead className="hidden text-right sm:table-cell">Dernier ping</TableHead>
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
                      <span className="grid gap-1">
                        {libelleAppareil(a)}
                        {/* Sur téléphone, le dernier ping passe sous le nom : la table tient en largeur. */}
                        <span className="sm:hidden">
                          <BadgePing appareil={a} maintenant={maintenant} />
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Badge variant="outline" className={cn('gap-1.5', styles.texte, styles.bordure)}>
                      <span className={cn('size-1.5 rounded-full', styles.fond)} aria-hidden />
                      {mode.libelle}
                    </Badge>
                    {a.sortie ? <Sortie sortie={a.sortie} /> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden sm:table-cell">{a.sessions === 'interdites' ? 'Interdites' : 'Autorisées'}</TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
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
