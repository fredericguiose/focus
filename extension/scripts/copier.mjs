// Copie les fichiers non compilés (manifest, pages, styles, icônes) à côté du JS produit par tsc.
import { cpSync } from 'node:fs';

cpSync(new URL('../statique/', import.meta.url), new URL('../dist/', import.meta.url), { recursive: true });
