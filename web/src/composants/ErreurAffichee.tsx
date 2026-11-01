import { CircleAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ErreurFocus } from '@/api/erreur';

/** Le message de l'API est montré tel quel. */
export function ErreurAffichee({ erreur }: { erreur: ErreurFocus | null }) {
  if (!erreur) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{erreur.statutHttp === 401 ? 'Jeton refusé' : 'Refusé'}</AlertTitle>
      <AlertDescription>
        <p>{erreur.message}</p>
      </AlertDescription>
    </Alert>
  );
}

