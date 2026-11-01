import { Lock, Timer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { TacheSession } from '@/api/contrat';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useAppsBloquees } from '@/hooks/useAppsBloquees';
import { useCompteARebours } from '@/hooks/useCompteARebours';
import { useFocus, useHeureServeur, useStatut } from '@/hooks/useFocus';
import { libelleAppareil } from '@/lib/appareils';
import { ATTENTE_OUVERTURE_S, tacheEligible } from '@/lib/attente';
import { infoMode } from '@/lib/modes';
import { formaterHeure } from '@/lib/temps';
import { cn } from '@/lib/utils';
import { ErreurAffichee } from './ErreurAffichee';

const LIBELLES_PRIORITE: Record<TacheSession['priorite'], string> = { p1: 'P1', p2: 'P2', p3: 'P3', p4: 'P4' };

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-2.5">
      <legend className="mb-2.5 text-sm font-medium">{titre}</legend>
      {children}
    </fieldset>
  );
}

export function OuvrirSession({ surTermine }: { surTermine?: () => void }) {
  const { api, rafraichir } = useFocus();
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const fuseau = statut.journee.fuseau;

  const [appareil, setAppareil] = useState(() => (statut.appareils.find((a) => a.sessions === 'autorisees') ?? statut.appareils[0])?.appareil ?? '');
  const [taches, setTaches] = useState<TacheSession[] | null>(null);
  const [tacheId, setTacheId] = useState<string>('');
  const [apps, setApps] = useState<string[]>([]);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);
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
  const autorisees = etat?.sessions === 'autorisees';
  const { apps: appsBloquees, erreur: erreurApps } = useAppsBloquees(autorisees ? etat : undefined);
  const tache = taches?.find((t) => t.id === tacheId);
  const pret = autorisees && tache !== undefined && tacheEligible(tache, maintenant) && apps.length > 0;

  async function envoyer() {
    if (!tacheId) return;
    setEnvoi(true);
    try {
      await api.ouvrirSession({ appareil, tache_id: tacheId, apps });
      toast.success('Session ouverte', { description: "L'appareil l'applique à son prochain planning (une minute au plus)." });
      setTacheId('');
      setApps([]);
      await rafraichir();
      surTermine?.();
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setEnvoi(false);
    }
  }

  const compte = useCompteARebours(ATTENTE_OUVERTURE_S, () => void envoyer());
  const occupe = compte.actif || envoi;

  return (
    <div className="grid gap-6">
      <fieldset disabled={occupe} className="grid gap-6 disabled:opacity-70">
        <div className="grid gap-2">
          <Label htmlFor="session-appareil">Appareil</Label>
          <Select
            value={appareil}
            onValueChange={(v) => {
              setAppareil(v);
              setApps([]);
            }}
            disabled={occupe}
          >
            <SelectTrigger id="session-appareil" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statut.appareils.map((a) => (
                <SelectItem key={a.appareil} value={a.appareil}>
                  {libelleAppareil(a)}
                  {a.sessions === 'interdites' ? <span className="text-muted-foreground"> · sessions interdites</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {etat && !autorisees ? (
            <p className="text-destructive flex items-center gap-1.5 text-xs">
              <Lock className="size-3.5" /> Sessions interdites en ce moment ({infoMode(etat.mode).libelle.toLowerCase()}).
            </p>
          ) : null}
        </div>

        <Section titre="Tâche du jour">
          {taches === null ? (
            <div className="grid gap-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : taches.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">Aucune tâche du jour.</p>
          ) : (
            <ScrollArea className="-mr-3 pr-3 [&>[data-slot=scroll-area-viewport]]:max-h-80">
            <RadioGroup value={tacheId} onValueChange={setTacheId} className="gap-2">
              {taches.map((t) => {
                const eligible = tacheEligible(t, maintenant);
                const id = `tache-${t.id}`;
                return (
                  <Label
                    key={t.id}
                    htmlFor={id}
                    className={cn(
                      'hover:bg-accent/50 flex items-center gap-3 rounded-lg border px-3 py-3 font-normal transition-colors',
                      eligible ? 'cursor-pointer' : 'cursor-not-allowed opacity-55',
                      tacheId === t.id && 'border-primary bg-accent/40',
                    )}
                  >
                    <RadioGroupItem id={id} value={t.id} disabled={!eligible} />
                    <span className="min-w-0 flex-1 leading-snug">{t.nom}</span>
                    {eligible ? null : (
                      <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                        <Timer className="size-3.5" />
                        dès {formaterHeure(t.eligible_le, fuseau)}
                      </span>
                    )}
                    <Badge variant="outline" className="shrink-0">
                      {LIBELLES_PRIORITE[t.priorite]}
                    </Badge>
                  </Label>
                );
              })}
            </RadioGroup>
            </ScrollArea>
          )}
        </Section>

        <Section titre="Apps à débloquer">
          {!autorisees ? (
            <p className="text-muted-foreground text-sm">Sessions interdites sur cet appareil en ce moment.</p>
          ) : appsBloquees === null ? (
            erreurApps ? null : <Skeleton className="h-20" />
          ) : appsBloquees.length === 0 ? (
            <p className="text-muted-foreground text-sm">Rien n'est bloqué sur cet appareil.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {appsBloquees.map((a) => {
                const id = `app-${a.id}`;
                return (
                  <Label
                    key={a.id}
                    htmlFor={id}
                    className={cn(
                      'hover:bg-accent/50 flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 font-normal',
                      apps.includes(a.id) && 'border-primary bg-accent/40',
                    )}
                  >
                    <Checkbox
                      id={id}
                      checked={apps.includes(a.id)}
                      onCheckedChange={(coche) => setApps((liste) => (coche === true ? [...liste, a.id] : liste.filter((x) => x !== a.id)))}
                    />
                    {a.nom}
                  </Label>
                );
              })}
            </div>
          )}
          <ErreurAffichee erreur={erreurApps} />
        </Section>
      </fieldset>

      <ErreurAffichee erreur={erreur} />

      {compte.actif ? (
        <div className="bg-muted/50 grid gap-3 rounded-xl border p-4" role="status">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium tabular-nums">Envoi dans {compte.restantS} s…</span>
            <Button variant="outline" size="sm" onClick={compte.annuler}>
              Annuler
            </Button>
          </div>
          <Progress value={((ATTENTE_OUVERTURE_S - compte.restantS) / ATTENTE_OUVERTURE_S) * 100} aria-label="Compte à rebours" />
        </div>
      ) : (
        <div className="grid gap-2">
          <Button
            size="lg"
            disabled={!pret || envoi}
            onClick={() => {
              setErreur(null);
              compte.lancer();
            }}
          >
            {envoi ? 'Envoi…' : 'Ouvrir la session'}
          </Button>
          <p className="text-muted-foreground text-center text-xs">L'envoi part {ATTENTE_OUVERTURE_S} s après le clic : le temps de se demander si c'est nécessaire.</p>
        </div>
      )}
    </div>
  );
}
