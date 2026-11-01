import { Loader2, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DemandeException, Journee } from '@/api/contrat';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useApercuPrix } from '@/hooks/useApercuPrix';
import { useFocus, useHeureServeur, useStatut } from '@/hooks/useFocus';
import { validerFriction } from '@/lib/decisionNuit';
import { ajouterJours, formaterHeure, versInstant } from '@/lib/temps';
import { ApercuPrix } from './ApercuPrix';
import { ChoixDate } from './ChoixDate';
import { ErreurAffichee } from './ErreurAffichee';
import { Champ } from './formulaire';
import { FrictionNuit } from './FrictionNuit';

export type TypeException = DemandeException['type'];

export const LIBELLES_EXCEPTION: Record<TypeException, string> = {
  avancer_coucher: 'Je vais dormir',
  coucher: 'Décaler le coucher',
  retire: 'Sauter un engagement',
  decale: 'Décaler un engagement',
  ajoute: 'Ajouter un engagement',
};

export interface Champs {
  type: TypeException;
  /** Jour de l'engagement (ajoute, retire, decale). */
  date: string;
  /** Nuit concernée (coucher, avancer_coucher) : la nuit appartient au jour du soir. */
  nuit: string;
  libelle: string;
  formeAjout: 'heure' | 'reveil';
  heure: string;
  preparation: string;
  reveil: string;
  engagement: string;
}

export function champsInitiaux(journee: Journee, type: TypeException): Champs {
  return {
    type,
    date: ajouterJours(journee.date, 1),
    nuit: journee.date,
    libelle: '',
    formeAjout: 'heure',
    heure: '',
    preparation: '30',
    reveil: '',
    engagement: '',
  };
}

export function construireDemande(c: Champs, maintenantMs: number): { demande: DemandeException } | { manque: string } {
  switch (c.type) {
    case 'ajoute': {
      const libelle = c.libelle.trim();
      if (!c.date) return { manque: 'Indiquez la date.' };
      if (!libelle) return { manque: "Indiquez le libellé de l'engagement." };
      if (c.formeAjout === 'reveil') {
        if (!c.reveil) return { manque: "Indiquez l'heure de réveil." };
        return { demande: { type: 'ajoute', date: c.date, libelle, reveil: c.reveil } };
      }
      if (!c.heure) return { manque: "Indiquez l'heure de l'engagement." };
      const preparationMin = Number(c.preparation || '0');
      if (!Number.isInteger(preparationMin) || preparationMin < 0) {
        return { manque: 'Préparation : un nombre entier de minutes.' };
      }
      return { demande: { type: 'ajoute', date: c.date, libelle, heure: c.heure, preparationMin } };
    }
    case 'retire':
      if (!c.date || !c.engagement.trim()) return { manque: "Indiquez la date et l'engagement." };
      return { demande: { type: 'retire', date: c.date, engagement: c.engagement.trim() } };
    case 'decale':
      if (!c.date || !c.engagement.trim() || !c.heure) return { manque: "Indiquez la date, l'engagement et la nouvelle heure." };
      return { demande: { type: 'decale', date: c.date, engagement: c.engagement.trim(), heure: c.heure } };
    case 'coucher':
      if (!c.nuit || !c.heure) return { manque: 'Indiquez la nuit et la nouvelle heure de coucher.' };
      return { demande: { type: 'coucher', nuit: c.nuit, heure: c.heure } };
    case 'avancer_coucher':
      return { demande: { type: 'avancer_coucher', nuit: c.nuit, a: versInstant(maintenantMs) } };
  }
}

/** Identité de la demande pour l'aperçu : l'instant de « Je vais dormir » n'en fait pas partie. */
function cleDemande(c: Champs): string | null {
  const r = construireDemande(c, 0);
  return 'manque' in r ? null : JSON.stringify(r.demande);
}

function ChampHeure({ id, libelle, valeur, surChangement, aide }: { id: string; libelle: string; valeur: string; surChangement: (v: string) => void; aide?: string }) {
  return (
    <Champ id={id} libelle={libelle} aide={aide}>
      <Input id={id} type="time" value={valeur} onChange={(e) => surChangement(e.target.value)} className="tabular-nums" />
    </Champ>
  );
}

