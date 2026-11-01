// Formulaire « Ajouter un engagement » : libellé, heure de l'engagement, temps de préparation.
// Le réveil affiché est celui que l'API calculera (heure − préparation, conception §2.3).
import type { HeureLocale } from '../../../core/src/types';
import type { DemandeException } from '@/api/contrat';

export const PREPARATIONS_MIN = [15, 30, 45, 60, 90] as const;
export const PREPARATION_DEFAUT = 30;

const HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Réveil = heure − préparation ; `veille` si le réveil tombe avant minuit. */
export function reveilDe(heure: HeureLocale, preparationMin: number): { reveil: HeureLocale; veille: boolean } | null {
  const m = HEURE.exec(heure);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]) - preparationMin;
  const jour = 24 * 60;
  const borne = ((minutes % jour) + jour) % jour;
  return {
    reveil: `${String(Math.floor(borne / 60)).padStart(2, '0')}:${String(borne % 60).padStart(2, '0')}`,
    veille: minutes < 0,
  };
}

export interface ChampsAjout {
  date: string;
  libelle: string;
  heure: string;
  preparationMin: number;
}

export function demandeAjout(c: ChampsAjout): DemandeException | null {
  const libelle = c.libelle.trim();
  if (!c.date || !libelle || !HEURE.test(c.heure)) return null;
  return { type: 'ajoute', date: c.date, libelle, heure: c.heure, preparationMin: c.preparationMin };
}
