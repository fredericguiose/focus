import { Gauge, Layers, type LucideIcon, Plug } from 'lucide-react';

export const ECRANS = {
  statut: { libelle: 'Tableau de bord', icone: Gauge },
  sessions: { libelle: 'Sessions', icone: Layers },
  connecteurs: { libelle: 'Connecteurs', icone: Plug },
} as const satisfies Record<string, { libelle: string; icone: LucideIcon }>;

export type Ecran = keyof typeof ECRANS;
export const LISTE_ECRANS = Object.keys(ECRANS) as Ecran[];
export const estEcran = (valeur: string): valeur is Ecran => Object.hasOwn(ECRANS, valeur);
