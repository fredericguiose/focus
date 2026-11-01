import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CarteSession } from '@/composants/CarteSession';
import { OuvrirSession } from '@/composants/OuvrirSession';
import { useStatut } from '@/hooks/useFocus';
import { formaterDuree } from '@/lib/temps';

export function EcranSessions() {
  const { sessions, sessions_du_jour: cumul } = useStatut();
  return (
    <div className="grid gap-4">
      {cumul ? (
        <p className="text-muted-foreground text-sm">
          Sessions aujourd'hui : {formaterDuree(cumul.cumul_min)} sur {formaterDuree(cumul.plafond_min)}
        </p>
      ) : null}
      {sessions.length === 0 ? <p className="text-muted-foreground text-sm">Aucune session ouverte.</p> : null}
      {sessions.map((s) => (
        <CarteSession key={s.id} session={s} />
      ))}
      <Card>
        <CardHeader>
          <CardTitle>Ouvrir une session</CardTitle>
          <CardDescription>Débloque des apps pour une tâche du jour. Une question vient vérifier régulièrement que la tâche avance.</CardDescription>
        </CardHeader>
        <CardContent>
          <OuvrirSession />
        </CardContent>
      </Card>
    </div>
  );
}
