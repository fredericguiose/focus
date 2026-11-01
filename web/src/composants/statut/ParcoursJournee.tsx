import { AlarmClock, Route } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ConditionParcours, EtapeParcours, ReponseStatut } from '@/api/contrat';
import { ICONES_FAMILLE } from '@/composants/statut/CarteMode';
import { libelleAppareil } from '@/lib/appareils';
import { type FamilleMode, infoMode, STYLES_FAMILLE } from '@/lib/modes';
import { appareilPrincipal, type EtapeJour, etapesDuJour } from '@/lib/parcours';
import { etatCondition, STYLES_ETAT } from '@/lib/etats';
import { formaterHeureRelative } from '@/lib/temps';
import { cn } from '@/lib/utils';

// Classes écrites en entier pour Tailwind.
const ANNEAU: Record<FamilleMode, string> = {
  nuit: 'ring-mode-nuit/20',
  matin: 'ring-mode-matin/20',
  travail: 'ring-mode-travail/20',
  soiree: 'ring-mode-soiree/20',
  inconnu: 'ring-mode-inconnu/20',
};

const INTRO: Record<EtapeParcours['logique'], string | null> = {
  tous: 'Il faut :',
  un_parmi: "Il suffit d'un seul :",
  pas: "Se lève quand c'est fait :",
  simple: null,
};

/** Une ligne = un fait et son état, avec la règle de couleurs commune (lib/etats). */
function Condition({ c }: { c: ConditionParcours }) {
  const etat = etatCondition(c);
  const { Icone, couleur, texte } = STYLES_ETAT[etat];
  return (
    <li className="flex items-start gap-2">
      <Icone className={cn('mt-0.5 size-4 shrink-0', couleur)} aria-hidden />
      <span className="min-w-0">
        <span>{c.libelle}</span>
        <span className="sr-only"> : {texte}</span>
        {c.detail ? <span className={cn('block text-xs', etat === 'a_faire' ? 'text-avertissement font-medium' : 'text-muted-foreground')}>{c.detail}</span> : null}
      </span>
    </li>
  );
}

function Pastille({ etape }: { etape: EtapeJour }) {
  if (etape.genre === 'repere') {
    return (
      <span className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full border">
        <AlarmClock className="size-4" />
      </span>
    );
  }
  const famille = infoMode(etape.etape.mode).famille;
  const Icone = ICONES_FAMILLE[famille];
  const styles = STYLES_FAMILLE[famille];
  return (
    <span
      className={cn(
        'flex size-8 items-center justify-center rounded-full',
        etape.etat === 'active' ? cn(styles.fond, 'text-white shadow-sm ring-4', ANNEAU[famille]) : cn(styles.doux, styles.texte),
      )}
    >
      <Icone className="size-4" />
    </span>
  );
}

function Etape({ etape, fuseau, maintenant, derniere }: { etape: EtapeJour; fuseau: string; maintenant: number; derniere: boolean }) {
  const active = etape.etat === 'active';
  const heure = etape.genre === 'repere' ? etape.heure : etape.heureFixe;
  const nom = etape.genre === 'repere' ? etape.libelle : etape.etape.nom || infoMode(etape.etape.mode).libelle;
  const styles = etape.genre === 'mode' ? STYLES_FAMILLE[infoMode(etape.etape.mode).famille] : null;
  const conditions = etape.genre === 'mode' && etape.heureFixe === null ? etape.etape.conditions : [];
  const intro = etape.genre === 'mode' && etape.heureFixe === null ? INTRO[etape.etape.logique] : null;
  const seulementToujours = conditions.length > 0 && conditions.every((c) => c.type === 'toujours');

  return (
    <li className={cn('relative grid grid-cols-[2rem_1fr] gap-x-3', etape.etat === 'franchie' && 'opacity-55')} aria-current={active ? 'step' : undefined}>
      <div className="flex flex-col items-center">
        <Pastille etape={etape} />
        {!derniere ? <span className="bg-border my-1 w-px flex-1" aria-hidden /> : null}
      </div>
      <div className={cn('min-w-0', derniere ? 'pb-0' : 'pb-4')}>
        <div className={cn('rounded-lg', active && styles ? cn('border px-3 py-2.5', styles.bordure, styles.doux) : 'pt-1')}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className={cn('font-semibold', active && styles?.texte)}>{nom}</span>
              {active ? (
                <Badge className={cn('text-white', styles?.fond)}>en cours</Badge>
              ) : etape.etat === 'franchie' && etape.genre === 'mode' ? (
                <span className="text-muted-foreground text-xs">passée</span>
              ) : null}
            </span>
            {heure ? (
              <span className="text-sm font-semibold tabular-nums">
                {etape.genre === 'mode' && etape.cle === 'NIGHT_LOCK' ? 'Coucher ' : ''}
                {formaterHeureRelative(heure, fuseau, maintenant)}
              </span>
            ) : null}
          </div>
          {seulementToujours ? (
            <p className="text-muted-foreground mt-1 text-sm">Par défaut, quand aucun autre mode ne s'applique.</p>
          ) : conditions.length > 0 ? (
            <div className="mt-1.5 grid gap-1.5 text-sm">
              {intro ? <span className="text-muted-foreground text-xs">{intro}</span> : null}
              <ul className="grid gap-1.5">
                {conditions.map((c, i) => (
                  <Condition key={`${c.type}-${i}`} c={c} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Le parcours de l'appareil principal, du lever au lever suivant, conditions comprises. */
export function ParcoursJournee({ statut, maintenant }: { statut: ReponseStatut; maintenant: number }) {
  const principal = appareilPrincipal(statut);
  const etapes = etapesDuJour(principal, statut.journee);

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Route className="size-4" /> Parcours de la journée
        </CardTitle>
        <CardDescription>{principal ? `${libelleAppareil(principal)}, dans l'ordre de la journée` : "Dans l'ordre de la journée"}</CardDescription>
      </CardHeader>
      <CardContent>
        {etapes ? (
          <ol aria-label="Parcours de la journée">
            {etapes.map((e, i) => (
              <Etape key={`${e.cle}-${i}`} etape={e} fuseau={statut.journee.fuseau} maintenant={maintenant} derniere={i === etapes.length - 1} />
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground text-sm">Le parcours n'est pas encore donné par l'API.</p>
        )}
      </CardContent>
    </Card>
  );
}
