import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DemandeException, Journee, PrixException } from '@/api/contrat';
import { ErreurFocus, versErreurFocus } from '@/api/erreur';
import { useFocus, useHeureServeur, useStatut } from '@/hooks/useFocus';
import { validerFriction } from '@/lib/decisionNuit';
import { ajouterJours, formaterHeure, versInstant } from '@/lib/temps';
import { ApercuPrix } from './ApercuPrix';
import { ErreurAffichee, Succes } from './ErreurAffichee';
import { Champ, Selecteur } from './formulaire';
import { FrictionNuit } from './FrictionNuit';

export type TypeException = DemandeException['type'];

export const LIBELLES_EXCEPTION: Record<TypeException, string> = {
  ajoute: 'Ajouter un engagement',
  retire: 'Retirer un engagement',
  decale: 'Décaler un engagement',
  coucher: 'Décaler le coucher',
  avancer_coucher: 'Je vais dormir',
};
const TYPES = Object.keys(LIBELLES_EXCEPTION) as TypeException[];

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

function ChampsDuType({
  champs,
  modifier,
  journee,
  maintenantMs,
}: {
  champs: Champs;
  modifier: (patch: Partial<Champs>) => void;
  journee: Journee;
  maintenantMs: number;
}) {
  const date = (
    <Champ id="exception-date" libelle="Jour de l'engagement">
      <Input id="exception-date" type="date" value={champs.date} onChange={(e) => modifier({ date: e.target.value })} />
    </Champ>
  );
  const engagement = (
    <Champ id="exception-engagement" libelle="Engagement" aide="Identifiant de la config, ex. : sport.">
      <Input
        id="exception-engagement"
        list="engagements-connus"
        value={champs.engagement}
        onChange={(e) => modifier({ engagement: e.target.value })}
        autoCapitalize="none"
      />
      <datalist id="engagements-connus">
        {journee.engagements.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
    </Champ>
  );

  switch (champs.type) {
    case 'ajoute':
      return (
        <>
          {date}
          <Champ id="exception-libelle" libelle="Libellé">
            <Input id="exception-libelle" value={champs.libelle} onChange={(e) => modifier({ libelle: e.target.value })} />
          </Champ>
          <div role="radiogroup" aria-label="Forme de l'engagement" className="flex flex-wrap gap-4 text-sm">
            {(['heure', 'reveil'] as const).map((forme) => (
              <label key={forme} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="forme-ajout"
                  className="accent-primary size-4"
                  checked={champs.formeAjout === forme}
                  onChange={() => modifier({ formeAjout: forme })}
                />
                {forme === 'heure' ? 'Heure + préparation' : 'Heure de réveil'}
              </label>
            ))}
          </div>
          {champs.formeAjout === 'heure' ? (
            <div className="grid grid-cols-2 gap-4">
              <Champ id="exception-heure" libelle="Heure">
                <Input id="exception-heure" type="time" value={champs.heure} onChange={(e) => modifier({ heure: e.target.value })} />
              </Champ>
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
            </div>
          ) : (
            <Champ id="exception-reveil" libelle="Réveil">
              <Input id="exception-reveil" type="time" value={champs.reveil} onChange={(e) => modifier({ reveil: e.target.value })} />
            </Champ>
          )}
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
          <Champ id="exception-heure" libelle="Nouvelle heure">
            <Input id="exception-heure" type="time" value={champs.heure} onChange={(e) => modifier({ heure: e.target.value })} />
          </Champ>
        </>
      );
    case 'coucher':
      return (
        <>
          <Champ id="exception-nuit" libelle="Nuit du">
            <Input id="exception-nuit" type="date" value={champs.nuit} onChange={(e) => modifier({ nuit: e.target.value })} />
          </Champ>
          <Champ id="exception-heure" libelle="Nouvelle heure de coucher" aide="Une heure après minuit compte pour la nuit commencée la veille.">
            <Input id="exception-heure" type="time" value={champs.heure} onChange={(e) => modifier({ heure: e.target.value })} />
          </Champ>
        </>
      );
    case 'avancer_coucher':
      return (
        <p className="text-sm">
          Le coucher passe à maintenant ({formaterHeure(versInstant(maintenantMs), journee.fuseau)}) : la nuit commence tout de suite.
          Toujours permis.
        </p>
      );
  }
}

export function FormulaireException({ typeImpose, decisionDeNuit = false }: { typeImpose?: TypeException; decisionDeNuit?: boolean }) {
  const { api, rafraichir } = useFocus();
  const { journee } = useStatut();
  const maintenant = useHeureServeur();
  const [champs, setChamps] = useState(() => champsInitiaux(journee, typeImpose ?? 'coucher'));
  const [prix, setPrix] = useState<PrixException | null>(null);
  const [raison, setRaison] = useState('');
  const [phrase, setPhrase] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  const frictionExigee = decisionDeNuit || prix?.friction === 'raison_phrase';
  const friction = validerFriction(raison, phrase);
  const verrouille = decisionDeNuit && journee.decisionDeNuitPrise;
  const peutValider = prix !== null && prix.admissible && (!frictionExigee || friction.valide) && !enCours && !verrouille;

  function modifier(patch: Partial<Champs>) {
    setChamps((c) => ({ ...c, ...patch }));
    setPrix(null);
    setErreur(null);
    setSucces(null);
  }

  function demandeSaisie(): DemandeException | null {
    const r = construireDemande(champs, maintenant);
    if ('manque' in r) {
      setErreur(new ErreurFocus('saisie_incomplete', r.manque));
      return null;
    }
    return r.demande;
  }

  const frictionFournie = () => (frictionExigee && friction.valide ? { raison: raison.trim(), phrase } : undefined);

  async function voirPrix() {
    const demande = demandeSaisie();
    if (!demande) return;
    setEnCours(true);
    setErreur(null);
    setSucces(null);
    try {
      setPrix(await api.prixException({ demande, friction: frictionFournie() }));
    } catch (e) {
      setPrix(null);
      setErreur(versErreurFocus(e));
    } finally {
      setEnCours(false);
    }
  }

  async function valider() {
    const demande = demandeSaisie();
    if (!demande) return;
    setEnCours(true);
    setErreur(null);
    try {
      await api.enregistrerException({ demande, friction: frictionFournie() });
      setSucces('Exception enregistrée.');
      setPrix(null);
      setRaison('');
      setPhrase('');
      setChamps(champsInitiaux(journee, champs.type));
      await rafraichir();
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void voirPrix();
        }}
      >
        <fieldset disabled={verrouille || enCours} className="grid gap-4">
          {typeImpose ? null : (
            <Champ id="exception-type" libelle="Exception">
              <Selecteur id="exception-type" value={champs.type} onChange={(e) => modifier({ type: e.target.value as TypeException })}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LIBELLES_EXCEPTION[t]}
                  </option>
                ))}
              </Selecteur>
            </Champ>
          )}
          <ChampsDuType champs={champs} modifier={modifier} journee={journee} maintenantMs={maintenant} />
        </fieldset>
        <Button type="submit" variant="outline" disabled={verrouille || enCours}>
          {prix ? 'Recalculer le prix' : 'Voir le prix'}
        </Button>
      </form>

      {prix ? <ApercuPrix prix={prix} fuseau={journee.fuseau} maintenantMs={maintenant} /> : null}

      {frictionExigee ? (
        <FrictionNuit raison={raison} phrase={phrase} onRaison={setRaison} onPhrase={setPhrase} desactive={verrouille || enCours} />
      ) : null}

      <Button type="button" onClick={() => void valider()} disabled={!peutValider}>
        Valider l'exception
      </Button>
      {prix === null && !verrouille ? (
        <p className="text-muted-foreground text-xs">Le bouton s'active une fois le prix affiché et accepté.</p>
      ) : null}

      <ErreurAffichee erreur={erreur} />
      <Succes message={succes} />
    </div>
  );
}
