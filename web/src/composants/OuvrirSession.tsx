import { ChevronDown, Lock, Timer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import type { AppBloquee, GroupeBloque, TacheSession } from '@/api/contrat';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useAppsBloquees } from '@/hooks/useAppsBloquees';
import { useCompteARebours } from '@/hooks/useCompteARebours';
import { useFocus, useHeureServeur, useStatut } from '@/hooks/useFocus';
import { libelleAppareil } from '@/lib/appareils';
import { basculerGroupe, etatGroupe, type GroupeAffiche, regrouperApps } from '@/lib/groupes';
import { phrase } from '@/lib/texte';
import { ATTENTE_OUVERTURE_S, tacheEligible } from '@/lib/attente';
import { formaterDuree, formaterHeure } from '@/lib/temps';
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

function CaseApp({ app, choisies, surChoix, prefixe }: { app: AppBloquee; choisies: string[]; surChoix: (a: string[]) => void; prefixe: string }) {
  const id = `${prefixe}-${app.id}`;
  const coche = choisies.includes(app.id);
  return (
    <Label
      htmlFor={id}
      className={cn(
        'hover:bg-accent/50 flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 font-normal',
        coche && 'border-primary bg-accent/40',
      )}
    >
      <Checkbox
        id={id}
        checked={coche}
        onCheckedChange={(c) => surChoix(c === true ? [...choisies, app.id] : choisies.filter((x) => x !== app.id))}
      />
      {app.nom}
    </Label>
  );
}

/** App hors groupe : même ligne que les groupes (nom + description courte), pour des hauteurs égales. */
function LigneApp({
  app,
  description,
  choisies,
  surChoix,
}: {
  app: AppBloquee;
  description: string;
  choisies: string[];
  surChoix: (a: string[]) => void;
}) {
  const id = `app-${app.id}`;
  const coche = choisies.includes(app.id);
  return (
    <div className={cn('rounded-lg border', coche && 'border-primary bg-accent/20')}>
      <div className="flex min-h-14 items-center gap-2.5 px-3 py-2">
        <Checkbox
          id={id}
          checked={coche}
          onCheckedChange={(c) => surChoix(c === true ? [...choisies, app.id] : choisies.filter((x) => x !== app.id))}
        />
        <Label htmlFor={id} className="grid min-w-0 flex-1 cursor-pointer gap-0.5 font-normal">
          <span className="font-medium">{app.nom}</span>
          <span className="text-muted-foreground truncate text-xs">{description}</span>
        </Label>
      </div>
    </div>
  );
}