function ChampsDuType({ champs, modifier, journee, maintenantMs }: { champs: Champs; modifier: (patch: Partial<Champs>) => void; journee: Journee; maintenantMs: number }) {
  const date = (
    <Champ id="exception-date" libelle="Jour de l'engagement">
      <ChoixDate id="exception-date" valeur={champs.date} surChoix={(date) => modifier({ date })} />
    </Champ>
  );
  const engagement = (
    <Champ
      id="exception-engagement"
      libelle="Engagement"
      aide={
        journee.engagements.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span>Aujourd'hui :</span>
            {journee.engagements.map((e) => (
              <Badge key={e} asChild variant={champs.engagement === e ? 'default' : 'outline'}>
                <button type="button" onClick={() => modifier({ engagement: e })}>
                  {e}
                </button>
              </Badge>
            ))}
          </div>
        ) : undefined
      }
    >
      <Input id="exception-engagement" value={champs.engagement} onChange={(e) => modifier({ engagement: e.target.value })} autoCapitalize="none" placeholder="ex. sport" />
    </Champ>
  );

  switch (champs.type) {
    case 'ajoute':
      return (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {date}
            <Champ id="exception-libelle" libelle="Libellé">
              <Input id="exception-libelle" value={champs.libelle} onChange={(e) => modifier({ libelle: e.target.value })} placeholder="ex. Dentiste" />
            </Champ>
          </div>
          <Tabs value={champs.formeAjout} onValueChange={(v) => (v === 'heure' || v === 'reveil' ? modifier({ formeAjout: v }) : undefined)} className="gap-4">
            <TabsList className="w-full" aria-label="Forme de l'engagement">
              <TabsTrigger value="heure">Heure + préparation</TabsTrigger>
              <TabsTrigger value="reveil">Heure de réveil</TabsTrigger>
            </TabsList>
            <TabsContent value="heure" className="grid grid-cols-2 gap-4">
              <ChampHeure id="exception-heure" libelle="Heure" valeur={champs.heure} surChangement={(heure) => modifier({ heure })} />
              <Champ id="exception-preparation" libelle="Préparation (min)">
                <Input
                  id="exception-preparation"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={5}
                  value={champs.preparation}
                  onChange={(e) => modifier({ preparation: e.target.value })}
                />
              </Champ>
            </TabsContent>
            <TabsContent value="reveil">
              <ChampHeure id="exception-reveil" libelle="Réveil" valeur={champs.reveil} surChangement={(reveil) => modifier({ reveil })} />
            </TabsContent>
          </Tabs>
        </>
      );
    case 'retire':
      return (
        <>
          {date}
          {engagement}
        </>
      );
    case 'decale':
      return (
        <>
          {date}
          {engagement}
          <ChampHeure id="exception-heure" libelle="Nouvelle heure" valeur={champs.heure} surChangement={(heure) => modifier({ heure })} />
        </>
      );
    case 'coucher':
      return (
        <div className="grid grid-cols-2 gap-4">
          <Champ id="exception-nuit" libelle="Nuit du">
            <ChoixDate id="exception-nuit" valeur={champs.nuit} surChoix={(nuit) => modifier({ nuit })} />
          </Champ>
          <ChampHeure id="exception-heure" libelle="Nouvelle heure" valeur={champs.heure} surChangement={(heure) => modifier({ heure })} />
        </div>
      );
    case 'avancer_coucher':
      return (
        <div className="bg-mode-nuit/10 border-mode-nuit/30 grid gap-1 rounded-xl border p-4">
          <span className="text-muted-foreground text-sm">Le coucher passe à maintenant</span>
          <span className="text-mode-nuit text-3xl font-semibold tabular-nums">{formaterHeure(versInstant(maintenantMs), journee.fuseau)}</span>
          <span className="text-muted-foreground text-sm">La nuit commence tout de suite. Toujours permis.</span>
        </div>
      );
  }
}

export function FormulaireException({
  type,
  decisionDeNuit = false,
  libelleValider = "Valider l'exception",
  surTermine,
}: {
  type: TypeException;
  decisionDeNuit?: boolean;
  libelleValider?: string;
  surTermine?: () => void;
}) {
  const { api, rafraichir } = useFocus();
  const { journee } = useStatut();
  const maintenant = useHeureServeur();
  const [champs, setChamps] = useState(() => champsInitiaux(journee, type));
  const [raison, setRaison] = useState('');
  const [phrase, setPhrase] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);

  const apercu = useApercuPrix(cleDemande(champs), () => {
    const r = construireDemande(champs, maintenant);
    return 'demande' in r ? r.demande : null;
  });
  const prix = apercu.prix;
  const frictionExigee = decisionDeNuit || prix?.friction === 'raison_phrase';
  const friction = validerFriction(raison, phrase);
  const verrouille = decisionDeNuit && journee.decisionDeNuitPrise;
  const peutValider = prix !== null && prix.admissible && (!frictionExigee || friction.valide) && !enCours && !verrouille && !apercu.calcul;

  function modifier(patch: Partial<Champs>) {
    setChamps((c) => ({ ...c, ...patch }));
    setErreur(null);
  }

  async function valider() {
    const r = construireDemande(champs, maintenant);
    if ('manque' in r) return;
    setEnCours(true);
    setErreur(null);
    try {
      await api.enregistrerException({
        demande: r.demande,
        friction: frictionExigee && friction.valide ? { raison: raison.trim(), phrase } : undefined,
      });
      toast.success('Exception enregistrée', { description: LIBELLES_EXCEPTION[champs.type] });
      setRaison('');
      setPhrase('');
      setChamps(champsInitiaux(journee, champs.type));
      await rafraichir();
      surTermine?.();
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setEnCours(false);
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
      <fieldset disabled={verrouille || enCours} className="grid gap-4">
        <ChampsDuType champs={champs} modifier={modifier} journee={journee} maintenantMs={maintenant} />
      </fieldset>

      <ApercuPrix prix={prix} calcul={apercu.calcul} fuseau={journee.fuseau} maintenantMs={maintenant} />
      <ErreurAffichee erreur={apercu.erreur} />

      {frictionExigee ? (
        <>
          {decisionDeNuit ? null : (
            <Alert className="border-avertissement/40 text-avertissement">
              <ShieldAlert />
              <AlertTitle>Décision de nuit exigée</AlertTitle>
              <AlertDescription>La soirée est ouverte : desserrer demande une raison et la phrase exacte, une fois par nuit.</AlertDescription>
            </Alert>
          )}
          <FrictionNuit raison={raison} phrase={phrase} onRaison={setRaison} onPhrase={setPhrase} desactive={verrouille || enCours} />
        </>
      ) : null}

      <ErreurAffichee erreur={erreur} />
      <Button type="submit" size="lg" disabled={!peutValider}>
        {enCours ? <Loader2 className="animate-spin" /> : null}
        {libelleValider}
      </Button>
    </form>
  );
}
