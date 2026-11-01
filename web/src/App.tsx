import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { API_SIMULEE, creerApi } from '@/api';
import { ErreurAffichee } from '@/composants/ErreurAffichee';
import { Accueil } from '@/ecrans/Accueil';
import { EcranDecisionNuit } from '@/ecrans/DecisionNuit';
import { EcranExceptions } from '@/ecrans/Exceptions';
import { EcranSessions } from '@/ecrans/Sessions';
import { EcranStatut } from '@/ecrans/Statut';
import { FournisseurFocus, useFocus, useHeureServeur } from '@/hooks/useFocus';
import { ecrireJeton, effacerJeton, lireJeton } from '@/lib/stockage';
import { cn } from '@/lib/utils';

const ECRANS = {
  statut: 'Statut',
  exceptions: 'Exceptions',
  nuit: 'Nuit',
  sessions: 'Sessions',
} as const;
type Ecran = keyof typeof ECRANS;

const estEcran = (valeur: string): valeur is Ecran => Object.hasOwn(ECRANS, valeur);

/** L'écran vit dans l'ancre de l'URL : un rechargement de la PWA garde l'onglet. */
function useEcran(): [Ecran, (ecran: Ecran) => void] {
  const lire = (): Ecran => {
    const ancre = window.location.hash.slice(1);
    return estEcran(ancre) ? ancre : 'statut';
  };
  const [ecran, setEcran] = useState(lire);
  useEffect(() => {
    const surChangement = () => setEcran(lire());
    window.addEventListener('hashchange', surChangement);
    return () => window.removeEventListener('hashchange', surChangement);
  }, []);
  return [ecran, (e) => (window.location.hash = e)];
}

function Coquille() {
  const { statut, erreur, rafraichir, changerJeton } = useFocus();
  const maintenant = useHeureServeur();
  const [ecran, allerA] = useEcran();

  const questionEnAttente = statut?.sessions.some((s) => s.question !== null) ?? false;
  const soireeOuverte = statut ? maintenant >= Date.parse(statut.journee.ouverture) : false;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-8">
      <header className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">Focus</h1>
        {API_SIMULEE ? <Badge variant="outline">API simulée</Badge> : null}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void rafraichir()}>
          Actualiser
        </Button>
      </header>

      <nav aria-label="Écrans" className="bg-muted grid grid-cols-4 gap-1 rounded-lg p-1">
        {(Object.keys(ECRANS) as Ecran[]).map((e) => (
          <button
            key={e}
            type="button"
            aria-current={ecran === e ? 'page' : undefined}
            onClick={() => allerA(e)}
            className={cn(
              'relative rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
              ecran === e ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {ECRANS[e]}
            {(e === 'sessions' && questionEnAttente) || (e === 'nuit' && soireeOuverte) ? (
              <span
                aria-label={e === 'sessions' ? 'question en attente' : 'soirée ouverte'}
                className={cn('absolute top-1 right-1 size-2 rounded-full', e === 'sessions' ? 'bg-avertissement' : 'bg-primary')}
              />
            ) : null}
          </button>
        ))}
      </nav>

      <ErreurAffichee erreur={erreur} />
      {erreur?.statutHttp === 401 ? (
        <Button variant="outline" onClick={changerJeton}>
          Saisir un autre jeton
        </Button>
      ) : null}

      <main className="flex-1">
        {statut === null ? (
          <p className="text-muted-foreground text-sm">{erreur ? '' : 'Chargement du statut…'}</p>
        ) : ecran === 'statut' ? (
          <EcranStatut />
        ) : ecran === 'exceptions' ? (
          <EcranExceptions />
        ) : ecran === 'nuit' ? (
          <EcranDecisionNuit />
        ) : (
          <EcranSessions />
        )}
      </main>

      <footer className="text-center">
        <Button variant="link" size="sm" className="text-muted-foreground" onClick={changerJeton}>
          Changer de jeton
        </Button>
      </footer>
    </div>
  );
}

export function App() {
  const [jeton, setJeton] = useState<string | null>(() => lireJeton());
  const api = useMemo(() => (jeton ? creerApi(jeton) : null), [jeton]);
  const changerJeton = useCallback(() => {
    effacerJeton();
    setJeton(null);
  }, []);

  if (!api) {
    return (
      <Accueil
        onJeton={(j) => {
          ecrireJeton(j);
          setJeton(j);
        }}
      />
    );
  }
  return (
    <FournisseurFocus api={api} changerJeton={changerJeton}>
      <Coquille />
    </FournisseurFocus>
  );
}
