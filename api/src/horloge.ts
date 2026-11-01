// Horloge réglable, pour essayer les états de la journée en local seulement (docs/essai-local.md).
// Hors FOCUS_ENVIRONNEMENT=local, elle rend toujours l'heure réelle.
import { requeteInvalide } from './erreurs';
import { versInstant } from './temps';

export interface VariablesHorloge {
  FOCUS_ENVIRONNEMENT?: string;
  FOCUS_HORLOGE?: string;
}

/** Instant figé, ou décalage appliqué à l'heure réelle. */
export type Reglage = { fixe: number } | { decalageMs: number };

const RE_DECALAGE = /^([+-])(?:(\d+)h)?(?:(\d+)(?:min)?)?$/;
const RE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** "+3h", "-90min", "+1h30", ou un instant ISO 8601 avec fuseau. `undefined` si illisible. */
export function lireReglage(texte: string): Reglage | undefined {
  const t = texte.trim();
  const d = RE_DECALAGE.exec(t);
  if (d && (d[2] !== undefined || d[3] !== undefined)) {
    const minutes = Number(d[2] ?? 0) * 60 + Number(d[3] ?? 0);
    return { decalageMs: (d[1] === '-' ? -1 : 1) * minutes * 60_000 };
  }
  if (RE_INSTANT.test(t) && !Number.isNaN(Date.parse(t))) return { fixe: Date.parse(t) };
  return undefined;
}

function decrire(r: Reglage | null): string | null {
  if (r === null) return null;
  if ('fixe' in r) return versInstant(r.fixe);
  const m = Math.round(r.decalageMs / 60_000);
  return `${m < 0 ? '-' : '+'}${Math.abs(m)}min`;
}

export class HorlogeLocale {
  /** Réglage posé à chaud par POST /v1/dev/horloge ; `undefined` = celui de FOCUS_HORLOGE. */
  private aChaud: Reglage | null | undefined;
  private averti = new Set<string>();

  constructor(
    private readonly variables: () => VariablesHorloge,
    private readonly reelle: () => Date = () => new Date(),
  ) {}

  estLocale(): boolean {
    return this.variables().FOCUS_ENVIRONNEMENT === 'local';
  }

  private avertir(message: string): void {
    if (this.averti.has(message)) return;
    this.averti.add(message);
    console.warn(message);
  }

  private reglage(): Reglage | null {
    const { FOCUS_HORLOGE: texte } = this.variables();
    if (!this.estLocale()) {
      if (texte) this.avertir('FOCUS_HORLOGE ignorée : FOCUS_ENVIRONNEMENT n\'est pas « local », horloge réelle.');
      return null;
    }
    if (this.aChaud !== undefined) return this.aChaud;
    if (!texte) return null;
    const r = lireReglage(texte);
    if (!r) this.avertir(`FOCUS_HORLOGE illisible (« ${texte} ») : horloge réelle.`);
    return r ?? null;
  }

  maintenant = (): Date => {
    const r = this.reglage();
    if (r === null) return this.reelle();
    return new Date('fixe' in r ? r.fixe : this.reelle().getTime() + r.decalageMs);
  };

  /** `null` = horloge réelle jusqu'au prochain réglage. Ne doit être appelé qu'en local. */
  regler(valeur: unknown): { reglage: string | null; heure_serveur: string } {
    if (valeur === null) {
      this.aChaud = null;
    } else {
      const r = typeof valeur === 'string' ? lireReglage(valeur) : undefined;
      if (!r) {
        throw requeteInvalide('Champ « horloge » : un instant ISO 8601 (« 2026-11-03T21:00:00Z »), un décalage (« +3h », « -90min ») ou null.', {
          champ: 'horloge',
        });
      }
      this.aChaud = r;
    }
    return this.etat();
  }

  etat(): { reglage: string | null; heure_serveur: string } {
    return { reglage: decrire(this.reglage()), heure_serveur: versInstant(this.maintenant()) };
  }
}
