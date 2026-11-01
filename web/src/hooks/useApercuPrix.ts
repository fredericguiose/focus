import { useEffect, useRef, useState } from 'react';

import type { DemandeException, PrixException } from '@/api/contrat';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useFocus } from './useFocus';

/** Délai après la dernière frappe avant de demander le prix. */
export const DELAI_APERCU_MS = 350;

/**
 * Prix de l'exception recalculé pendant la saisie, sans bouton. `cle` identifie la demande :
 * l'instant de « Je vais dormir » change chaque seconde mais ne doit pas relancer la requête.
 */
export function useApercuPrix(cle: string | null, construire: () => DemandeException | null) {
  const { api } = useFocus();
  const [prix, setPrix] = useState<PrixException | null>(null);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);
  const [calcul, setCalcul] = useState(false);
  const construireRef = useRef(construire);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    construireRef.current = construire;
  });

  useEffect(() => {
    setPrix(null);
    setErreur(null);
    if (cle === null) {
      setCalcul(false);
      return;
    }
    let annule = false;
    setCalcul(true);
    const id = setTimeout(() => {
      const demande = construireRef.current();
      if (!demande) {
        setCalcul(false);
        return;
      }
      api.prixException({ demande }).then(
        (p) => {
          if (annule) return;
          setPrix(p);
          setCalcul(false);
        },
        (e: unknown) => {
          if (annule) return;
          setErreur(versErreurFocus(e));
          setCalcul(false);
        },
      );
    }, DELAI_APERCU_MS);
    return () => {
      annule = true;
      clearTimeout(id);
    };
  }, [api, cle, version]);

  return { prix, erreur, calcul, recalculer: () => setVersion((v) => v + 1) };
}
