import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ErreurFocus } from '@/api/erreur';

/** Le message de l'API est montré tel quel ; le code aide à le retrouver dans les journaux. */
export function ErreurAffichee({ erreur }: { erreur: ErreurFocus | null }) {
  if (!erreur) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>{erreur.statutHttp === 401 ? 'Jeton refusé' : 'Refusé'}</AlertTitle>
      <AlertDescription>
        <p>{erreur.message}</p>
        <p className="font-mono text-xs opacity-70">{erreur.erreur}</p>
      </AlertDescription>
    </Alert>
  );
}

export function Succes({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="text-succes text-sm font-medium">
      {message}
    </p>
  );
}
