import { Loader2, Target } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { API_SIMULEE, creerApi } from '@/api';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { ErreurAffichee } from '@/composants/ErreurAffichee';
import { Champ } from '@/composants/formulaire';

/** Saisie unique du jeton de l'interface, vérifié par une lecture du statut avant d'être gardé. */
export function Accueil({ onJeton }: { onJeton: (jeton: string) => void }) {
  const [jeton, setJeton] = useState('');
  const [verification, setVerification] = useState(false);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);

  async function valider() {
    const propre = jeton.trim();
    if (!propre) return;
    setVerification(true);
    setErreur(null);
    try {
      await creerApi(propre).statut();
      onJeton(propre);
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setVerification(false);
    }
  }

  return (
    <main className="bg-muted/40 grid min-h-dvh place-items-center p-4">
      <div className="grid w-full max-w-sm gap-6">
        <div className="flex items-center justify-center gap-2.5">
          <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
            <Target className="size-5" />
          </span>
          <span className="text-xl font-semibold tracking-tight">Focus</span>
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Connexion</CardTitle>
            <CardDescription>
              Collez le jeton de l'interface. Il reste enregistré sur cet appareil.
              {API_SIMULEE ? " Démonstration : n'importe quel jeton convient." : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void valider();
              }}
            >
              <Champ id="jeton" libelle="Jeton">
                <Input id="jeton" type="password" autoComplete="off" value={jeton} onChange={(e) => setJeton(e.target.value)} autoFocus />
              </Champ>
              <Button type="submit" disabled={!jeton.trim() || verification}>
                {verification ? <Loader2 className="animate-spin" /> : null}
                {verification ? 'Vérification…' : 'Se connecter'}
              </Button>
              <ErreurAffichee erreur={erreur} />
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
