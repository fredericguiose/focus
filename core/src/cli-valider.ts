/// <reference types="node" />
// Valide un fichier de configuration : npm run valider -- <fichier.yaml>
// Code de sortie : 0 si valide, 1 si refusé, 2 si l'appel est faux.

import { readFileSync } from 'node:fs';
import { validerConfig } from './config';

const fichier = process.argv[2];
if (!fichier || process.argv.length > 3) {
  console.error('usage : npm run valider -- <fichier.yaml>');
  process.exit(2);
}

let yaml: string;
try {
  yaml = readFileSync(fichier, 'utf8');
} catch (e) {
  console.error(`lecture impossible de ${fichier} : ${(e as Error).message}`);
  process.exit(2);
}

const r = validerConfig(yaml);
if (r.ok) {
  const c = r.config;
  console.log(
    `${fichier} : configuration valide (${Object.keys(c.modes).length} modes, ` +
      `${Object.keys(c.routines).length} routines, ${Object.keys(c.apps).length} apps, ` +
      `${Object.keys(c.appareils).length} appareils)`,
  );
  process.exit(0);
}
console.error(`${fichier} : configuration refusée (${r.erreurs.length} erreur${r.erreurs.length > 1 ? 's' : ''})`);
for (const e of r.erreurs) console.error(`- ${e}`);
process.exit(1);
