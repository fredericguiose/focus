import { useEffect, useRef, useState } from 'react';

/**
 * Compte à rebours annulable. Le temps restant est recalculé depuis l'échéance à chaque tic,
 * pas décrémenté : un onglet mis en arrière-plan (tics ralentis) ne raccourcit ni n'allonge l'attente.
 */
export function useCompteARebours(dureeS: number, auTerme: () => void) {
  const [echeance, setEcheance] = useState<number | null>(null);
  const [restantS, setRestantS] = useState(dureeS);
  const auTermeRef = useRef(auTerme);

  useEffect(() => {
    auTermeRef.current = auTerme;
  });

  useEffect(() => {
    if (echeance === null) return;
    let fini = false;
    const tic = () => {
      if (fini) return;
      const restant = Math.max(0, Math.ceil((echeance - Date.now()) / 1000));
      setRestantS(restant);
      if (restant === 0) {
        fini = true;
        setEcheance(null);
        auTermeRef.current();
      }
    };
    tic();
    const id = setInterval(tic, 200);
    return () => {
      fini = true;
      clearInterval(id);
    };
  }, [echeance]);

  return {
    actif: echeance !== null,
    restantS,
    lancer: () => {
      setRestantS(dureeS);
      setEcheance(Date.now() + dureeS * 1000);
    },
    annuler: () => {
      setEcheance(null);
      setRestantS(dureeS);
    },
  };
}
