#!/usr/bin/env node
// Retrouve l'identifiant iPhone (bundle id) d'une app, ou vérifie ceux d'une config.
//   node scripts/app-store.mjs "Nom de l'app"          → les 5 premiers résultats de l'App Store
//   node scripts/app-store.mjs --verifier focus.yaml   → vérifie chaque `iphone:` de la config
// Source : API publique de recherche de l'App Store (itunes.apple.com). Vérifier l'éditeur :
// des copies portent souvent le même nom.
import { readFileSync } from 'node:fs';

const PAYS = process.env.PAYS ?? 'fr';
const lire = async (url) => (await (await fetch(url)).json()).results ?? [];

const [premier, second] = process.argv.slice(2);
if (!premier) {
  console.error('Usage : node scripts/app-store.mjs "Nom de l\'app" | --verifier <config.yaml>');
  process.exit(1);
}
if (premier === '--verifier') {
  const texte = readFileSync(second, 'utf8');
  let erreurs = 0;
  for (const [, nom, id] of texte.matchAll(/^\s+([a-z_]+):\s*\{[^}\n]*iphone:\s*([A-Za-z0-9._-]+)/gm)) {
    const [r] = await lire(`https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(id)}&country=${PAYS}`);
    if (!r) erreurs++;
    console.log(`${nom.padEnd(18)} ${id.padEnd(34)} ${r ? `${r.trackName} — ${r.sellerName}` : 'INTROUVABLE'}`);
  }
  process.exit(erreurs ? 1 : 0);
}
for (const r of (await lire(`https://itunes.apple.com/search?term=${encodeURIComponent(premier)}&entity=software&country=${PAYS}&limit=5`))) {
  console.log(`${r.bundleId.padEnd(34)} ${r.trackName} — ${r.sellerName}`);
}
