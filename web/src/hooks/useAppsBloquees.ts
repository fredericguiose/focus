import { useEffect, useState } from 'react';

import type { AppBloquee, StatutAppareil } from '@/api/contrat';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useFocus } from './useFocus';

/**
 * Apps bloquées sur un appareil. Rechargées seulement quand le mode ou ses actions changent,
 * pas à chaque relecture du statut.
 */
export function useAppsBloquees(appareil: StatutAppareil | undefined) {
  const { api } = useFocus();
  const [apps, setApps] = useState<AppBloquee[] | null>(null);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);
  const cle = appareil
    ? JSON.stringify([appareil.appareil, appareil.mode, appareil.actions ?? null, appareil.apps_bloquees ?? null])
    : '';

  useEffect(() => {
    if (!appareil) {
      setApps([]);
      return;
    }
    let annule = false;
    setApps(null);
    setErreur(null);
    api.appsBloquees(appareil).then(
      (liste) => {
        if (!annule) setApps(liste);
      },
      (e: unknown) => {
        if (!annule) setErreur(versErreurFocus(e));
      },
    );
    return () => {
      annule = true;
    };
    // `cle` résume `appareil` : l'objet change à chaque statut, son contenu rarement.
  }, [api, cle]);

  return { apps, erreur };
}
