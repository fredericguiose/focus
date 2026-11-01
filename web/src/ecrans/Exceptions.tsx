import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormulaireException } from '@/composants/FormulaireException';

export function EcranExceptions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exception</CardTitle>
        <CardDescription>
          Resserrer (coucher plus tôt, engagement ajouté ou avancé) est toujours permis. Desserrer après l'ouverture de la soirée
          exige la décision de nuit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormulaireException />
      </CardContent>
    </Card>
  );
}
