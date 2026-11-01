import { CalendarCog, Gauge, Layers, MoonStar, type LucideIcon } from 'lucide-react';

export const ECRANS = {
  statut: { libelle: 'Statut', icone: Gauge },
  sessions: { libelle: 'Sessions', icone: Layers },
  exceptions: { libelle: 'Exceptions', icone: CalendarCog },
  nuit: { libelle: 'Nuit', icone: MoonStar },
} as const satisfies Record<string, { libelle: string; icone: LucideIcon }>;

export type Ecran = keyof typeof ECRANS;
export const LISTE_ECRANS = Object.keys(ECRANS) as Ecran[];
export const estEcran = (valeur: string): valeur is Ecran => Object.hasOwn(ECRANS, valeur);
