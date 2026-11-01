import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { ApiFocus, ReponseStatut } from '@/api/contrat';
import { ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useMaintenant } from './useMaintenant';

const PERIODE_STATUT_MS = 20_000;

export interface ValeurFocus {
  api: ApiFocus;
  statut: ReponseStatut | null;
  erreur: ErreurFocus | null;
  /** Heure du serveur − horloge locale, mesurée à la dernière lecture du statut. */
  decalageMs: number;
  rafraichir: () => Promise<void>;
  /**
   * Bouton « actualiser » : synchro Todoist forcée côté serveur et statut recalculé. En cas
   * d'échec, le statut est relu quand même et l'erreur est relancée (à afficher par l'appelant).
   */
  actualiser: () => Promise<void>;
  /** Absent quand l'API n'exige pas de jeton (Cloudflare Access en ligne, utilisateur local). */
  changerJeton?: () => void;
}

const ContexteFocus = createContext<ValeurFocus | null>(null);

export function FournisseurFocus({
  api,
  changerJeton,
  children,
}: {
  api: ApiFocus;
  changerJeton?: () => void;
  children: ReactNode;
}) {
  const [statut, setStatut] = useState<ReponseStatut | null>(null);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);
  const [decalageMs, setDecalageMs] = useState(0);
  const derniereDemande = useRef(0);

  const rafraichir = useCallback(async () => {
    // Seule la réponse à la demande la plus récente est retenue (requêtes parallèles possibles).
    const numero = ++derniereDemande.current;
    try {
      const reponse = await api.statut();
      if (numero !== derniereDemande.current) return;
      setDecalageMs(Date.parse(reponse.heure_serveur) - Date.now());
      setStatut(reponse);
      setErreur(null);
    } catch (e) {
      if (numero === derniereDemande.current) setErreur(versErreurFocus(e));
    }
  }, [api]);

  const actualiser = useCallback(async () => {
    const numero = ++derniereDemande.current;
    try {
      const reponse = await api.actualiser();
      if (numero !== derniereDemande.current) return;
      setDecalageMs(Date.parse(reponse.heure_serveur) - Date.now());
      setStatut(reponse);
      setErreur(null);
    } catch (e) {
      await rafraichir();
      throw versErreurFocus(e);
    }
  }, [api, rafraichir]);

  useEffect(() => {
    void rafraichir();
    const id = setInterval(() => void rafraichir(), PERIODE_STATUT_MS);
    const auRetour = () => {
      if (document.visibilityState === 'visible') void rafraichir();
    };
    document.addEventListener('visibilitychange', auRetour);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', auRetour);
    };
  }, [rafraichir]);

  const valeur = useMemo(
    () => ({ api, statut, erreur, decalageMs, rafraichir, actualiser, changerJeton }),
    [api, statut, erreur, decalageMs, rafraichir, actualiser, changerJeton],
  );
  return <ContexteFocus value={valeur}>{children}</ContexteFocus>;
}

export function useFocus(): ValeurFocus {
  const valeur = useContext(ContexteFocus);
  if (!valeur) throw new Error('useFocus doit être appelé sous <FournisseurFocus>.');
  return valeur;
}

/** Statut garanti chargé : à utiliser dans les écrans, rendus seulement une fois le statut reçu. */
export function useStatut(): ReponseStatut {
  const { statut } = useFocus();
  if (!statut) throw new Error('Statut pas encore chargé.');
  return statut;
}

export function useHeureServeur(): number {
  return useMaintenant(useFocus().decalageMs);
}
