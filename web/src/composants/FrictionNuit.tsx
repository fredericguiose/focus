import { Check } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { PHRASE_NUIT, RAISON_MIN, validerFriction } from '@/lib/decisionNuit';
import { cn } from '@/lib/utils';

export function FrictionNuit({
  raison,
  phrase,
  onRaison,
  onPhrase,
  desactive = false,
}: {
  raison: string;
  phrase: string;
  onRaison: (valeur: string) => void;
  onPhrase: (valeur: string) => void;
  desactive?: boolean;
}) {
  const v = validerFriction(raison, phrase);
  return (
    <fieldset disabled={desactive} className="grid gap-5 disabled:opacity-60">
      <div className="grid gap-2">
        <Label htmlFor="friction-raison">Raison (au moins {RAISON_MIN} caractères)</Label>
        <Textarea
          id="friction-raison"
          value={raison}
          onChange={(e) => onRaison(e.target.value)}
          rows={3}
          placeholder="Pourquoi ce soir, précisément, ne peut-il pas se passer comme prévu ?"
        />
        <div className="flex items-center gap-3">
          <Progress
            value={Math.min(100, (v.longueur / RAISON_MIN) * 100)}
            aria-label="Longueur de la raison"
            className={cn('h-1.5 flex-1', v.raisonOk && '[&>[data-slot=progress-indicator]]:bg-succes')}
          />
          <span aria-live="polite" className={cn('text-xs tabular-nums', v.raisonOk ? 'text-succes font-medium' : 'text-muted-foreground')}>
            {v.longueur} / {RAISON_MIN} caractères
          </span>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="friction-phrase">Recopiez la phrase ci-dessous</Label>
        <p className="bg-muted rounded-md px-3 py-2 text-center font-mono text-sm font-semibold tracking-wide select-none">{PHRASE_NUIT}</p>
        <div className="relative">
          <Input
            id="friction-phrase"
            value={phrase}
            onChange={(e) => onPhrase(e.target.value)}
            // La friction consiste à taper la phrase : le collage est refusé.
            onPaste={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={phrase !== '' && !v.phraseOk}
            className="pr-9 font-mono"
          />
          {v.phraseOk ? <Check className="text-succes absolute top-1/2 right-3 size-4 -translate-y-1/2" aria-label="Phrase correcte" /> : null}
        </div>
        {phrase && !v.phraseOk ? <p className="text-muted-foreground text-xs">La phrase doit être recopiée exactement, en majuscules.</p> : null}
      </div>
    </fieldset>
  );
}
