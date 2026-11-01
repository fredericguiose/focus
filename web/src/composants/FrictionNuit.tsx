import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PHRASE_NUIT, RAISON_MIN, validerFriction } from '@/lib/decisionNuit';
import { cn } from '@/lib/utils';
import { Champ } from './formulaire';

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
    <fieldset disabled={desactive} className="grid gap-4">
      <Champ
        id="friction-raison"
        libelle={`Raison (au moins ${RAISON_MIN} caractères)`}
        aide={
          <span aria-live="polite" className={cn('tabular-nums', v.raisonOk ? 'text-succes' : 'text-muted-foreground')}>
            {v.longueur} / {RAISON_MIN} caractères
          </span>
        }
      >
        <Textarea id="friction-raison" value={raison} onChange={(e) => onRaison(e.target.value)} rows={3} />
      </Champ>
      <Champ
        id="friction-phrase"
        libelle={`Recopiez : ${PHRASE_NUIT}`}
        aide={phrase && !v.phraseOk ? `La phrase doit être exactement « ${PHRASE_NUIT} ».` : undefined}
      >
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
        />
      </Champ>
    </fieldset>
  );
}
