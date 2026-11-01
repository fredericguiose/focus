import { useEffect, useState } from 'react';

/** Heure courante en ms, recalée sur le serveur par `decalageMs`, rafraîchie chaque seconde. */
export function useMaintenant(decalageMs = 0, pasMs = 1000): number {
  const [maintenant, setMaintenant] = useState(() => Date.now() + decalageMs);
  useEffect(() => {
    setMaintenant(Date.now() + decalageMs);
    const id = setInterval(() => setMaintenant(Date.now() + decalageMs), pasMs);
    return () => clearInterval(id);
  }, [decalageMs, pasMs]);
  return maintenant;
}
