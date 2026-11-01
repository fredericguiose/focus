import { Hourglass, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import type { Question, SessionOuverte } from '@/api/contrat';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useFocus, useHeureServeur } from '@/hooks/useFocus';
import { etatQuestion } from '@/lib/attente';
import { formaterSecondes } from '@/lib/temps';
import { ErreurAffichee } from './ErreurAffichee';

/** Question de session en Dialog. « J'arrête » n'attend jamais. */
export function QuestionSession({
  session,
  question,
  ouverte,
  surChangement,
}: {
  session: SessionOuverte;
  question: Question;
  ouverte: boolean;
  surChangement: (ouverte: boolean) => void;
}) {
  const { api, rafraichir } = useFocus();
  const maintenant = useHeureServeur();
  const etat = etatQuestion(question, maintenant);
  const [envoi, setEnvoi] = useState<'continue' | 'arrete' | null>(null);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);

  useEffect(() => {
    if (etat.expiree) void rafraichir();
  }, [etat.expiree, rafraichir]);

  async function repondre(reponse: 'continue' | 'arrete') {
    setEnvoi(reponse);
    setErreur(null);
    try {
      await api.repondre(session.id, { question_id: question.id, reponse });
      toast.success(reponse === 'continue' ? 'Session prolongée' : 'Session fermée');
      await rafraichir();
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setEnvoi(null);
    }
  }

  const ecouleS = question.attente_s - etat.avantContinuerS;
  const progression = question.attente_s === 0 ? 100 : Math.min(100, (ecouleS / question.attente_s) * 100);

  return (
    <Dialog open={ouverte} onOpenChange={surChangement}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="bg-avertissement/15 text-avertissement mb-1 flex size-10 items-center justify-center rounded-full">
            <Hourglass className="size-5" />
          </div>
          <DialogTitle className="text-xl">{session.tache ? `Toujours sur « ${session.tache.nom} » ?` : 'Toujours en session ?'}</DialogTitle>
          <DialogDescription aria-live="polite">
            {etat.expiree
              ? 'Question expirée : la session est fermée.'
              : `Sans réponse, la session se ferme dans ${formaterSecondes(etat.avantExpirationS)}.`}
          </DialogDescription>
        </DialogHeader>
        {question.attente_s > 0 && !etat.expiree ? (
          <div className="grid gap-2">
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>Attente avant de continuer</span>
              <span className="tabular-nums">{etat.peutContinuer ? 'terminée' : `${etat.avantContinuerS} s`}</span>
            </div>
            <Progress value={progression} aria-label="Attente avant de continuer" />
          </div>
        ) : null}
        <ErreurAffichee erreur={erreur} />
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => void repondre('arrete')} disabled={envoi === 'arrete'}>
            J'arrête
          </Button>
          <Button onClick={() => void repondre('continue')} disabled={!etat.peutContinuer || envoi !== null}>
            {envoi === 'continue' ? <Loader2 className="animate-spin" /> : null}
            {etat.peutContinuer || etat.expiree ? 'Je continue' : `Je continue (${etat.avantContinuerS} s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
