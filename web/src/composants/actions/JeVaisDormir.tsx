import { CircleCheck, Loader2, Lock, MoonStar, Sunrise } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { ErreurAffichee } from '@/composants/ErreurAffichee';
import { useFocus, useHeureServeur, useStatut } from '@/hooks/useFocus';
import {
  bilan,
  type ChoixCoucher,
  choixCoucher,
  commenceMaintenant,
  detteARattraper,
  heureSuggeree,
  heuresProposees,
  indexChoix,
  objectifDuSoir,
  texteBilan,
  texteGain,
  texteSemaine,
} from '@/lib/dette';
import { formaterDuree, formaterHeure, heureLocale, versInstant } from '@/lib/temps';
import { cn } from '@/lib/utils';

/**
 * D'où vient la fenêtre : le bouton « Je vais dormir » (curseur sur maintenant, « Annuler ») ou la
 * proposition du soir quand il y a une dette à rattraper (curseur sur l'heure suggérée, « Plus tard »).
 */
export type OrigineDormir = 'bouton' | 'proposition';

const MINUTE = 60_000;

function Contenu({ origine, fermer }: { origine: OrigineDormir; fermer: () => void }) {
  const { api, rafraichir } = useFocus();
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const j = statut.journee;
  const coucher = Date.parse(j.coucherApplique);
  const choix = choixCoucher(statut, maintenant);
  const dette = detteARattraper(statut);
  const objectif = dette ? objectifDuSoir(dette.resteMin, dette.nuits) : 0;

  // Le curseur démarre sur maintenant (bouton) ou sur l'heure suggérée (proposition). L'heure
  // choisie est gardée telle quelle : les crans glissent avec l'horloge (borne gauche).
  const [choisi, setChoisi] = useState<ChoixCoucher>(() =>
    origine === 'proposition' ? (heureSuggeree(heuresProposees(statut, maintenant), objectif) ?? 'maintenant') : 'maintenant',
  );
  const index = indexChoix(choix, choisi);
  const cran = choix[index] ?? 'maintenant';
  const toutDeSuite = commenceMaintenant(cran, maintenant);
  const instant = cran === 'maintenant' ? maintenant : cran;
  const hhmm = heureLocale(instant, j.fuseau);
  const { gainMin, progression } = bilan(coucher, instant, objectif);
  const texte = dette ? texteBilan(gainMin, objectif) : texteGain(gainMin);
  const dans = Math.round((instant - maintenant) / MINUTE);

  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);

  async function confirmer() {
    setEnvoi(true);
    setErreur(null);
    try {
      if (toutDeSuite) {
        // La nuit commence maintenant : `avancer_coucher` à l'heure du serveur.
        await api.enregistrerException({ demande: { type: 'avancer_coucher', nuit: j.date, a: versInstant(maintenant) } });
        toast.success('Bonne nuit', { description: 'La nuit a commencé.' });
      } else {
        // Coucher plus tôt = resserrement : exception `coucher`, libre, lever inchangé.
        await api.enregistrerException({ demande: { type: 'coucher', nuit: j.date, heure: hhmm } });
        toast.success(`Coucher avancé à ${hhmm}`, { description: `+${formaterDuree(gainMin)} de sommeil cette nuit. Bonne soirée !` });
      }
      await rafraichir();
      fermer();
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setEnvoi(false);
    }
  }

  const atteint = dette !== null && gainMin > 0 && gainMin >= objectif;
  const titre = origine === 'proposition' && dette ? `Ce soir : ${formaterDuree(objectif)} de sommeil en plus` : 'Je vais dormir';
  const description = dette ? texteSemaine(dette.resteMin, dette.nuits) : 'Choisis ton heure de coucher, maintenant ou un peu plus tard.';

  return (
    <>
      <DialogHeader className="items-center text-center sm:items-start sm:text-left">
        <span className="bg-mode-nuit/12 text-mode-nuit mb-1 flex size-11 items-center justify-center rounded-full">
          <MoonStar className="size-5" />
        </span>
        <DialogTitle className="text-xl leading-tight text-balance">{titre}</DialogTitle>
        <DialogDescription className="text-balance">{description}</DialogDescription>
      </DialogHeader>

      <div className="from-mode-nuit/10 to-muted/40 grid gap-4 rounded-2xl bg-gradient-to-b px-4 pt-4 pb-5">
        <div className="grid justify-items-center gap-0.5 text-center">
          <span id="dormir-question" className="text-muted-foreground text-sm">
            À quelle heure tu te couches ?
          </span>
          <span className="text-mode-nuit text-5xl font-semibold tracking-tight tabular-nums" aria-live="polite">
            {hhmm}
          </span>
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {cran === 'maintenant' ? 'maintenant' : toutDeSuite ? 'dans un instant' : `dans ${formaterDuree(dans)}`}
          </span>
        </div>
        {choix.length > 1 ? (
          <>
            <Slider
              min={0}
              max={choix.length - 1}
              step={1}
              inverted
              value={[index]}
              onValueChange={([k]) => setChoisi(choix[k ?? 0] ?? 'maintenant')}
              disabled={envoi}
              className="py-2 [&_[data-slot=slider-range]]:bg-mode-nuit [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-mode-nuit/15"
              thumbProps={{
                'aria-labelledby': 'dormir-question',
                'aria-valuetext': `${cran === 'maintenant' ? `maintenant, ${hhmm}` : hhmm}, ${texte}`,
                className: 'size-6 border-2 border-mode-nuit bg-background shadow-md ring-mode-nuit/25',
              }}
            />
            <div className="text-muted-foreground -mt-2 flex justify-between text-xs">
              <span>maintenant</span>
              <span className="tabular-nums">prévu {formaterHeure(j.coucherApplique, j.fuseau)}</span>
            </div>
          </>
        ) : null}
        {dette ? (
          <div className="grid gap-2">
            <Progress
              value={progression}
              aria-label="Objectif du soir"
              getValueLabel={() => texte}
              className="bg-succes/15 h-2 [&>[data-slot=progress-indicator]]:bg-succes [&>[data-slot=progress-indicator]]:duration-300"
            />
            <p
              className={cn(
                'flex min-h-6 items-center justify-center gap-1.5 text-center text-sm font-medium tabular-nums',
                gainMin > 0 ? 'text-succes' : 'text-muted-foreground font-normal',
              )}
            >
              {atteint ? <CircleCheck className="size-4 shrink-0" /> : null}
              {texte}
            </p>
          </div>
        ) : (
          <p
            className={cn(
              'flex min-h-6 items-center justify-center text-center text-sm tabular-nums',
              gainMin > 0 ? 'text-succes font-medium' : 'text-muted-foreground',
            )}
          >
            {texte}
          </p>
        )}
      </div>

      <ul className="text-muted-foreground grid gap-2 text-sm">
        <li className="flex items-start gap-2.5">
          <Sunrise className="mt-0.5 size-4 shrink-0" />
          <span>
            Lever demain inchangé : <span className="text-foreground font-medium tabular-nums">{formaterHeure(j.leverSuivant, j.fuseau)}</span>
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            {toutDeSuite
              ? 'La nuit commence maintenant : le PC se verrouille dans moins d’une minute.'
              : 'Cette heure devient ton coucher : le PC se verrouille à ce moment-là.'}
          </span>
        </li>
      </ul>

      <ErreurAffichee erreur={erreur} />

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Button
          size="lg"
          className="bg-mode-nuit hover:bg-mode-nuit/90 h-12 text-base text-white sm:order-2"
          disabled={(!toutDeSuite && gainMin <= 0) || envoi}
          onClick={() => void confirmer()}
        >
          {envoi ? <Loader2 className="animate-spin" /> : null}
          {toutDeSuite ? 'Commencer la nuit' : `Je me couche à ${hhmm}`}
        </Button>
        <Button variant="ghost" size="lg" className="h-12 sm:order-1" disabled={envoi} onClick={fermer}>
          {origine === 'proposition' ? 'Plus tard' : 'Annuler'}
        </Button>
      </div>
    </>
  );
}

/**
 * « Je vais dormir » : une seule fenêtre au curseur, de maintenant (gauche) au coucher appliqué
 * (droite). Maintenant → la nuit commence (`avancer_coucher`) ; une heure plus tôt que le coucher
 * → exception `coucher`. S'il y a une dette de la semaine, elle affiche aussi l'objectif du soir.
 */
export function JeVaisDormir({
  ouverte,
  surChangement,
  origine = 'bouton',
}: {
  ouverte: boolean;
  surChangement: (ouverte: boolean) => void;
  origine?: OrigineDormir;
}) {
  const statut = useStatut();
  const maintenant = useHeureServeur();
  // La nuit a commencé pendant qu'elle était ouverte : plus rien à choisir.
  const visible = ouverte && choixCoucher(statut, maintenant).length > 0;

  return (
    <Dialog open={visible} onOpenChange={surChangement}>
      <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto sm:max-w-md">
        {visible ? <Contenu origine={origine} fermer={() => surChangement(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
