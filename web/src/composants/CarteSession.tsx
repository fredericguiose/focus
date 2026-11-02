import { AppWindow, Clock, MessageCircleQuestion, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { SessionOuverte } from '@/api/contrat';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useAppsBloquees } from '@/hooks/useAppsBloquees';
import { useFocus, useHeureServeur, useStatut } from '@/hooks/useFocus';
import { questionPosee } from '@/lib/attente';
import { libelleAppareil } from '@/lib/appareils';
import { formaterDuree, formaterEcart, formaterHeureRelative } from '@/lib/temps';
import { ErreurAffichee } from './ErreurAffichee';
import { QuestionSession } from './QuestionSession';

export function CarteSession({ session }: { session: SessionOuverte }) {
  const { api, rafraichir } = useFocus();
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const fuseau = statut.journee.fuseau;
  const [ajout, setAjout] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);
  const [questionIgnoree, setQuestionIgnoree] = useState<string | null>(null);

  const appareil = statut.appareils.find((a) => a.appareil === session.appareil);
  const appsAppareil = useAppsBloquees(appareil).apps ?? [];
  const nomApp = (id: string) => appsAppareil.find((a) => a.id === id)?.nom ?? id;
  const ajoutables = appsAppareil.filter((a) => !session.apps.includes(a.id));
  const ecouleMin = Math.max(0, (maintenant - Date.parse(session.ouverte_le)) / 60_000);

  async function agir(action: () => Promise<void>, succes: string) {
    setEnCours(true);
    setErreur(null);
    try {
      await action();
      toast.success(succes);
      await rafraichir();
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setEnCours(false);
    }
  }

  // Une question pas encore posée (posee_a futur) n'est que l'heure de la prochaine.
  const question = session.question && questionPosee(session.question, maintenant) ? session.question : null;
  const prochaineQuestionA = session.question && !question ? session.question.posee_a : session.prochaine_question_a;
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base leading-snug">{session.tache?.nom ?? 'Session sans tâche'}</CardTitle>
        <CardDescription>
          {appareil ? libelleAppareil(appareil) : 'Appareil inconnu'} · depuis {formaterHeureRelative(session.ouverte_le, fuseau, maintenant)}
        </CardDescription>
        <CardAction>
          <Badge variant="secondary" className="tabular-nums">
            <Clock /> {formaterDuree(ecouleMin)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-1.5">
          {session.apps.map((id) => (
            <Badge key={id} variant="outline" className="gap-1.5">
              <AppWindow /> {nomApp(id)}
            </Badge>
          ))}
        </div>
        {question ? (
          <div className="border-avertissement/40 bg-avertissement/10 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
            <MessageCircleQuestion className="text-avertissement size-4" />
            <span className="flex-1 text-sm font-medium">Question en attente</span>
            <Button size="sm" onClick={() => setQuestionIgnoree(null)}>
              Répondre
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <MessageCircleQuestion className="size-4" />
            {prochaineQuestionA
              ? `Prochaine question ${formaterEcart(Date.parse(prochaineQuestionA) - maintenant)}`
              : 'Prochaine question après l’intervalle prévu'}
          </p>
        )}
        <ErreurAffichee erreur={erreur} />
      </CardContent>
      <Separator />
      <CardFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {ajoutables.length > 0 ? (
          <div className="flex min-w-0 flex-1 gap-2">
            <Select value={ajout} onValueChange={setAjout}>
              <SelectTrigger aria-label="App à ajouter" className="min-w-0 flex-1" size="sm">
                <SelectValue placeholder="Ajouter une app" />
              </SelectTrigger>
              <SelectContent>
                {ajoutables.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.nom}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!ajout || enCours}
              aria-label="Ajouter l'app"
              onClick={() =>
                void agir(async () => {
                  await api.ajouterApp(session.id, ajout);
                  setAjout('');
                }, 'App ajoutée à la session')
              }
            >
              <Plus />
            </Button>
          </div>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive sm:ml-auto"
          disabled={enCours}
          onClick={() => void agir(() => api.fermerSession(session.id), 'Session fermée')}
        >
          <X /> Fermer la session
        </Button>
      </CardFooter>
      {question ? (
        <QuestionSession
          session={session}
          question={question}
          ouverte={question.id !== questionIgnoree}
          surChangement={(o) => setQuestionIgnoree(o ? null : question.id)}
        />
      ) : null}
    </Card>
  );
}
