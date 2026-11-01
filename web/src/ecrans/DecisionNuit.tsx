import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormulaireException } from '@/composants/FormulaireException';
import { useHeureServeur, useStatut } from '@/hooks/useFocus';
import { formaterHeureRelative } from '@/lib/temps';

export function EcranDecisionNuit() {
  const { journee: j } = useStatut();
  const maintenant = useHeureServeur();
  const ouverte = maintenant >= Date.parse(j.ouverture);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Décision de nuit</CardTitle>
        <CardDescription>
          Décaler le coucher après l'ouverture de la soirée ({formaterHeureRelative(j.ouverture, j.fuseau, maintenant)}) : une raison
          d'au moins 50 caractères et la phrase exacte. <strong>Une fois par nuit.</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {j.decisionDeNuitPrise ? (
          <Alert variant="destructive">
            <AlertTitle>Déjà prise cette nuit</AlertTitle>
            <AlertDescription>
              <p>La décision de nuit ne se prend qu'une fois par nuit.</p>
            </AlertDescription>
          </Alert>
        ) : null}
        {!ouverte && !j.decisionDeNuitPrise ? (
          <Alert>
            <AlertTitle>La soirée n'est pas encore ouverte</AlertTitle>
            <AlertDescription>
              <p>Avant l'ouverture, décaler le coucher passe par l'écran Exceptions, sans friction, tant que le sommeil reste au-dessus du minimum.</p>
            </AlertDescription>
          </Alert>
        ) : null}
        <FormulaireException typeImpose="coucher" decisionDeNuit />
      </CardContent>
    </Card>
  );
}
