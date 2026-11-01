import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { StatutAppareil } from '@/api/contrat';
import { Ligne, Lignes } from '@/composants/formulaire';
import { useHeureServeur, useStatut } from '@/hooks/useFocus';
import { formaterDate, formaterDette, formaterDuree, formaterHeure, formaterHeureRelative, ilYA } from '@/lib/temps';
import { cn } from '@/lib/utils';

// Un PC interroge l'API chaque minute, mais l'API n'enregistre le ping que toutes les 5 min :
// au-delà de 7 min, l'appareil est éteint, hors ligne ou en panne.
const PING_EN_RETARD_MS = 7 * 60_000;

function CarteAppareil({ appareil, fuseau, maintenant }: { appareil: StatutAppareil; fuseau: string; maintenant: number }) {
  const enRetard = appareil.vu_le === null || maintenant - Date.parse(appareil.vu_le) > PING_EN_RETARD_MS;
  return (
    <li className="grid gap-1.5 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{appareil.appareil}</span>
        <Badge variant={appareil.sessions === 'interdites' ? 'destructive' : 'secondary'}>{appareil.mode}</Badge>
        <span className="text-muted-foreground text-xs">sessions {appareil.sessions === 'interdites' ? 'interdites' : 'autorisées'}</span>
      </div>
      <p className="text-sm">{appareil.raison}</p>
      <p className="text-muted-foreground text-xs">
        {appareil.jusqua ? `Jusqu'à ${formaterHeureRelative(appareil.jusqua, fuseau, maintenant)} · ` : ''}
        <span className={cn(enRetard && 'text-avertissement font-medium')}>
          Dernier ping : {ilYA(appareil.vu_le, maintenant)}
          {appareil.vu_le ? ` (${formaterHeureRelative(appareil.vu_le, fuseau, maintenant)})` : ''}
        </span>
      </p>
    </li>
  );
}

export function EcranStatut() {
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const j = statut.journee;
  const heure = (instant: string) => formaterHeureRelative(instant, j.fuseau, maintenant);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Journée du {formaterDate(j.date)}</CardTitle>
          <CardDescription>
            Routine {j.routine} · heures de {j.fuseau}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Lignes>
            <Ligne terme="Lever">{heure(j.lever)}</Ligne>
            <Ligne terme="Ouverture de la soirée">
              {heure(j.ouverture)}
              {j.prixDuReportMin > 0 ? <span className="text-muted-foreground font-normal"> (dont {formaterDuree(j.prixDuReportMin)} de report)</span> : null}
            </Ligne>
            <Ligne terme="Prix du report">{j.prixDuReportMin > 0 ? formaterDuree(j.prixDuReportMin) : 'aucun'}</Ligne>
            <Ligne terme="Coucher">
              {heure(j.coucherApplique)}
              {j.coucherApplique !== j.coucherPrevu ? (
                <span className="text-muted-foreground font-normal"> (prévu {heure(j.coucherPrevu)})</span>
              ) : null}
            </Ligne>
            <Ligne terme="Lever suivant">{heure(j.leverSuivant)}</Ligne>
            <Ligne terme="Dette de la nuit">
              <span className={cn(j.detteNuitMin > 0 && 'text-avertissement')}>{formaterDette(j.detteNuitMin)}</span>
            </Ligne>
            <Ligne terme="Décision de nuit">{j.decisionDeNuitPrise ? 'déjà prise' : 'disponible'}</Ligne>
            <Ligne terme="Engagements">{j.engagements.length > 0 ? j.engagements.join(', ') : 'aucun'}</Ligne>
          </Lignes>
        </CardContent>
      </Card>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>Appareils</CardTitle>
        </CardHeader>
        <CardContent>
          <ul>
            {statut.appareils.map((a) => (
              <CarteAppareil key={a.appareil} appareil={a} fuseau={j.fuseau} maintenant={maintenant} />
            ))}
          </ul>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-center text-xs">
        Serveur : {formaterHeure(statut.heure_serveur, j.fuseau)} · config {statut.config_version ?? 'inconnue'}
      </p>
    </div>
  );
}
