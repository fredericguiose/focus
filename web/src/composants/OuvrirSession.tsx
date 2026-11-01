import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { TacheSession } from '@/api/contrat';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useAppsBloquees } from '@/hooks/useAppsBloquees';
import { useCompteARebours } from '@/hooks/useCompteARebours';
import { useFocus, useHeureServeur, useStatut } from '@/hooks/useFocus';
import { ATTENTE_OUVERTURE_S, tacheEligible } from '@/lib/attente';
import { formaterHeure } from '@/lib/temps';
import { cn } from '@/lib/utils';
import { ErreurAffichee, Succes } from './ErreurAffichee';
import { Champ, Selecteur } from './formulaire';

export function OuvrirSession() {
  const { api, rafraichir } = useFocus();
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const fuseau = statut.journee.fuseau;

  const [appareil, setAppareil] = useState(
    () => (statut.appareils.find((a) => a.sessions === 'autorisees') ?? statut.appareils[0])?.appareil ?? '',
  );
  const [taches, setTaches] = useState<TacheSession[] | null>(null);
  const [tacheId, setTacheId] = useState<string | null>(null);
  const [apps, setApps] = useState<string[]>([]);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const chargerTaches = useCallback(async () => {
    try {
      setTaches((await api.taches()).taches);
    } catch (e) {
      setErreur(versErreurFocus(e));
    }
  }, [api]);

  useEffect(() => {
    void chargerTaches();
  }, [chargerTaches]);

  const etat = statut.appareils.find((a) => a.appareil === appareil);
  const { apps: appsBloquees, erreur: erreurApps } = useAppsBloquees(etat?.sessions === 'autorisees' ? etat : undefined);
  const tache = taches?.find((t) => t.id === tacheId);
  const pret = etat?.sessions === 'autorisees' && tache !== undefined && tacheEligible(tache, maintenant) && apps.length > 0;

  async function envoyer() {
    if (!tacheId) return;
    setEnvoi(true);
    try {
      await api.ouvrirSession({ appareil, tache_id: tacheId, apps });
      setSucces("Session ouverte. L'appareil l'applique à son prochain planning (une minute au plus).");
      setTacheId(null);
      setApps([]);
      await rafraichir();
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setEnvoi(false);
    }
  }

  const compte = useCompteARebours(ATTENTE_OUVERTURE_S, () => void envoyer());
  const occupe = compte.actif || envoi;

  return (
    <div className="grid gap-4">
      <fieldset disabled={occupe} className="grid gap-4">
        <Champ
          id="session-appareil"
          libelle="Appareil"
          aide={etat?.sessions === 'interdites' ? `Sessions interdites en ce moment (${etat.mode}).` : undefined}
        >
          <Selecteur
            id="session-appareil"
            value={appareil}
            onChange={(e) => {
              setAppareil(e.target.value);
              setApps([]);
            }}
          >
            {statut.appareils.map((a) => (
              <option key={a.appareil} value={a.appareil}>
                {a.appareil}
                {a.sessions === 'interdites' ? ` — sessions interdites (${a.mode})` : ''}
              </option>
            ))}
          </Selecteur>
        </Champ>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Tâche du jour</legend>
          {taches === null ? <p className="text-muted-foreground text-sm">Chargement des tâches…</p> : null}
          {taches?.length === 0 ? <p className="text-muted-foreground text-sm">Aucune tâche du jour.</p> : null}
          {taches?.map((t) => {
            const eligible = tacheEligible(t, maintenant);
            return (
              <label
                key={t.id}
                className={cn(
                  'flex items-center gap-3 rounded-md border px-3 py-2 text-sm',
                  eligible ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                  tacheId === t.id && 'border-primary',
                )}
              >
                <input
                  type="radio"
                  name="session-tache"
                  className="accent-primary size-4"
                  disabled={!eligible}
                  checked={tacheId === t.id}
                  onChange={() => setTacheId(t.id)}
                />
                <span className="flex-1">{t.nom}</span>
                {eligible ? null : <span className="text-xs">éligible à {formaterHeure(t.eligible_le, fuseau)}</span>}
                <Badge variant="outline">{t.priorite.toUpperCase()}</Badge>
              </label>
            );
          })}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Apps à débloquer</legend>
          {etat?.sessions === 'interdites' ? (
            <p className="text-muted-foreground text-sm">Sessions interdites sur cet appareil en ce moment.</p>
          ) : appsBloquees === null ? (
            <p className="text-muted-foreground text-sm">{erreurApps ? '' : 'Chargement des apps bloquées…'}</p>
          ) : appsBloquees.length === 0 ? (
            <p className="text-muted-foreground text-sm">Rien n'est bloqué sur cet appareil.</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {appsBloquees.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={apps.includes(a.id)}
                    onChange={(e) => setApps((liste) => (e.target.checked ? [...liste, a.id] : liste.filter((x) => x !== a.id)))}
                  />
                  {a.nom}
                </label>
              ))}
            </div>
          )}
          <ErreurAffichee erreur={erreurApps} />
        </fieldset>
      </fieldset>

      {compte.actif ? (
        <div className="flex items-center gap-3" role="status">
          <span className="text-sm tabular-nums">Envoi dans {compte.restantS} s…</span>
          <Button variant="outline" onClick={compte.annuler}>
            Annuler
          </Button>
        </div>
      ) : (
        <Button
          disabled={!pret || envoi}
          onClick={() => {
            setErreur(null);
            setSucces(null);
            compte.lancer();
          }}
        >
          {envoi ? 'Envoi…' : 'Ouvrir la session'}
        </Button>
      )}
      <p className="text-muted-foreground text-xs">
        L'envoi part {ATTENTE_OUVERTURE_S} s après le clic : le temps de se demander si c'est nécessaire.
      </p>
      <ErreurAffichee erreur={erreur} />
      <Succes message={succes} />
    </div>
  );
}
