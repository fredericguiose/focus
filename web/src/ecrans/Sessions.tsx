import { Hourglass, Layers, Lock, Plus, Timer } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CarteSession } from '@/composants/CarteSession';
import { EnTeteEcran } from '@/composants/EnTeteEcran';
import { FenetreAdaptative } from '@/composants/FenetreAdaptative';
import { Indicateur } from '@/composants/statut/Indicateur';
import { OuvrirSession } from '@/composants/OuvrirSession';
import type { ReponseStatut } from '@/api/contrat';
import { useHeureServeur, useStatut } from '@/hooks/useFocus';
import { infoMode, raisonLisible } from '@/lib/modes';
import { formaterDuree, formaterHeureRelative } from '@/lib/temps';

/** Pourquoi aucune session ne peut s'ouvrir, d'après le mode en vigueur (null si une le peut). */
export function motifSessionsInterdites(statut: ReponseStatut, maintenant: number): { titre: string; detail: string | null } | null {
  if (statut.appareils.some((a) => a.sessions === 'autorisees')) return null;
  const principal = statut.appareils[0];
  const jusqua = principal?.jusqua ? ` — jusqu'à ${formaterHeureRelative(principal.jusqua, statut.journee.fuseau, maintenant)}` : '';
  if (statut.phase === 'nuit' || principal?.mode === 'NIGHT_LOCK') {
    return { titre: `Sessions interdites pendant la nuit${jusqua}`, detail: 'Aucune app ne peut être débloquée avant le lever.' };
  }
  const mode = principal ? infoMode(principal.mode).libelle : 'mode en cours';
  return { titre: `Sessions interdites : ${mode}${jusqua}`, detail: principal ? raisonLisible(principal.raison) : null };
}

export function EcranSessions() {
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const { sessions, sessions_du_jour: cumul } = statut;
  const [ouverture, setOuverture] = useState(false);
  const interdites = motifSessionsInterdites(statut, maintenant);
  const autorisees = interdites === null;
  const restantMin = cumul ? Math.max(0, cumul.plafond_min - cumul.cumul_min) : null;

  return (
    <div className="grid gap-6">
      <EnTeteEcran
        titre="Sessions"
        description="Débloquer des apps pour une tâche du jour. Une question vient vérifier que la tâche avance."
        action={
          <Button onClick={() => setOuverture(true)} disabled={!autorisees}>
            <Plus /> Ouvrir une session
          </Button>
        }
      />

      {interdites ? (
        <Alert className="border-mode-nuit/40">
          <Lock />
          <AlertTitle className="line-clamp-none">{interdites.titre}</AlertTitle>
          {interdites.detail ? <AlertDescription>{interdites.detail}</AlertDescription> : null}
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="col-span-2 lg:col-span-1">
          <Indicateur
            titre="Cumul du jour"
            icone={Hourglass}
            valeur={cumul ? formaterDuree(cumul.cumul_min) : 'non disponible'}
            pied={
              cumul ? (
                <div className="grid w-full gap-1.5">
                  <Progress value={Math.min(100, (cumul.cumul_min / cumul.plafond_min) * 100)} aria-label="Cumul des sessions du jour" />
                  <span>plafond {formaterDuree(cumul.plafond_min)}</span>
                </div>
              ) : undefined
            }
          />
        </div>
        <Indicateur titre="Ouvertes" icone={Layers} valeur={sessions.length} pied={sessions.length === 0 ? 'aucune en cours' : 'en cours'} />
        <Indicateur titre="Reste aujourd'hui" icone={Timer} valeur={restantMin === null ? '—' : formaterDuree(restantMin)} pied="avant le plafond" />
      </div>

      {sessions.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="grid justify-items-center gap-3 py-8 text-center">
            <span className="bg-muted flex size-12 items-center justify-center rounded-full">
              <Layers className="text-muted-foreground size-5" />
            </span>
            <div className="grid gap-1">
              <p className="font-medium">Aucune session ouverte.</p>
              <p className="text-muted-foreground text-sm">Les apps bloquées le restent jusqu'à la prochaine session.</p>
            </div>
            {autorisees ? (
              <Button variant="outline" onClick={() => setOuverture(true)}>
                <Plus /> Ouvrir une session
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sessions.map((s) => (
            <CarteSession key={s.id} session={s} />
          ))}
        </div>
      )}

      <FenetreAdaptative
        ouverte={ouverture}
        surChangement={setOuverture}
        titre="Ouvrir une session"
        description="Choisissez la tâche et les apps à débloquer."
      >
        {ouverture ? <OuvrirSession surTermine={() => setOuverture(false)} /> : null}
      </FenetreAdaptative>
    </div>
  );
}
