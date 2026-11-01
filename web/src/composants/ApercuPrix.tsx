import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type { PrixException } from '@/api/contrat';
import { formaterDette, formaterHeureRelative } from '@/lib/temps';
import { Ligne, Lignes } from './formulaire';

function Avant({ avant, apres }: { avant: string; apres: string }) {
  if (avant === apres) return <>{apres}</>;
  return (
    <>
      <span className="text-muted-foreground line-through">{avant}</span> → {apres}
    </>
  );
}

export function ApercuPrix({ prix, fuseau, maintenantMs }: { prix: PrixException; fuseau: string; maintenantMs: number }) {
  const heure = (instant: string) => formaterHeureRelative(instant, fuseau, maintenantMs);
  return (
    <section aria-label="Prix de l'exception" className="bg-muted/50 grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Prix</span>
        <Badge variant={prix.resserre ? 'secondary' : 'outline'}>{prix.resserre ? 'Resserre : toujours permis' : 'Desserre'}</Badge>
        <Badge variant={prix.friction === 'aucune' ? 'secondary' : 'destructive'}>
          {prix.friction === 'aucune' ? 'Sans friction' : 'Raison + phrase exigées'}
        </Badge>
      </div>
      <Lignes>
        <Ligne terme="Coucher">
          <Avant avant={heure(prix.coucherAvant)} apres={heure(prix.coucherApres)} />
        </Ligne>
        <Ligne terme="Lever">
          <Avant avant={heure(prix.leverAvant)} apres={heure(prix.leverApres)} />
        </Ligne>
        <Ligne terme="Dette de la nuit">
          <Avant avant={formaterDette(prix.detteAvantMin)} apres={formaterDette(prix.detteApresMin)} />
        </Ligne>
      </Lignes>
      {prix.admissible ? null : (
        <Alert variant="destructive">
          <AlertTitle>Refusée</AlertTitle>
          <AlertDescription>
            <p>{prix.motifRefus ?? 'Exception non admissible.'}</p>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