function Groupe({ groupe, choisies, surChoix }: { groupe: GroupeAffiche; choisies: string[]; surChoix: (a: string[]) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const etat = etatGroupe(groupe, choisies);
  const id = `groupe-${groupe.id}`;
  const n = groupe.apps.filter((a) => choisies.includes(a.id)).length;
  return (
    <div className={cn('rounded-lg border', etat !== false && 'border-primary bg-accent/20')}>
      <div className="flex min-h-14 items-center gap-2.5 px-3 py-2">
        <Checkbox id={id} checked={etat} onCheckedChange={() => surChoix(basculerGroupe(groupe, choisies))} aria-label={`Tout le groupe ${groupe.nom}`} />
        <Label htmlFor={id} className="grid min-w-0 flex-1 cursor-pointer gap-0.5 font-normal">
          <span className="font-medium">{groupe.nom}</span>
          <span className="text-muted-foreground truncate text-xs">
            {etat === 'indeterminate' ? `${n} sur ${groupe.apps.length}` : `${groupe.apps.length} apps`}
          </span>
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground shrink-0"
          aria-expanded={ouvert}
          aria-controls={`${id}-apps`}
          onClick={() => setOuvert((o) => !o)}
        >
          Choisir
          <ChevronDown className={cn('transition-transform', ouvert && 'rotate-180')} />
        </Button>
      </div>
      {ouvert ? (
        <div id={`${id}-apps`} className="grid grid-cols-2 gap-2 border-t px-3 py-2.5 sm:grid-cols-3">
          {groupe.apps.map((a) => (
            <CaseApp key={a.id} app={a} choisies={choisies} surChoix={surChoix} prefixe={id} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Les groupes que le mode bloque (cases « tout le groupe », apps à la demande), puis les apps hors groupe. */
function ChoixApps({
  apps,
  groupes,
  choisies,
  surChoix,
}: {
  apps: AppBloquee[];
  groupes: GroupeBloque[] | undefined;
  choisies: string[];
  surChoix: (a: string[]) => void;
}) {
  const r = regrouperApps(apps, groupes);
  const plafonds = useStatut().sessions_du_jour?.par_app ?? [];
  const descriptionApp = (id: string) => {
    const p = plafonds.find((x) => x.app === id);
    return p ? `Plafond propre · ${formaterDuree(p.plafond_min)}` : 'App seule';
  };
  return (
    <div className="grid gap-2">
      {r.groupes.map((g) => (
        <Groupe key={g.id} groupe={g} choisies={choisies} surChoix={surChoix} />
      ))}
      {r.seules.map((a) => (
        <LigneApp key={a.id} app={a} description={descriptionApp(a.id)} choisies={choisies} surChoix={surChoix} />
      ))}
    </div>
  );
}

export function OuvrirSession({ surTermine }: { surTermine?: () => void }) {
  const { api, rafraichir } = useFocus();
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const fuseau = statut.journee.fuseau;

  const possibles = statut.appareils.filter((a) => a.session_possible);
  const [appareil, setAppareil] = useState(() => possibles[0]?.appareil ?? '');
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

  const etat = possibles.find((a) => a.appareil === appareil);
  const autorisees = etat !== undefined;
  const { apps: appsBloquees, erreur: erreurApps } = useAppsBloquees(autorisees ? etat : undefined);
  const tache = taches?.find((t) => t.id === tacheId);
  const pret = autorisees && tache !== undefined && tacheEligible(tache, maintenant) && apps.length > 0;

  async function envoyer() {
    if (!tacheId) return;
    setEnvoi(true);
    try {
      await api.ouvrirSession({ appareil, tache_id: tacheId, apps });
      toast.success('Session ouverte', { description: "L'appareil débloque les apps d'ici une minute." });
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
        <Section titre="Appareil">
          {/* Tous les appareils : ceux où une session est impossible restent visibles, avec leur motif. */}
          <RadioGroup
            value={appareil}
            onValueChange={(v) => {
              setAppareil(v);
              setApps([]);
            }}
            className="gap-2"
            aria-label="Appareil"
          >
            {statut.appareils.map((a) => {
              const id = `appareil-${a.appareil}`;
              return (
                <Label
                  key={a.appareil}
                  htmlFor={id}
                  className={cn(
                    'hover:bg-accent/50 flex items-start gap-3 rounded-lg border px-3 py-3 font-normal transition-colors',
                    a.session_possible ? 'cursor-pointer' : 'cursor-not-allowed',
                    appareil === a.appareil && 'border-primary bg-accent/40',
                  )}
                >
                  <RadioGroupItem id={id} value={a.appareil} disabled={!a.session_possible} className="mt-0.5" />
                  <span className="grid min-w-0 flex-1 gap-0.5 leading-snug">
                    <span className={cn(!a.session_possible && 'text-muted-foreground')}>{libelleAppareil(a)}</span>
                    {a.session_possible ? null : (
                      <span className="text-muted-foreground flex items-start gap-1.5 text-xs">
                        <Lock className="mt-0.5 size-3 shrink-0" />
                        {phrase(a.session_motif ?? 'session impossible')}
                      </span>
                    )}
                  </span>
                </Label>
              );
            })}
          </RadioGroup>
          {possibles.length === 0 ? <p className="text-avertissement text-xs font-medium">Aucun appareil ne permet une session en ce moment.</p> : null}
        </Section>

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
            <p className="text-muted-foreground text-sm">Aucun appareil ne permet une session en ce moment.</p>
          ) : appsBloquees === null ? (
            erreurApps ? null : <Skeleton className="h-20" />
          ) : appsBloquees.length === 0 ? (
            <p className="text-muted-foreground text-sm">Rien n'est bloqué sur cet appareil.</p>
          ) : (
            <ChoixApps apps={appsBloquees} groupes={etat?.groupes_bloques} choisies={apps} surChoix={setApps} />
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
