import { BedDouble, CalendarClock, CalendarPlus, CalendarX2, ChevronRight, Clock, Info, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { EnTeteEcran } from '@/composants/EnTeteEcran';
import { FenetreAdaptative } from '@/composants/FenetreAdaptative';
import { FormulaireException, LIBELLES_EXCEPTION, type TypeException } from '@/composants/FormulaireException';
import { useHeureServeur, useStatut } from '@/hooks/useFocus';
import { formaterHeure } from '@/lib/temps';
import { cn } from '@/lib/utils';

const CHOIX: { type: TypeException; icone: LucideIcon; description: string; resserre: boolean; classe: string }[] = [
  { type: 'avancer_coucher', icone: BedDouble, description: 'La nuit commence maintenant.', resserre: true, classe: 'bg-mode-nuit/12 text-mode-nuit' },
  { type: 'coucher', icone: Clock, description: 'Choisir une autre heure de coucher pour une nuit.', resserre: false, classe: 'bg-mode-soiree/12 text-mode-soiree' },
  { type: 'retire', icone: CalendarX2, description: "Retirer un engagement d'un jour.", resserre: false, classe: 'bg-destructive/10 text-destructive' },
  { type: 'decale', icone: CalendarClock, description: "Changer l'heure d'un engagement.", resserre: false, classe: 'bg-mode-matin/12 text-mode-matin' },
  { type: 'ajoute', icone: CalendarPlus, description: 'Un rendez-vous qui avance le lever.', resserre: true, classe: 'bg-mode-travail/12 text-mode-travail' },
];

export function EcranExceptions() {
  const { journee: j } = useStatut();
  const maintenant = useHeureServeur();
  const [choisi, setChoisi] = useState<TypeException | null>(null);
  const [type, setType] = useState<TypeException>('coucher');
  const [filtre, setFiltre] = useState<'tout' | 'resserre' | 'desserre'>('tout');
  const visibles = CHOIX.filter((c) => filtre === 'tout' || (filtre === 'resserre') === c.resserre);
  const soireeOuverte = maintenant >= Date.parse(j.ouverture);
  const info = CHOIX.find((c) => c.type === type);

  return (
    <div className="grid gap-6">
      <EnTeteEcran
        titre="Exceptions"
        description="Resserrer (coucher plus tôt, engagement ajouté ou avancé) est toujours permis. Desserrer après l'ouverture de la soirée exige la décision de nuit."
      />

      <Alert>
        <Info />
        <AlertTitle>{soireeOuverte ? 'La soirée est ouverte' : `Soirée ouverte à ${formaterHeure(j.ouverture, j.fuseau)}`}</AlertTitle>
        <AlertDescription>
          {soireeOuverte
            ? 'Desserrer cette nuit demande une raison et la phrase exacte, une fois par nuit.'
            : 'Jusque-là, desserrer est sans friction tant que le sommeil reste au-dessus du minimum.'}
        </AlertDescription>
      </Alert>

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label="Filtrer les exceptions"
        value={filtre}
        onValueChange={(v) => (v === 'tout' || v === 'resserre' || v === 'desserre' ? setFiltre(v) : undefined)}
        className="w-full sm:w-auto"
      >
        <ToggleGroupItem value="tout" className="flex-1 px-3 sm:flex-none">
          Toutes
        </ToggleGroupItem>
        <ToggleGroupItem value="resserre" className="flex-1 px-3 sm:flex-none">
          Toujours permises
        </ToggleGroupItem>
        <ToggleGroupItem value="desserre" className="flex-1 px-3 sm:flex-none">
          Avec un prix
        </ToggleGroupItem>
      </ToggleGroup>

      <div className="-mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibles.map((c) => {
          const Icone = c.icone;
          return (
            <button
              key={c.type}
              type="button"
              className="group focus-visible:ring-ring/50 rounded-xl text-left outline-none focus-visible:ring-[3px]"
              onClick={() => {
                setType(c.type);
                setChoisi(c.type);
              }}
            >
              <Card className="group-hover:border-foreground/20 h-full gap-0 py-4 transition-colors group-hover:shadow-md">
                <CardHeader className="grid-cols-[auto_1fr_auto] items-start gap-x-4 gap-y-1 px-4">
                  <span className={cn('row-span-3 flex size-11 items-center justify-center rounded-xl', c.classe)}>
                    <Icone className="size-5" />
                  </span>
                  <CardTitle className="pt-0.5 text-base">{LIBELLES_EXCEPTION[c.type]}</CardTitle>
                  <ChevronRight className="text-muted-foreground row-span-3 size-4 self-center transition-transform group-hover:translate-x-0.5" />
                  <CardDescription className="col-start-2">{c.description}</CardDescription>
                  <div className="col-start-2 pt-1">
                    {c.resserre ? (
                      <Badge variant="outline" className="text-succes border-succes/40 font-normal">
                        Toujours permis
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground font-normal">
                        {soireeOuverte ? 'Décision de nuit si desserre' : 'Sans friction avant la soirée'}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
              </Card>
            </button>
          );
        })}
      </div>

      <FenetreAdaptative
        ouverte={choisi !== null}
        surChangement={(o) => setChoisi(o ? type : null)}
        titre={LIBELLES_EXCEPTION[type]}
        description={info?.description}
      >
        {/* La clé remet le formulaire à zéro à chaque ouverture. */}
        {choisi ? <FormulaireException key={choisi} type={choisi} surTermine={() => setChoisi(null)} /> : null}
      </FenetreAdaptative>
    </div>
  );
}
