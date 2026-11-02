import { CalendarDays, CheckSquare, Dumbbell, Loader2, Moon, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { EtatConnecteur } from '@/api/contrat';
import { ErreurAffichee } from '@/composants/ErreurAffichee';
import { EnTeteEcran } from '@/composants/EnTeteEcran';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useFocus, useHeureServeur } from '@/hooks/useFocus';
import { formaterEcart } from '@/lib/temps';

const INFOS: Record<EtatConnecteur['id'], { nom: string; role: string; icone: LucideIcon }> = {
  google_agenda: { nom: 'Google Agenda', role: 'Bloc « Dormir » tenu à jour dans l’agenda.', icone: CalendarDays },
  todoist: { nom: 'Todoist', role: 'Tâches du jour et engagements.', icone: CheckSquare },
  xiaomi: { nom: 'Mi Fitness', role: 'Sommeil mesuré par la montre.', icone: Moon },
  hevy: { nom: 'Hevy', role: 'Séances de sport.', icone: Dumbbell },
};

/** Codes d'erreur (synchro ou retour de Google) en clair ; inconnu : le code tel quel. */
const ERREURS: Record<string, string> = {
  jeton_google_revoque: 'Accès révoqué chez Google : reconnecter.',
  client_google_refuse: 'Client OAuth refusé par Google.',
  google_acces_refuse: 'Accès à l’agenda refusé.',
  google_quota: 'Quota Google atteint, nouvel essai plus tard.',
  google_indisponible: 'Google injoignable.',
  google_reponse_invalide: 'Réponse inattendue de Google.',
  connexion_illisible: 'Connexion à refaire (clé ou client changés).',
  todoist_indisponible: 'Todoist injoignable.',
  jeton_xiaomi_expire: 'Connexion Xiaomi expirée : renouveler le secret.',
  xiaomi_indisponible: 'Mi Fitness injoignable.',
  xiaomi_reponse_invalide: 'Réponse inattendue de Mi Fitness.',
  cle_hevy_refusee: 'Clé d’API Hevy refusée.',
  hevy_indisponible: 'Hevy injoignable.',
  hevy_reponse_invalide: 'Réponse inattendue de Hevy.',
  refuse: 'Autorisation refusée.',
  portee_refusee: 'L’accès à l’agenda n’a pas été coché.',
  etat_invalide: 'Lien de connexion invalide : recommencer.',
  etat_expire: 'Lien de connexion expiré : recommencer.',
  echange_refuse: 'Google a refusé le code d’autorisation.',
  jeton_absent: 'Google n’a pas donné d’accès durable : recommencer.',
  google_non_configure: 'Google n’est pas configuré sur le serveur.',
};
export const erreurLisible = (code: string) => ERREURS[code] ?? `Échec de la synchro (${code}).`;

/** Retour du flux OAuth (`?google=ok` ou `?google=erreur&raison=…`) : message, puis URL nettoyée. */
function useRetourGoogle(recharger: () => void) {
  useEffect(() => {
    const url = new URL(window.location.href);
    const issue = url.searchParams.get('google');
    if (!issue) return;
    if (issue === 'ok') toast.success('Google Agenda connecté');
    else toast.error('Connexion Google impossible', { description: erreurLisible(url.searchParams.get('raison') ?? '') });
    url.searchParams.delete('google');
    url.searchParams.delete('raison');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    recharger();
  }, [recharger]);
}

function Etat({ c }: { c: EtatConnecteur }) {
  if (!c.origine) return <Badge variant="outline">Non connecté</Badge>;
  if (c.erreur) return <Badge variant="destructive">Erreur</Badge>;
  return <Badge variant="secondary">Connecté</Badge>;
}

function Ligne({ c, maintenant }: { c: EtatConnecteur; maintenant: number }) {
  if (!c.origine) return <>{c.connectable ? 'Pas encore connecté.' : 'Non configuré sur le serveur.'}</>;
  if (c.erreur) return <span className="text-destructive">{erreurLisible(c.erreur)}</span>;
  const synchro = c.derniere_synchro ? `dernière synchro ${formaterEcart(Date.parse(c.derniere_synchro) - maintenant)}` : 'pas encore synchronisé';
  return <>Connecté · {synchro}</>;
}

function CarteConnecteur({
  c,
  maintenant,
  occupe,
  connecter,
  deconnecter,
}: {
  c: EtatConnecteur;
  maintenant: number;
  occupe: boolean;
  connecter: () => void;
  deconnecter: () => void;
}) {
  const { nom, role, icone: Icone } = INFOS[c.id];
  const parLaPage = c.id === 'google_agenda';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icone className="text-muted-foreground size-4" />
          {nom}
        </CardTitle>
        <CardDescription>{role}</CardDescription>
        <CardAction>
          <Etat c={c} />
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm">
        <p>
          <Ligne c={c} maintenant={maintenant} />
        </p>
        {c.origine === 'serveur' ? <p className="text-muted-foreground mt-1 text-xs">Configuré sur le serveur.</p> : null}
      </CardContent>
      {parLaPage && c.connectable ? (
        <CardFooter className="gap-2">
          {c.origine === 'page' ? (
            <Button variant="outline" size="sm" onClick={deconnecter} disabled={occupe}>
              Déconnecter
            </Button>
          ) : (
            <Button size="sm" onClick={connecter} disabled={occupe}>
              {occupe ? <Loader2 className="animate-spin" /> : null}
              {c.origine === 'serveur' ? 'Connecter depuis cette page' : 'Connecter'}
            </Button>
          )}
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function EcranConnecteurs() {
  const { api } = useFocus();
  const maintenant = useHeureServeur();
  const [connecteurs, setConnecteurs] = useState<EtatConnecteur[] | null>(null);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);
  const [occupe, setOccupe] = useState(false);

  const recharger = useCallback(async () => {
    try {
      setConnecteurs((await api.connecteurs()).connecteurs);
      setErreur(null);
    } catch (e) {
      setErreur(versErreurFocus(e));
    }
  }, [api]);
  useEffect(() => {
    void recharger();
  }, [recharger]);
  useRetourGoogle(useCallback(() => void recharger(), [recharger]));

  const connecter = async () => {
    setOccupe(true);
    try {
      const { url } = await api.connecterGoogle();
      // En ligne : Google, puis retour sur cette page. Démonstration : URL vide, connecté sur place.
      if (url) return window.location.assign(url);
      toast.success('Google Agenda connecté');
      await recharger();
    } catch (e) {
      const err = versErreurFocus(e);
      toast.error('Connexion Google impossible', { description: ERREURS[err.erreur] ?? err.message });
    }
    setOccupe(false);
  };

  const deconnecter = async () => {
    setOccupe(true);
    try {
      const { revoque } = await api.deconnecterGoogle();
      if (revoque) toast.success('Google Agenda déconnecté');
      else toast.warning('Google Agenda déconnecté', { description: 'Révocation non confirmée par Google : retirer l’accès depuis le compte Google.' });
      await recharger();
    } catch (e) {
      toast.error('Déconnexion impossible', { description: versErreurFocus(e).message });
    }
    setOccupe(false);
  };

  return (
    <div className="grid gap-6">
      <EnTeteEcran titre="Connecteurs" description="Les services d’où Focus lit ou vers lesquels il écrit." />
      {erreur ? <ErreurAffichee erreur={erreur} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {connecteurs
          ? connecteurs.map((c) => (
              <CarteConnecteur key={c.id} c={c} maintenant={maintenant} occupe={occupe} connecter={() => void connecter()} deconnecter={() => void deconnecter()} />
            ))
          : erreur
            ? null
            : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
      </div>
    </div>
  );
}
