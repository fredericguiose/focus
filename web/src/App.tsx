import { KeyRound } from 'lucide-react';
import { ThemeProvider } from 'next-themes';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { API_SIMULEE, creerApi } from '@/api';
import { modeAuthentification } from '@/api/mode';
import { BarreLaterale } from '@/composants/coquille/BarreLaterale';
import { EnTete } from '@/composants/coquille/EnTete';
import { type Ecran, estEcran } from '@/composants/coquille/navigation';
import { OngletsBas } from '@/composants/coquille/OngletsBas';
import { Accueil } from '@/ecrans/Accueil';
import { EcranConnecteurs } from '@/ecrans/Connecteurs';
import { EcranSessions } from '@/ecrans/Sessions';
import { EcranStatut, SqueletteStatut } from '@/ecrans/Statut';
import { FournisseurFocus, useFocus, useHeureServeur } from '@/hooks/useFocus';
import { questionPosee } from '@/lib/attente';
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
  if (statut?.sessions.some((s) => s.question !== null && questionPosee(s.question, maintenant))) indicateurs.sessions = 'question en attente';

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
                {erreur.statutHttp === 401 && changerJeton ? (
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
          ) : ecran === 'sessions' ? (
            <EcranSessions />
          ) : (
            <EcranConnecteurs />
          )}
        </div>
      </SidebarInset>
      <OngletsBas ecran={ecran} allerA={allerA} indicateurs={indicateurs} />
    </SidebarProvider>
  );
}

export function App() {
  // Mode simulé : saisie du jeton comme avant. Sinon : à déterminer auprès de l'API.
  const [mode, setMode] = useState<'verification' | 'sans_jeton' | 'jeton'>(API_SIMULEE ? 'jeton' : 'verification');
  const [jeton, setJeton] = useState<string | null>(() => lireJeton());
  useEffect(() => {
    if (mode !== 'verification') return;
    let actif = true;
    void modeAuthentification().then((m) => {
      if (!actif) return;
      if (m === 'sans_jeton') effacerJeton();
      setMode(m);
    });
    return () => {
      actif = false;
    };
  }, [mode]);
  const api = useMemo(() => {
    if (mode === 'sans_jeton') return creerApi(null);
    return mode === 'jeton' && jeton ? creerApi(jeton) : null;
  }, [mode, jeton]);
  const changerJeton = useCallback(() => {
    effacerJeton();
    setJeton(null);
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="focus.theme">
      <TooltipProvider delayDuration={200}>
        {mode === 'verification' ? null : api ? (
          <FournisseurFocus api={api} changerJeton={mode === 'jeton' ? changerJeton : undefined}>
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
