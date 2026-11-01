import { ArrowLeft, CalendarClock, CalendarPlus, CalendarX2, ChevronRight, Clock, Loader2, ShieldAlert, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { DemandeException, EngagementDemain, PrixException, ReponseStatut } from '@/api/contrat';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { ApercuPrix } from '@/composants/ApercuPrix';
import { ErreurAffichee } from '@/composants/ErreurAffichee';
import { FenetreAdaptative } from '@/composants/FenetreAdaptative';
import { Champ } from '@/composants/formulaire';
import { FrictionNuit } from '@/composants/FrictionNuit';
import { useApercuPrix } from '@/hooks/useApercuPrix';
import { useFocus, useHeureServeur, useStatut } from '@/hooks/useFocus';
import { validerFriction } from '@/lib/decisionNuit';
import { type ChampsAjout as ChampsAjoutType, demandeAjout, PREPARATION_DEFAUT } from '@/lib/engagement';
import { ajouterJours, formaterHeure, heureLocale } from '@/lib/temps';
import { phrase } from '@/lib/texte';
import { cn } from '@/lib/utils';
import { ChampsAjout } from './ChampsAjout';

export type OptionDecalage = 'retire' | 'ajoute' | 'decale' | 'coucher';

const OPTIONS: { option: OptionDecalage; titre: string; description: string; icone: LucideIcon; classe: string }[] = [
  {
    option: 'retire',
    titre: 'Retirer un engagement de demain',
    description: 'Le réveil recule si cet engagement le fixait.',
    icone: CalendarX2,
    classe: 'bg-destructive/10 text-destructive',
  },
  {
    option: 'ajoute',
    titre: 'Ajouter un engagement demain',
    description: 'Un engagement qui avance le réveil.',
    icone: CalendarPlus,
    classe: 'bg-mode-travail/12 text-mode-travail',
  },
  {
    option: 'decale',
    titre: 'Décaler un engagement de demain',
    description: "Changer l'heure d'un engagement.",
    icone: CalendarClock,
    classe: 'bg-mode-matin/12 text-mode-matin',
  },
  {
    option: 'coucher',
    titre: "Choisir l'heure de coucher",
    description: 'Une autre heure pour cette nuit.',
    icone: Clock,
    classe: 'bg-mode-nuit/12 text-mode-nuit',
  },
];

/** Engagements proposés pour une option : seulement ceux que la config permet. */
export function engagementsPour(option: OptionDecalage, liste: EngagementDemain[]): EngagementDemain[] {
  if (option === 'retire') return liste.filter((e) => e.annulable);
  if (option === 'decale') return liste.filter((e) => e.decalable);
  return liste;
}

function BandeauDecision({ motif }: { motif: string | null }) {
  return (
    <Alert className="border-avertissement/40 text-avertissement">
      <ShieldAlert />
      <AlertTitle>Décision de nuit : une fois par nuit</AlertTitle>
      <AlertDescription>
        {motif ? <p>{phrase(motif)}.</p> : null}
        <p>Il faudra une raison d'au moins 50 caractères et recopier une phrase.</p>
      </AlertDescription>
    </Alert>
  );
}

function MenuOptions({ engagements, choisir }: { engagements: EngagementDemain[]; choisir: (o: OptionDecalage) => void }) {
  return (
    <ul className="grid gap-2">
      {OPTIONS.map(({ option, titre, description, icone: Icone, classe }) => {
        const vide = (option === 'retire' || option === 'decale') && engagementsPour(option, engagements).length === 0;
        return (
          <li key={option}>
            <button
              type="button"
              disabled={vide}
              onClick={() => choisir(option)}
              className="hover:bg-accent/60 focus-visible:ring-ring/50 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
            >
              <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', classe)}>
                <Icone className="size-5" />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm font-medium">{titre}</span>
                <span className="text-muted-foreground text-xs">
                  {vide ? `Aucun engagement ${option === 'retire' ? 'annulable' : 'décalable'} demain.` : description}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ChoixEngagement({
  engagements,
  valeur,
  surChoix,
  fuseau,
}: {
  engagements: EngagementDemain[];
  valeur: string;
  surChoix: (id: string) => void;
  fuseau: string;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">Engagement de demain</legend>
      <RadioGroup value={valeur} onValueChange={surChoix} className="gap-2">
        {engagements.map((e) => {
          const id = `engagement-${e.id}`;
          return (
            <Label
              key={e.id}
              htmlFor={id}
              className={cn(
                'hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 font-normal transition-colors',
                valeur === e.id && 'border-primary bg-accent/40',
              )}
            >
              <RadioGroupItem id={id} value={e.id} />
              <span className="min-w-0 flex-1 font-medium">{e.nom}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {e.heure ? `à ${formaterHeure(e.heure, fuseau)}` : 'sans heure'}
                {e.reveil ? ` · réveil ${formaterHeure(e.reveil, fuseau)}` : ''}
              </span>
              {e.origine === 'exception' ? <Badge variant="outline">ajouté</Badge> : null}
            </Label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}

/** Heure de coucher : saisie libre et raccourcis relatifs au coucher appliqué. */
function ChampCoucher({ valeur, surChangement, statut }: { valeur: string; surChangement: (h: string) => void; statut: ReponseStatut }) {
  const j = statut.journee;
  const coucher = Date.parse(j.coucherApplique);
  return (
    <Champ id="decaler-heure" libelle="Heure de coucher" aide={`Prévu : ${formaterHeure(j.coucherApplique, j.fuseau)}`}>
      <Input id="decaler-heure" type="time" value={valeur} onChange={(e) => surChangement(e.target.value)} className="tabular-nums" />
      <div className="flex flex-wrap gap-2">
        {[15, 30, 60].map((m) => {
          const h = heureLocale(coucher + m * 60_000, j.fuseau);
          return (
            <Button key={m} type="button" variant={valeur === h ? 'secondary' : 'outline'} size="sm" onClick={() => surChangement(h)}>
              +{m === 60 ? '1 h' : `${m} min`}
            </Button>
          );
        })}
      </div>
    </Champ>
  );
}

function FormulaireOption({ option, decisionDeNuit, surTermine }: { option: OptionDecalage; decisionDeNuit: boolean; surTermine: () => void }) {
  const { api, rafraichir } = useFocus();
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const j = statut.journee;
  const demain = ajouterJours(j.date, 1);
  const engagements = engagementsPour(option, statut.engagements_demain ?? []);

  const [engagement, setEngagement] = useState(() => (engagements.length === 1 ? (engagements[0]?.id ?? '') : ''));
  const [heure, setHeure] = useState('');
  const [ajout, setAjout] = useState<ChampsAjoutType>({ date: demain, libelle: '', heure: '', preparationMin: PREPARATION_DEFAUT });
  const [raison, setRaison] = useState('');
  const [phrase, setPhrase] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);

  let demande: DemandeException | null = null;
  if (option === 'retire' && engagement) demande = { type: 'retire', date: demain, engagement };
  if (option === 'decale' && engagement && heure) demande = { type: 'decale', date: demain, engagement, heure };
  if (option === 'coucher' && heure) demande = { type: 'coucher', nuit: j.date, heure };
  if (option === 'ajoute') demande = demandeAjout(ajout);

  const apercu = useApercuPrix(demande ? JSON.stringify(demande) : null, () => demande);
  const prix = apercu.prix;
  // L'API reste juge (prix.friction) ; en décision de nuit, desserrer exige la friction d'emblée.
  const exigee: PrixException['friction'] =
    prix?.friction === 'raison' || prix?.friction === 'raison_phrase'
      ? prix.friction
      : decisionDeNuit && option !== 'ajoute' && prix?.resserre !== true
        ? 'raison_phrase'
        : 'aucune';
  const avecPhrase = exigee === 'raison_phrase';
  const friction = validerFriction(raison, phrase, avecPhrase);
  // L'aperçu est calculé sans la raison : un refus qui ne porte que sur elle reste recevable.
  const recevable = prix !== null && (prix.admissible || prix.frictionManquante === true);
  const afficherFriction = exigee !== 'aucune' && (prix === null || recevable);
  const peutValider = demande !== null && recevable && !apercu.calcul && !envoi && (exigee === 'aucune' || friction.valide);
  const choisi = engagements.find((e) => e.id === engagement);

  async function valider() {
    if (!demande) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const fournie = exigee === 'aucune' ? undefined : avecPhrase ? { raison: raison.trim(), phrase } : { raison: raison.trim() };
      await api.enregistrerException({ demande, friction: fournie });
      toast.success('Changement enregistré', { description: OPTIONS.find((o) => o.option === option)?.titre });
      await rafraichir();
      surTermine();
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (peutValider) void valider();
      }}
    >
      <fieldset disabled={envoi} className="grid gap-4">
        {option === 'retire' || option === 'decale' ? (
          <ChoixEngagement engagements={engagements} valeur={engagement} surChoix={setEngagement} fuseau={j.fuseau} />
        ) : null}
        {option === 'decale' && choisi ? (
          <Champ
            id="decaler-heure"
            libelle="Nouvelle heure de l'engagement"
            aide={choisi.heure ? `Actuellement à ${formaterHeure(choisi.heure, j.fuseau)}` : undefined}
          >
            <Input id="decaler-heure" type="time" value={heure} onChange={(e) => setHeure(e.target.value)} className="tabular-nums" />
          </Champ>
        ) : null}
        {option === 'coucher' ? <ChampCoucher valeur={heure} surChangement={setHeure} statut={statut} /> : null}
        {option === 'ajoute' ? <ChampsAjout champs={ajout} modifier={(p) => setAjout((c) => ({ ...c, ...p }))} demain={demain} /> : null}
      </fieldset>

      <ApercuPrix prix={prix} calcul={apercu.calcul} fuseau={j.fuseau} maintenantMs={maintenant} frictionValide={friction.valide} />
      <ErreurAffichee erreur={apercu.erreur} />

      {afficherFriction ? (
        <FrictionNuit raison={raison} phrase={phrase} onRaison={setRaison} onPhrase={setPhrase} desactive={envoi} avecPhrase={avecPhrase} />
      ) : null}

      <ErreurAffichee erreur={erreur} />
      <Button type="submit" size="lg" disabled={!peutValider}>
        {envoi ? <Loader2 className="animate-spin" /> : null}
        {avecPhrase ? 'Prendre la décision de nuit' : 'Valider'}
      </Button>
    </form>
  );
}

/**
 * « Décaler le coucher » : l'état vient de l'API (`phase`, `actions.decaler_coucher.mode`).
 * La nuit, on va droit au choix de l'heure, en décision de nuit.
 */
export function DecalerCoucher({ ouverte, surChangement }: { ouverte: boolean; surChangement: (ouverte: boolean) => void }) {
  const statut = useStatut();
  const action = statut.actions?.decaler_coucher;
  const nuit = statut.phase === 'nuit';
  const [choisie, setChoisie] = useState<OptionDecalage | null>(null);
  const option = nuit ? 'coucher' : choisie;
  const decision = action?.mode === 'decision_de_nuit';

  const fermer = (o: boolean) => {
    if (!o) setChoisie(null);
    surChangement(o);
  };

  const titre = nuit ? 'Décision de nuit' : option ? (OPTIONS.find((o) => o.option === option)?.titre ?? '') : 'Décaler le coucher';
  const description = nuit
    ? "Choisir une autre heure de coucher pour cette nuit."
    : option
      ? 'Le prix se met à jour pendant la saisie.'
      : 'Choisissez ce qui change. Le prix s’affiche avant de valider.';

  return (
    <FenetreAdaptative ouverte={ouverte} surChangement={fermer} titre={titre} description={description}>
      {!action || action.mode === 'indisponible' ? (
        <Alert>
          <ShieldAlert />
          <AlertTitle>Indisponible</AlertTitle>
          <AlertDescription>{action?.motif ? `${phrase(action.motif)}.` : "L'API n'indique pas si le coucher peut être décalé."}</AlertDescription>
        </Alert>
      ) : (
        <>
          {decision ? <BandeauDecision motif={action.motif} /> : null}
          {action.mode === 'raison' && option === null ? (
            <p className="text-muted-foreground text-sm">
              Coucher plus tard ou réveil repoussé : une raison d'au moins 50 caractères est demandée. Se coucher plus tôt reste libre.
            </p>
          ) : null}
          {option === null ? (
            <MenuOptions engagements={statut.engagements_demain ?? []} choisir={setChoisie} />
          ) : (
            <>
              {nuit ? null : (
                <Button variant="ghost" size="sm" className="-ml-2 justify-self-start" onClick={() => setChoisie(null)}>
                  <ArrowLeft /> Autres options
                </Button>
              )}
              <FormulaireOption key={option} option={option} decisionDeNuit={decision} surTermine={() => fermer(false)} />
            </>
          )}
        </>
      )}
    </FenetreAdaptative>
  );
}
