import { Loader2, Lock } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { ErreurAffichee } from '@/composants/ErreurAffichee';
import { FenetreAdaptative } from '@/composants/FenetreAdaptative';
import { useFocus, useHeureServeur, useStatut } from '@/hooks/useFocus';
import { versInstant } from '@/lib/temps';

/**
 * L'appel de « Je vais dormir » : exception `avancer_coucher`, la nuit commence maintenant.
 * Partagé avec la proposition de rattraper le sommeil (« Me coucher maintenant »).
 */
export function useJeVaisDormir(surSucces: () => void) {
  const { api, rafraichir } = useFocus();
  const { journee } = useStatut();
  const maintenant = useHeureServeur();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);

  async function confirmer() {
    setEnvoi(true);
    setErreur(null);
    try {
      await api.enregistrerException({ demande: { type: 'avancer_coucher', nuit: journee.date, a: versInstant(maintenant) } });
      toast.success('Bonne nuit', { description: 'La nuit a commencé.' });
      await rafraichir();
      surSucces();
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setEnvoi(false);
    }
  }

  return { envoi, erreur, setErreur, confirmer };
}

/** Confirmation de « Je vais dormir ». */
export function JeVaisDormir({ ouverte, surChangement }: { ouverte: boolean; surChangement: (ouverte: boolean) => void }) {
  const { envoi, erreur, setErreur, confirmer } = useJeVaisDormir(() => surChangement(false));

  return (
    <FenetreAdaptative
      ouverte={ouverte}
      surChangement={(o) => {
        setErreur(null);
        surChangement(o);
      }}
      titre="Je vais dormir"
      description="La nuit commence maintenant."
      pied={
        <>
          <Button variant="outline" onClick={() => surChangement(false)} disabled={envoi}>
            Annuler
          </Button>
          <Button onClick={() => void confirmer()} disabled={envoi} className="bg-mode-nuit hover:bg-mode-nuit/90 text-white">
            {envoi ? <Loader2 className="animate-spin" /> : null}
            Commencer la nuit
          </Button>
        </>
      }
    >
      <div className="bg-mode-nuit/10 border-mode-nuit/30 flex items-center gap-3 rounded-xl border p-4">
        <Lock className="text-mode-nuit size-5 shrink-0" />
        <p className="text-sm font-medium">Le PC se verrouille dans moins d'une minute.</p>
      </div>
      <ErreurAffichee erreur={erreur} />
    </FenetreAdaptative>
  );
}
