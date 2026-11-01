import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { API_SIMULEE, creerApi } from '@/api';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { ErreurAffichee } from '@/composants/ErreurAffichee';
import { Champ } from '@/composants/formulaire';

/** Saisie unique du jeton `interface`, vérifié par une lecture du statut avant d'être gardé. */
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
    <main className="mx-auto grid min-h-dvh max-w-md content-center p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Focus</CardTitle>
          <CardDescription>
            Collez le jeton <code>interface</code> (créé par <code>npm run jeton:creer -- interface &lt;nom&gt;</code>). Il reste sur cet
            appareil.
            {API_SIMULEE ? " Mode simulé : n'importe quel jeton convient." : ''}
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
              <Input
                id="jeton"
                type="password"
                autoComplete="off"
                value={jeton}
                onChange={(e) => setJeton(e.target.value)}
                autoFocus
              />
            </Champ>
            <Button type="submit" disabled={!jeton.trim() || verification}>
              {verification ? 'Vérification…' : 'Enregistrer'}
            </Button>
            <ErreurAffichee erreur={erreur} />
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
