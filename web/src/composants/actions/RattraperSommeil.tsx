import { useEffect, useState } from 'react';

import { useHeureServeur, useStatut } from '@/hooks/useFocus';
import { dejaProposee, marquerProposee, propositionPossible } from '@/lib/dette';
import { JeVaisDormir } from './JeVaisDormir';

/**
 * Proposition de rattraper la dette de sommeil (facultative) : la fenêtre « Je vais dormir »
 * s'ouvre seule une fois par soir, à la première ouverture du tableau de bord après l'ouverture de
 * la soirée, curseur sur l'heure suggérée. Refermée (« Plus tard », croix), elle ne revient pas ce
 * soir-là.
 */
export function RattraperSommeil() {
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const nuit = statut.journee.date;
  const possible = propositionPossible(statut, maintenant);
  const [ouverte, setOuverte] = useState(false);

  useEffect(() => {
    if (possible && !dejaProposee(nuit)) {
      marquerProposee(nuit);
      setOuverte(true);
    }
  }, [possible, nuit]);

  return <JeVaisDormir ouverte={ouverte} surChangement={setOuverte} origine="proposition" />;
}
