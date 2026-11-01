// Libellés et couleurs des modes (conception §2.5). Les classes sont écrites en entier pour que
// Tailwind les trouve.
export type FamilleMode = 'nuit' | 'matin' | 'travail' | 'soiree' | 'inconnu';

export interface InfoMode {
  famille: FamilleMode;
  libelle: string;
}

const MODES: Record<string, InfoMode> = {
  NIGHT_LOCK: { famille: 'nuit', libelle: 'Nuit' },
  MORNING_LOCK: { famille: 'matin', libelle: 'Journée verrouillée' },
  WORK: { famille: 'travail', libelle: 'Travail' },
  EVENING_FREE: { famille: 'soiree', libelle: 'Soirée libre' },
};

export const STYLES_FAMILLE: Record<FamilleMode, { texte: string; fond: string; doux: string; bordure: string; degrade: string; indicateur: string }> = {
  nuit: {
    texte: 'text-mode-nuit',
    fond: 'bg-mode-nuit',
    doux: 'bg-mode-nuit/10',
    bordure: 'border-mode-nuit/30',
    degrade: 'from-mode-nuit/15 via-mode-nuit/5',
    indicateur: '[&>[data-slot=progress-indicator]]:bg-mode-nuit',
  },
  matin: {
    texte: 'text-mode-matin',
    fond: 'bg-mode-matin',
    doux: 'bg-mode-matin/10',
    bordure: 'border-mode-matin/30',
    degrade: 'from-mode-matin/15 via-mode-matin/5',
    indicateur: '[&>[data-slot=progress-indicator]]:bg-mode-matin',
  },
  travail: {
    texte: 'text-mode-travail',
    fond: 'bg-mode-travail',
    doux: 'bg-mode-travail/10',
    bordure: 'border-mode-travail/30',
    degrade: 'from-mode-travail/15 via-mode-travail/5',
    indicateur: '[&>[data-slot=progress-indicator]]:bg-mode-travail',
  },
  soiree: {
    texte: 'text-mode-soiree',
    fond: 'bg-mode-soiree',
    doux: 'bg-mode-soiree/10',
    bordure: 'border-mode-soiree/30',
    degrade: 'from-mode-soiree/15 via-mode-soiree/5',
    indicateur: '[&>[data-slot=progress-indicator]]:bg-mode-soiree',
  },
  inconnu: {
    texte: 'text-mode-inconnu',
    fond: 'bg-mode-inconnu',
    doux: 'bg-mode-inconnu/10',
    bordure: 'border-mode-inconnu/30',
    degrade: 'from-mode-inconnu/15 via-mode-inconnu/5',
    indicateur: '[&>[data-slot=progress-indicator]]:bg-mode-inconnu',
  },
};

export function infoMode(code: string): InfoMode {
  const connu = MODES[code];
  if (connu) return connu;
  const lisible = code.toLowerCase().replace(/_/g, ' ');
  return { famille: 'inconnu', libelle: lisible.charAt(0).toUpperCase() + lisible.slice(1) };
}

/** « WORK — tâches prioritaires restantes : 2 » → « Tâches prioritaires restantes : 2 ». */
export function raisonLisible(raison: string): string {
  // Le code du mode en tête est retiré ; un code cité plus loin (« EVENING_FREE non atteint ») prend son nom.
  const sansCode = raison
    .replace(/^[A-Z][A-Z_]*\s*[—–-]\s*/, '')
    .replace(/\b[A-Z][A-Z]+(?:_[A-Z]+)+\b/g, (code) => infoMode(code).libelle)
    .trim();
  return sansCode.charAt(0).toUpperCase() + sansCode.slice(1);
}
