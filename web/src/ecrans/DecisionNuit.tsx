import { CircleCheck, Lock, MoonStar, Sunset } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { EnTeteEcran } from '@/composants/EnTeteEcran';
import { FormulaireException } from '@/composants/FormulaireException';
import { useHeureServeur, useStatut } from '@/hooks/useFocus';
import { PHRASE_NUIT, RAISON_MIN } from '@/lib/decisionNuit';
import { formaterEcart, formaterHeure } from '@/lib/temps';

function Regle({ numero, children }: { numero: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm">
      <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{numero}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

export function EcranDecisionNuit() {
  const { journee: j } = useStatut();
  const maintenant = useHeureServeur();
  const ouvertureMs = Date.parse(j.ouverture);
  const ouverte = maintenant >= ouvertureMs;
  const prise = j.decisionDeNuitPrise;

  return (
    <div className="grid gap-6">
      <EnTeteEcran titre="Décision de nuit" description="Décaler le coucher une fois la soirée ouverte. Une fois par nuit." />

      <div className="grid gap-4 md:gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2 lg:self-start">
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5 font-medium">
              <MoonStar className="size-3.5" /> Ce soir
            </CardDescription>
            <CardTitle className="text-2xl tracking-tight">{prise ? 'Déjà prise ce soir' : ouverte ? 'Disponible' : 'Pas encore ouverte'}</CardTitle>
            <CardAction>
              {prise ? (
                <Badge variant="outline" className="text-destructive border-destructive/40">
                  <Lock /> utilisée
                </Badge>
              ) : (
                <Badge variant="outline" className="text-succes border-succes/40">
                  <CircleCheck /> 1 restante
                </Badge>
              )}
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-0.5 rounded-lg border px-3 py-2.5">
                <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                  <Sunset className="size-3.5" /> Ouverture
                </span>
                <span className="text-lg font-semibold tabular-nums">{formaterHeure(j.ouverture, j.fuseau)}</span>
                <span className="text-muted-foreground text-xs">{ouverte ? 'passée' : formaterEcart(ouvertureMs - maintenant)}</span>
              </div>
              <div className="grid gap-0.5 rounded-lg border px-3 py-2.5">
                <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                  <MoonStar className="size-3.5" /> Coucher
                </span>
                <span className="text-lg font-semibold tabular-nums">{formaterHeure(j.coucherApplique, j.fuseau)}</span>
                <span className="text-muted-foreground text-xs">{formaterEcart(Date.parse(j.coucherApplique) - maintenant)}</span>
              </div>
            </div>
            <Separator />
            <ol className="grid gap-3">
              <Regle numero={1}>Une raison d'au moins {RAISON_MIN} caractères.</Regle>
              <Regle numero={2}>
                La phrase exacte <span className="font-mono text-xs font-semibold">{PHRASE_NUIT}</span>, tapée à la main.
              </Regle>
              <Regle numero={3}>
                <strong>Une fois par nuit.</strong> Le sommeil doit rester au-dessus du plancher de nuit.
              </Regle>
            </ol>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Nouvelle heure de coucher</CardTitle>
            <CardDescription>Le prix s'affiche pendant la saisie.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {prise ? (
              <Alert variant="destructive">
                <Lock />
                <AlertTitle>Déjà prise ce soir</AlertTitle>
                <AlertDescription>La décision de nuit ne se prend qu'une fois par nuit.</AlertDescription>
              </Alert>
            ) : !ouverte ? (
              <Alert>
                <Sunset />
                <AlertTitle>La soirée n'est pas encore ouverte</AlertTitle>
                <AlertDescription>
                  Avant {formaterHeure(j.ouverture, j.fuseau)}, décaler le coucher passe par l'écran Exceptions, sans friction, tant que le sommeil reste au-dessus du minimum.
                </AlertDescription>
              </Alert>
            ) : null}
            <FormulaireException type="coucher" decisionDeNuit libelleValider="Prendre la décision de nuit" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
