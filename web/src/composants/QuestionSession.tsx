import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { Question, SessionOuverte } from '@/api/contrat';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useFocus, useHeureServeur } from '@/hooks/useFocus';
import { etatQuestion } from '@/lib/attente';
import { formaterSecondes } from '@/lib/temps';
import { ErreurAffichee } from './ErreurAffichee';

export function QuestionSession({ session, question }: { session: SessionOuverte; question: Question }) {
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
      await rafraichir();
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <section aria-label="Question en attente" className="border-avertissement/60 bg-avertissement/10 grid gap-3 rounded-lg border p-4">
      <p className="font-medium">{session.tache ? `Toujours sur « ${session.tache.nom} » ?` : 'Toujours en session ?'}</p>
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {etat.expiree
          ? 'Question expirée : la session est fermée.'
          : `Sans réponse, la session se ferme dans ${formaterSecondes(etat.avantExpirationS)}.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void repondre('continue')} disabled={!etat.peutContinuer || envoi !== null}>
          {etat.peutContinuer || etat.expiree ? 'Je continue' : `Je continue (${etat.avantContinuerS} s)`}
        </Button>
        {/* « J'arrête » n'attend jamais : seul l'envoi en cours de cette même réponse le bloque. */}
        <Button variant="outline" onClick={() => void repondre('arrete')} disabled={envoi === 'arrete'}>
          J'arrête
        </Button>
      </div>
      <ErreurAffichee erreur={erreur} />
    </section>
  );
}
