// Une seule règle de couleurs partout (parcours, carte du mode, tableau) :
// ✓ vert = fait ; ✗ orange = à faire, c'est ce qui bloque ; horloge grise = heure pas encore atteinte.
import { CircleCheck, CircleX, Clock, type LucideIcon } from 'lucide-react';

import type { ConditionParcours } from '@/api/contrat';

export type EtatFait = 'fait' | 'a_faire' | 'attente';

export const STYLES_ETAT: Record<EtatFait, { Icone: LucideIcon; couleur: string; texte: string }> = {
  fait: { Icone: CircleCheck, couleur: 'text-succes', texte: 'fait' },
  a_faire: { Icone: CircleX, couleur: 'text-avertissement', texte: 'à faire' },
  attente: { Icone: Clock, couleur: 'text-muted-foreground', texte: "pas encore l'heure" },
};

/** L'état d'un fait : une heure non atteinte attend, une tâche non faite est à faire. */
export function etatCondition(c: Pick<ConditionParcours, 'type' | 'vraie'>): EtatFait {
  if (c.vraie) return 'fait';
  return c.type === 'heure' ? 'attente' : 'a_faire';
}
