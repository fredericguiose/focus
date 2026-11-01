import { Hourglass, Moon, Sunrise, Sunset } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { CarteActions } from '@/composants/actions/CarteActions';
import { AlerteEtiquettes } from '@/composants/statut/AlerteEtiquettes';
import { RattraperSommeil } from '@/composants/actions/RattraperSommeil';
import { CarteEngagements } from '@/composants/statut/CarteEngagements';
import { CarteRegularite } from '@/composants/statut/CarteRegularite';
import { CarteSommeil } from '@/composants/statut/CarteSommeil';
import { CarteMode } from '@/composants/statut/CarteMode';
import { Indicateur } from '@/composants/statut/Indicateur';
import { ParcoursJournee } from '@/composants/statut/ParcoursJournee';
import { TableauAppareils } from '@/composants/statut/TableauAppareils';
import { useHeureServeur, useStatut } from '@/hooks/useFocus';
import { formaterDuree, formaterEcart, formaterHeure } from '@/lib/temps';

export function EcranStatut() {
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const j = statut.journee;
  const coucherMs = Date.parse(j.coucherApplique);
  const cumul = statut.sessions_du_jour;

  return (
    <div className="grid gap-4 md:gap-6">
      <AlerteEtiquettes statut={statut} />
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2 [&>*]:h-full">
          <CarteMode statut={statut} maintenant={maintenant} />
        </div>
        <CarteActions statut={statut} />
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicateur
          titre="Coucher"
          icone={Moon}
          valeur={formaterHeure(j.coucherApplique, j.fuseau)}
          action={j.coucherApplique !== j.coucherPrevu ? <Badge variant="outline">décalé</Badge> : undefined}
          pied={coucherMs > maintenant ? formaterEcart(coucherMs - maintenant) : 'nuit en cours'}
        />
        <Indicateur
          titre="Ouverture de la soirée"
          icone={Sunset}
          valeur={formaterHeure(j.ouverture, j.fuseau)}
          pied={
            j.prixDuReportMin > 0 ? (
              <Badge variant="outline" className="text-avertissement border-avertissement/40">
                +{formaterDuree(j.prixDuReportMin)} de report
              </Badge>
            ) : (
              'aucun report'
            )
          }
        />
        <Indicateur
          titre="Lever"
          icone={Sunrise}
          valeur={formaterHeure(j.leverSuivant, j.fuseau)}
          pied={formaterEcart(Date.parse(j.leverSuivant) - maintenant)}
        />
        <Indicateur
          titre="Sessions du jour"
          icone={Hourglass}
          valeur={cumul ? formaterDuree(cumul.cumul_min) : `${statut.sessions.length}`}
          pied={
            cumul ? (
              <div className="grid w-full gap-1.5">
                <Progress value={Math.min(100, (cumul.cumul_min / cumul.plafond_min) * 100)} aria-label="Sessions du jour" className="h-1.5" />
                <span>sur {formaterDuree(cumul.plafond_min)}</span>
              </div>
            ) : (
              `ouverte${statut.sessions.length > 1 ? 's' : ''}`
            )
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3 lg:items-start">
        <div className="grid min-w-0 gap-4 md:gap-6">
          <ParcoursJournee statut={statut} maintenant={maintenant} />
          <CarteEngagements statut={statut} />
        </div>
        <div className="grid min-w-0 gap-4 md:gap-6 lg:col-span-2 [&>*]:min-w-0">
          <TableauAppareils appareils={statut.appareils} maintenant={maintenant} />
          <CarteSommeil statut={statut} />
          <CarteRegularite statut={statut} />
        </div>
      </div>
      <RattraperSommeil />
    </div>
  );
}

export function SqueletteStatut() {
  return (
    <div className="grid gap-4 md:gap-6" aria-label="Chargement du statut">
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        <Skeleton className="h-52 rounded-xl lg:col-span-2" />
        <Skeleton className="h-52 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="gap-3 py-5">
            <CardHeader className="gap-3 px-5">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-8 w-24" />
            </CardHeader>
            <CardContent className="px-5">
              <Skeleton className="h-3 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-52 rounded-xl" />
    </div>
  );
}
