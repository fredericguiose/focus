import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { fr } from 'react-day-picker/locale/fr';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formaterDateCourte } from '@/lib/temps';

const versDate = (date: string) => {
  const [a, m, j] = date.split('-').map(Number);
  return new Date(a ?? 0, (m ?? 1) - 1, j ?? 1);
};
const depuisDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Date locale (AAAA-MM-JJ) choisie dans un calendrier. */
export function ChoixDate({ id, valeur, surChoix }: { id: string; valeur: string; surChoix: (date: string) => void }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" className="w-full justify-start font-normal">
          <CalendarDays className="text-muted-foreground" />
          {valeur ? formaterDateCourte(valeur) : 'Choisir une date'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={fr}
          selected={valeur ? versDate(valeur) : undefined}
          defaultMonth={valeur ? versDate(valeur) : undefined}
          onSelect={(d) => {
            if (d) surChoix(depuisDate(d));
            setOuvert(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
