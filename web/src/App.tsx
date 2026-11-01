import { KeyRound } from 'lucide-react';
import { ThemeProvider } from 'next-themes';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { creerApi } from '@/api';
import { BarreLaterale } from '@/composants/coquille/BarreLaterale';
import { EnTete } from '@/composants/coquille/EnTete';
import { type Ecran, estEcran } from '@/composants/coquille/navigation';
import { OngletsBas } from '@/composants/coquille/OngletsBas';
import { Accueil } from '@/ecrans/Accueil';
import { EcranDecisionNuit } from '@/ecrans/DecisionNuit';
import { EcranExceptions } from '@/ecrans/Exceptions';
import { EcranSessions } from '@/ecrans/Sessions';
import { EcranStatut, SqueletteStatut } from '@/ecrans/Statut';
import { FournisseurFocus, useFocus, useHeureServeur } from '@/hooks/useFocus';
import { ecrireJeton, effacerJeton, lireJeton } from '@/lib/stockage';

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
  return [
    ecran,
    (e) => {
      window.location.hash = e;
      window.scrollTo({ top: 0 });
    },
  ];
}

function Coquille() {
  const { statut, erreur, changerJeton } = useFocus();
  const maintenant = useHeureServeur();
  const [ecran, allerA] = useEcran();

  const indicateurs: Partial<Record<Ecran, string>> = {};
  if (statut?.sessions.some((s) => s.question !== null)) indicateurs.sessions = 'question en attente';
  if (statut && maintenant >= Date.parse(statut.journee.ouverture) && !statut.journee.decisionDeNuitPrise) indicateurs.nuit = 'soirée ouverte';

  return (
    <SidebarProvider>
      <BarreLaterale ecran={ecran} allerA={allerA} indicateurs={indicateurs} />
      <SidebarInset className="min-w-0">
        <EnTete ecran={ecran} />
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 pt-4 pb-28 md:gap-6 md:px-6 md:pt-6 md:pb-8">
          {erreur ? (
            <Alert variant="destructive">
              <KeyRound />
              <AlertTitle>{erreur.statutHttp === 401 ? 'Jeton refusé' : 'Statut indisponible'}</AlertTitle>
              <AlertDescription>
                <p>{erreur.message}</p>
                {erreur.statutHttp === 401 ? (
                  <Button variant="outline" size="sm" className="mt-2" onClick={changerJeton}>
                    Saisir un autre jeton
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {statut === null ? (
            erreur ? null : (
              <SqueletteStatut />
            )
          ) : ecran === 'statut' ? (
            <EcranStatut />
          ) : ecran === 'exceptions' ? (
            <EcranExceptions />
          ) : ecran === 'nuit' ? (
            <EcranDecisionNuit />
          ) : (
            <EcranSessions />
          )}
        </div>
      </SidebarInset>
      <OngletsBas ecran={ecran} allerA={allerA} indicateurs={indicateurs} />
    </SidebarProvider>
  );
}

export function App() {
  const [jeton, setJeton] = useState<string | null>(() => lireJeton());
  const api = useMemo(() => (jeton ? creerApi(jeton) : null), [jeton]);
  const changerJeton = useCallback(() => {
    effacerJeton();
    setJeton(null);
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="focus.theme">
      <TooltipProvider delayDuration={200}>
        {api ? (
          <FournisseurFocus api={api} changerJeton={changerJeton}>
            <Coquille />
          </FournisseurFocus>
        ) : (
          <Accueil
            onJeton={(j) => {
              ecrireJeton(j);
              setJeton(j);
            }}
          />
        )}
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </ThemeProvider>
  );
}
