import { BedDouble, CircleCheck, Loader2, MoonStar, Sunrise } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { type ErreurFocus, versErreurFocus } from '@/api/erreur';
import { ErreurAffichee } from '@/composants/ErreurAffichee';
import { useFocus, useHeureServeur, useStatut } from '@/hooks/useFocus';
import { bilan, dejaProposee, detteARattraper, heuresProposees, marquerProposee, propositionPossible } from '@/lib/dette';
import { formaterDuree, formaterHeure, heureLocale } from '@/lib/temps';
import { cn } from '@/lib/utils';
import { useJeVaisDormir } from './JeVaisDormir';

/** « +1 h de sommeil · reste 1 h 30 », « +2 h 45 de sommeil · dette remboursée ». */
export function texteBilan(gainMin: number, resteMin: number): string {
  if (gainMin <= 0) return 'Glisse à gauche pour dormir plus.';
  return `+${formaterDuree(gainMin)} de sommeil · ${resteMin > 0 ? `reste ${formaterDuree(resteMin)}` : 'dette remboursée'}`;
}

function Contenu({ fermer }: { fermer: () => void }) {
  const { api, rafraichir } = useFocus();
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const j = statut.journee;
  const heures = heuresProposees(statut, maintenant);
  const dette = detteARattraper(statut) ?? 0;
  const coucher = heures[0] ?? Date.parse(j.coucherApplique);

  // L'heure choisie est gardée telle quelle : la liste glisse avec l'horloge (borne gauche).
  const [choisi, setChoisi] = useState(coucher);
  const trouve = heures.findIndex((h) => h <= choisi);
  const index = trouve === -1 ? Math.max(0, heures.length - 1) : trouve;
  const heure = heures[index] ?? coucher;
  const { gainMin, resteMin } = bilan(coucher, heure, dette);
  const hhmm = heureLocale(heure, j.fuseau);

  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<ErreurFocus | null>(null);
  const dormir = useJeVaisDormir(fermer);
  const occupe = envoi || dormir.envoi;

  async function confirmer() {
    setEnvoi(true);
    setErreur(null);
    dormir.setErreur(null);
    try {
      // Coucher plus tôt = resserrement : exception `coucher`, libre, lever inchangé.
      await api.enregistrerException({ demande: { type: 'coucher', nuit: j.date, heure: hhmm } });
      toast.success(`Coucher avancé à ${hhmm}`, { description: `+${formaterDuree(gainMin)} de sommeil cette nuit. Bonne soirée !` });
      await rafraichir();
      fermer();
    } catch (e) {
      setErreur(versErreurFocus(e));
    } finally {
      setEnvoi(false);
    }
  }

  const rembourse = gainMin > 0 && resteMin === 0;
  const pourcentage = dette > 0 ? (resteMin / dette) * 100 : 0;

  return (
    <>
      <DialogHeader className="items-center text-center sm:items-start sm:text-left">
        <span className="bg-mode-nuit/12 text-mode-nuit mb-1 flex size-11 items-center justify-center rounded-full">
          <MoonStar className="size-5" />
        </span>
        <DialogTitle className="text-xl leading-tight text-balance">Tu as {formaterDuree(dette)} de sommeil à rattraper</DialogTitle>
        <DialogDescription className="text-pretty">Te coucher un peu plus tôt ce soir, c'est la façon la plus simple de récupérer.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground font-medium">À rattraper</span>
          {gainMin > 0 ? (
            <span className="text-succes flex items-center gap-1.5 font-medium">
              <span className="bg-succes/60 size-2 rounded-full" /> regagné ce soir
            </span>
          ) : null}
        </div>
        <Progress
          value={pourcentage}
          aria-label="Sommeil à rattraper"
          getValueLabel={() => (resteMin > 0 ? `reste ${formaterDuree(resteMin)}` : 'dette remboursée')}
          className={cn(
            'h-3 transition-colors [&>[data-slot=progress-indicator]]:bg-mode-nuit [&>[data-slot=progress-indicator]]:duration-300',
            gainMin > 0 ? 'bg-succes/35' : 'bg-mode-nuit/15',
          )}
        />
      </div>

      <div className="bg-muted/50 grid gap-4 rounded-2xl px-4 pt-4 pb-5">
        <div className="grid justify-items-center gap-1 text-center">
          <span id="rattraper-question" className="text-muted-foreground text-sm">
            À quelle heure tu te couches ce soir ?
          </span>
          <span className="text-mode-nuit text-5xl font-semibold tracking-tight tabular-nums" aria-live="polite">
            {hhmm}
          </span>
        </div>
        <Slider
          min={0}
          max={Math.max(0, heures.length - 1)}
          step={1}
          inverted
          value={[index]}
          onValueChange={([k]) => setChoisi(heures[k ?? 0] ?? coucher)}
          disabled={occupe}
          className="py-2 [&_[data-slot=slider-range]]:bg-mode-nuit [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-mode-nuit/15"
          thumbProps={{
            'aria-labelledby': 'rattraper-question',
            'aria-valuetext': `${hhmm}, ${texteBilan(gainMin, resteMin)}`,
            className: 'size-6 border-2 border-mode-nuit bg-background shadow-md ring-mode-nuit/25',
          }}
        />
        <div className="text-muted-foreground -mt-2 flex justify-between text-xs">
          <span>plus tôt</span>
          <span>prévu</span>
        </div>
        <p
          className={cn(
            'flex min-h-6 items-center justify-center gap-1.5 text-center text-sm font-medium tabular-nums',
            gainMin > 0 ? 'text-succes' : 'text-muted-foreground font-normal',
          )}
        >
          {rembourse ? <CircleCheck className="size-4 shrink-0" /> : null}
          {texteBilan(gainMin, resteMin)}
        </p>
      </div>

      <ul className="text-muted-foreground grid gap-2 text-sm">
        <li className="flex items-start gap-2.5">
          <Sunrise className="mt-0.5 size-4 shrink-0" />
          <span>
            Lever demain inchangé : <span className="text-foreground font-medium tabular-nums">{formaterHeure(j.leverSuivant, j.fuseau)}</span>
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <BedDouble className="mt-0.5 size-4 shrink-0" />
          <span>Cette heure devient ton coucher : le mode nuit démarrera à ce moment-là.</span>
        </li>
      </ul>

      <ErreurAffichee erreur={erreur ?? dormir.erreur} />

      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          size="lg"
          className="bg-mode-nuit hover:bg-mode-nuit/90 h-12 text-base text-white sm:col-span-2"
          disabled={gainMin <= 0 || occupe}
          onClick={() => void confirmer()}
        >
          {envoi ? <Loader2 className="animate-spin" /> : null}
          Je me couche à {hhmm}
        </Button>
        <Button
          variant="outline"
          disabled={occupe}
          onClick={() => {
            setErreur(null);
            void dormir.confirmer();
          }}
        >
          {dormir.envoi ? <Loader2 className="animate-spin" /> : null}
          Me coucher maintenant
        </Button>
        <Button variant="ghost" disabled={occupe} onClick={fermer}>
          Plus tard
        </Button>
      </div>
    </>
  );
}

/**
 * Proposition de rattraper la dette de sommeil (facultative) : s'ouvre une fois par soir, à la
 * première ouverture du tableau de bord après l'ouverture de la soirée. Refermée, elle ne revient
 * pas ce soir-là.
 */
export function RattraperSommeil() {
  const statut = useStatut();
  const maintenant = useHeureServeur();
  const nuit = statut.journee.date;
  const possible = propositionPossible(statut, maintenant);
  const [ouverte, setOuverte] = useState(false);

  useEffect(() => {
    if (possible && !dejaProposee(nuit)) {
      marquerProposee(nuit);
      setOuverte(true);
    }
  }, [possible, nuit]);

  // Le coucher est passé (ou il ne reste rien à choisir) pendant qu'elle était ouverte.
  const vide = heuresProposees(statut, maintenant).length < 2;
  useEffect(() => {
    if (ouverte && vide) setOuverte(false);
  }, [ouverte, vide]);

  return (
    <Dialog open={ouverte && !vide} onOpenChange={setOuverte}>
      <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto sm:max-w-md">
        {ouverte && !vide ? <Contenu fermer={() => setOuverte(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
