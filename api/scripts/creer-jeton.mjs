#!/usr/bin/env node
// Crée un jeton d'API : l'affiche une seule fois et écrit le SQL d'insertion de son empreinte.
// Le SQL n'est jamais exécuté ici : l'appliquer à la main, en local ou sur la base distante.
//   npm run jeton:creer -- <appareil|interface|config> <nom> [type_appareil] [--utilisateur <u>] [--sortie <fichier.sql>]
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const TYPES_JETON = ['appareil', 'interface', 'config'];
const TYPES_APPAREIL = ['pc_linux', 'pc_windows', 'iphone'];

function arreter(message) {
  console.error(`Erreur : ${message}`);
  console.error('Usage : npm run jeton:creer -- <appareil|interface|config> <nom> [type_appareil] [--utilisateur <u>] [--sortie <fichier.sql>]');
  process.exit(1);
}

const positionnels = [];
const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const valeur = args[i + 1];
    if (valeur === undefined) arreter(`valeur manquante pour ${args[i]}`);
    options[args[i].slice(2)] = valeur;
    i++;
  } else positionnels.push(args[i]);
}

const [typeJeton, nom, typeAppareilDonne] = positionnels;
if (!TYPES_JETON.includes(typeJeton)) arreter(`type de jeton « ${typeJeton ?? ''} » inconnu.`);
if (!nom || !/^[A-Za-z0-9_.-]{1,100}$/.test(nom)) arreter('nom manquant ou invalide (lettres, chiffres, _ . -).');

let typeAppareil = null;
if (typeJeton === 'appareil') {
  typeAppareil = typeAppareilDonne ?? (TYPES_APPAREIL.includes(nom) ? nom : undefined);
  if (!TYPES_APPAREIL.includes(typeAppareil)) arreter(`type d'appareil attendu : ${TYPES_APPAREIL.join(', ')}.`);
} else if (typeAppareilDonne) arreter("le type d'appareil ne vaut que pour un jeton « appareil ».");

const utilisateur = options.utilisateur ?? 'alice';
if (!/^[A-Za-z0-9_.-]{1,100}$/.test(utilisateur)) arreter('utilisateur invalide.');

const jeton = `focus_${randomBytes(32).toString('base64url')}`;
const empreinte = createHash('sha256').update(jeton).digest('hex');
const creeLe = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const sql = (v) => (v === null ? 'NULL' : `'${v.replaceAll("'", "''")}'`);
const insertion =
  `INSERT INTO appareils (utilisateur, nom, type_appareil, type_jeton, empreinte, cree_le) VALUES ` +
  `(${sql(utilisateur)}, ${sql(nom)}, ${sql(typeAppareil)}, ${sql(typeJeton)}, ${sql(empreinte)}, ${sql(creeLe)});\n`;

const sortie = options.sortie ?? `jeton-${typeJeton}-${nom}.sql`;
writeFileSync(sortie, insertion, { mode: 0o600 });

console.log(`Jeton ${typeJeton} « ${nom} » (utilisateur ${utilisateur}) — affiché une seule fois, à copier maintenant :\n`);
console.log(`  ${jeton}\n`);
console.log(`SQL d'insertion de l'empreinte écrit dans ${sortie}. Pour l'appliquer :`);
console.log(`  base locale  : npx wrangler d1 execute DB --local --file ${sortie}`);
console.log(`  base distante: npx wrangler d1 execute DB --remote --file ${sortie}`);
