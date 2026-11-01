import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SessionOuverte } from '@/api/contrat';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useAppsBloquees } from '@/hooks/useAppsBloquees';
import { useFocus, useHeureServeur, useStatut } from '@/hooks/useFocus';
import { formaterHeureRelative } from '@/lib/temps';
import { ErreurAffichee } from './ErreurAffichee';
import { Selecteur } from './formulaire';
import { QuestionSession } from './QuestionSession';

export function CarteSession({ session }: { session: SessionOuverte }) {
  const { api, rafraichir } = useFocus();
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const [ajout, setAjout] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);

  const appsAppareil = useAppsBloquees(statut.appareils.find((a) => a.appareil === session.appareil)).apps ?? [];
  const nomApp = (id: string) => appsAppareil.find((a) => a.id === id)?.nom ?? id;
  const ajoutables = appsAppareil.filter((a) => !session.apps.includes(a.id));

  async function agir(action: () => Promise<void>) {
    setEnCours(true);
    setErreur(null);
    try {
      await action();
      await rafraichir();
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{session.tache?.nom ?? 'Session sans tâche'}</CardTitle>
        <CardDescription>
          {session.appareil} · ouverte à {formaterHeureRelative(session.ouverte_le, statut.journee.fuseau, maintenant)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-1.5">
          {session.apps.map((id) => (
            <Badge key={id} variant="secondary">
              {nomApp(id)}
            </Badge>
          ))}
        </div>
        {session.question ? <QuestionSession session={session} question={session.question} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          {ajoutables.length > 0 ? (
            <>
              <Selecteur aria-label="App à ajouter" className="w-auto min-w-40 flex-1" value={ajout} onChange={(e) => setAjout(e.target.value)}>
                <option value="">Ajouter une app…</option>
                {ajoutables.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nom}
                  </option>
                ))}
              </Selecteur>
              <Button
                variant="secondary"
                disabled={!ajout || enCours}
                onClick={() =>
                  void agir(async () => {
                    await api.ajouterApp(session.id, ajout);
                    setAjout('');
                  })
                }
              >
                Ajouter
              </Button>
            </>
          ) : null}
          <Button variant="ghost" className="text-destructive ml-auto" disabled={enCours} onClick={() => void agir(() => api.fermerSession(session.id))}>
            Fermer la session
          </Button>
        </div>
        <ErreurAffichee erreur={erreur} />
      </CardContent>
    </Card>
  );
}
