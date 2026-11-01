import { AlarmClock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChoixDate } from '@/composants/ChoixDate';
import { Champ } from '@/composants/formulaire';
import { type ChampsAjout as Champs, PREPARATIONS_MIN, reveilDe } from '@/lib/engagement';
import { formaterDateCourte } from '@/lib/temps';

/**
 * « Ajouter un engagement » : libellé, heure du rendez-vous, préparation en boutons ; le réveil
 * qui en découle est affiché. Le jour est demain, sauf si l'on choisit « autre jour ».
 */
export function ChampsAjout({
  champs,
  modifier,
  demain,
}: {
  champs: Champs;
  modifier: (patch: Partial<Champs>) => void;
  demain: string;
}) {
  const reveil = reveilDe(champs.heure, champs.preparationMin);
  const autreJour = champs.date !== demain;

  return (
    <div className="grid gap-4">
      {autreJour ? (
        <Champ
          id="ajout-date"
          libelle="Jour"
          aide={
            <Button type="button" variant="link" size="sm" className="text-muted-foreground h-auto p-0 text-xs" onClick={() => modifier({ date: demain })}>
              revenir à demain
            </Button>
          }
        >
          <ChoixDate id="ajout-date" valeur={champs.date} surChoix={(date) => modifier({ date })} />
        </Champ>
      ) : (
        <p className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-sm">
          <span>
            Demain, <span className="text-foreground font-medium">{formaterDateCourte(demain)}</span>
          </span>
          <Button type="button" variant="link" size="sm" className="text-muted-foreground h-auto p-0 text-xs" onClick={() => modifier({ date: '' })}>
            autre jour
          </Button>
        </p>
      )}

      <Champ id="ajout-libelle" libelle="Libellé">
        <Input id="ajout-libelle" value={champs.libelle} onChange={(e) => modifier({ libelle: e.target.value })} placeholder="ex. Dentiste" />
      </Champ>

      <Champ id="ajout-heure" libelle="Heure du rendez-vous">
        <Input id="ajout-heure" type="time" value={champs.heure} onChange={(e) => modifier({ heure: e.target.value })} className="tabular-nums" />
      </Champ>

      <div className="grid gap-2">
        <Label id="ajout-preparation">Temps de préparation</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          aria-labelledby="ajout-preparation"
          value={String(champs.preparationMin)}
          onValueChange={(v) => (v ? modifier({ preparationMin: Number(v) }) : undefined)}
          className="grid w-full grid-cols-5"
        >
          {PREPARATIONS_MIN.map((m) => (
            <ToggleGroupItem key={m} value={String(m)} aria-label={`${m} minutes`} className="tabular-nums">
              {m}
              <span className="text-muted-foreground text-xs">min</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="bg-muted/50 flex items-center gap-3 rounded-lg border px-3 py-2.5" aria-live="polite">
        <AlarmClock className="text-muted-foreground size-4" />
        {reveil ? (
          <span className="text-sm">
            Réveil à <span className="text-base font-semibold tabular-nums">{reveil.reveil}</span>
            {reveil.veille ? <span className="text-muted-foreground"> (la veille)</span> : null}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">Indiquez l'heure du rendez-vous.</span>
        )}
      </div>

    </div>
  );
}
