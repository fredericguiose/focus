#!/usr/bin/env node
// Essai local en une commande (docs/essai-local.md). Sans dépendance, idempotent.
//   npm run local [-- --exemple] [-- --discret]   prépare tout et lance l'API sur le port 8799
//   npm run local:heure -- 18:00 | +3h | reel      règle l'horloge du Worker local
//   npm run local:reset                            efface la base locale et les jetons locaux
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(RACINE, 'api');
const WEB = join(RACINE, 'web');
const PERSIST = '.wrangler/local'; // relatif à api/
const DEV_VARS = join(API, '.dev.vars');
const PORT = 8799;
const URL_API = `http://127.0.0.1:${PORT}`;
const DOSSIER = join(homedir(), '.config', 'focus', 'local');
const SECRETS = join(homedir(), '.config', 'focus', 'secrets.env');
const CONFIG_PRIVEE = resolve(RACINE, '..', 'focus-config', 'focus.yaml');
const CONFIG_EXEMPLE = join(RACINE, 'config', 'exemple.yaml');
const JETONS = { interface: 'local-web', config: 'local-config' };
const WRANGLER = join(API, 'node_modules', '.bin', 'wrangler');
const ENV = { ...process.env, WRANGLER_SEND_METRICS: 'false' };

const info = (m) => console.log(`[focus] ${m}`);
function arreter(m) {
  console.error(`[focus] Erreur : ${m}`);
  process.exit(1);
}

function lancer(cmd, args, cwd, { capturer = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: ENV, stdio: capturer ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'], encoding: 'utf8' });
  if (r.status !== 0) {
    if (capturer) process.stderr.write(r.stderr ?? '');
    arreter(`échec de « ${cmd.split('/').pop()} ${args.join(' ')} » dans ${cwd.replace(RACINE, '.') || '.'}.`);
  }
  return r.stdout;
}

const d1 = (...args) => lancer(WRANGLER, ['d1', ...args, 'DB', '--local', '--persist-to', PERSIST], API, { capturer: true });

function portOccupe() {
  return new Promise((ok) => {
    const s = connect(PORT, '127.0.0.1');
    s.once('connect', () => (s.destroy(), ok(true)));
    s.once('error', () => ok(false));
  });
}

// Un jeton est lié à un utilisateur : un jeu par utilisateur de config (alice pour l'exemple).
const fichierJeton = (type, utilisateur, ext = 'jeton') => join(DOSSIER, `${type}-${utilisateur}.${ext}`);
const lireJeton = (type, utilisateur) => readFileSync(fichierJeton(type, utilisateur), 'utf8').trim();
const F_UTILISATEUR = join(DOSSIER, 'utilisateur');
const utilisateurCourant = () => (existsSync(F_UTILISATEUR) ? readFileSync(F_UTILISATEUR, 'utf8').trim() : undefined);

async function appeler(chemin, { methode = 'GET', jeton, corps } = {}) {
  const r = await fetch(URL_API + chemin, {
    method: methode,
    headers: { ...(jeton && { Authorization: `Bearer ${jeton}` }), ...(corps && { 'Content-Type': 'application/json' }) },
    body: corps && JSON.stringify(corps),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {}
  return { statut: r.status, json };
}

// ── 1-2. Dépendances et web app ────────────────────────────────────────────────

function dependances() {
  for (const d of ['core', 'api', 'web']) {
    if (existsSync(join(RACINE, d, 'node_modules'))) continue;
    info(`Installation des dépendances de ${d}/…`);
    lancer('npm', ['ci', '--no-audit', '--no-fund'], join(RACINE, d));
  }
}

function plusRecent(chemin) {
  if (!existsSync(chemin)) return 0;
  const s = statSync(chemin);
  if (!s.isDirectory()) return s.mtimeMs;
  return Math.max(s.mtimeMs, ...readdirSync(chemin).map((n) => plusRecent(join(chemin, n))));
}

function webApp() {
  const sortie = join(WEB, 'dist', 'index.html');
  const sources = ['src', 'public', 'index.html', 'package.json', 'vite.config.ts', 'tsconfig.json'].map((n) => join(WEB, n));
  sources.push(join(RACINE, 'core', 'src'));
  if (existsSync(sortie) && statSync(sortie).mtimeMs >= Math.max(...sources.map(plusRecent))) return info('Web app à jour.');
  info('Construction de la web app…');
  lancer('npm', ['run', '-s', 'build'], WEB, { capturer: true });
}

// ── 3-4. Base locale et jetons ─────────────────────────────────────────────────

function preparerDossier() {
  mkdirSync(DOSSIER, { recursive: true, mode: 0o700 });
  chmodSync(join(homedir(), '.config', 'focus'), 0o700);
  chmodSync(DOSSIER, 0o700);
}

function jetons(utilisateur) {
  for (const [type, nom] of Object.entries(JETONS)) {
    const fJeton = fichierJeton(type, utilisateur);
    const fSql = fichierJeton(type, utilisateur, 'sql');
    if (existsSync(fJeton) && existsSync(fSql)) continue;
    const args = ['scripts/creer-jeton.mjs', type, nom, '--utilisateur', utilisateur, '--sortie', fSql];
    const sortie = lancer('node', args, API, { capturer: true });
    const jeton = /focus_[A-Za-z0-9_-]+/.exec(sortie)?.[0];
    if (!jeton) arreter(`jeton ${type} introuvable dans la sortie de creer-jeton.`);
    writeFileSync(fJeton, `${jeton}\n`, { mode: 0o600 });
    chmodSync(fSql, 0o600);
    info(`Jeton ${type} (${utilisateur}) créé (${fJeton.replace(homedir(), '~')}).`);
  }
  // La base a pu être effacée à la main : réinsérer les empreintes absentes.
  const empreintes = Object.keys(JETONS).map((t) => createHash('sha256').update(lireJeton(t, utilisateur)).digest('hex'));
  const sortie = d1('execute', '--json', '--command', `SELECT empreinte FROM appareils WHERE empreinte IN ('${empreintes.join("','")}')`);
  const presentes = new Set(JSON.parse(sortie).flatMap((r) => r.results.map((l) => l.empreinte)));
  Object.keys(JETONS).forEach((type, i) => {
    if (presentes.has(empreintes[i])) return;
    d1('execute', '--file', fichierJeton(type, utilisateur, 'sql'));
    info(`Jeton ${type} inscrit dans la base locale.`);
  });
}

// ── 5. Config ──────────────────────────────────────────────────────────────────

function choisirConfig(forcerExemple) {
  const fichier = !forcerExemple && existsSync(CONFIG_PRIVEE) ? CONFIG_PRIVEE : CONFIG_EXEMPLE;
  const yaml = readFileSync(fichier, 'utf8');
  const utilisateur = /^utilisateur:\s*["']?([A-Za-z0-9_.-]+)/m.exec(yaml)?.[1];
  if (!utilisateur) arreter(`champ « utilisateur » introuvable dans ${fichier}.`);
  return { fichier, yaml, utilisateur };
}

async function config({ fichier, yaml, utilisateur }) {
  const empreinte = createHash('sha256').update(yaml).digest('hex');
  const commit = `local-${empreinte.slice(0, 12)}`;
  const fEmpreinte = fichierJeton('config', utilisateur, 'empreinte');
  const nomFichier = fichier === CONFIG_PRIVEE ? '../focus-config/focus.yaml' : 'config/exemple.yaml';
  const jeton = lireJeton('config', utilisateur);
  const active = await appeler('/v1/config/version', { jeton });
  const dejaLa = existsSync(fEmpreinte) && readFileSync(fEmpreinte, 'utf8').trim() === empreinte && active.json?.version === commit;
  if (dejaLa) return info(`Config inchangée (${nomFichier}).`);
  const r = await appeler('/v1/config', { methode: 'POST', jeton, corps: { yaml, commit } });
  if (r.statut !== 201) {
    console.error(JSON.stringify(r.json, null, 2));
    return info(`Config ${nomFichier} refusée (HTTP ${r.statut}) : la version précédente reste active.`);
  }
  writeFileSync(fEmpreinte, `${empreinte}\n`, { mode: 0o600 });
  info(`Config chargée : ${nomFichier} (${commit}).`);
}

// ── 6. Secrets : Todoist, Xiaomi ───────────────────────────────────────────────

/** Copie dans api/.dev.vars (600, effacé à l'arrêt) les secrets remplis ; n'affiche jamais une valeur. */
function secrets() {
  const lignes = existsSync(SECRETS) ? readFileSync(SECRETS, 'utf8').split('\n') : [];
  const remplie = (nom) => lignes.find((l) => new RegExp(`^${nom}=\\S`).test(l));
  const todoist = remplie('TODOIST_TOKEN');
  const xiaomi = remplie('XIAOMI_USER_ID') && remplie('XIAOMI_PASS_TOKEN') ? ['XIAOMI_USER_ID', 'XIAOMI_PASS_TOKEN', 'XIAOMI_REGION'].map(remplie).filter(Boolean) : [];
  if (!todoist) info('Sans Todoist (pas de TODOIST_TOKEN dans ~/.config/focus/secrets.env).');
  if (xiaomi.length === 0) info('Sans sommeil Xiaomi (XIAOMI_USER_ID et XIAOMI_PASS_TOKEN vides dans ~/.config/focus/secrets.env).');
  const a = [todoist, ...xiaomi].filter(Boolean);
  if (a.length === 0) return false;
  const ignore = spawnSync('git', ['check-ignore', '-q', '.dev.vars'], { cwd: API });
  if (ignore.status !== 0) return info('Secrets non copiés : api/.dev.vars n\'est pas ignoré par git.'), false;
  writeFileSync(DEV_VARS, `${a.join('\n')}\n`, { mode: 0o600 });
  chmodSync(DEV_VARS, 0o600);
  if (todoist) info('Todoist : lecture réelle (jeton dans api/.dev.vars, effacé à l\'arrêt).');
  if (xiaomi.length > 0) info('Sommeil Xiaomi : lecture réelle, une fois par heure (secrets dans api/.dev.vars, effacés à l\'arrêt).');
  return true;
}

function effacerDevVars() {
  try {
    unlinkSync(DEV_VARS);
  } catch {}
}

// ── 7-9. Lancement ─────────────────────────────────────────────────────────────

async function attendrePret(wrangler) {
  for (let i = 0; i < 120; i++) {
    if (wrangler.exitCode !== null) return false;
    try {
      await fetch(`${URL_API}/v1/statut`);
      return true;
    } catch {}
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return false;
}

async function tachePlanifiee() {
  try {
    const r = await fetch(`${URL_API}/cdn-cgi/local/explorer/api/local/scheduled?worker=focus-api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cron: '* * * * *' }),
    });
    info(r.ok ? 'Tâche planifiée déclenchée (résultat dans le journal de wrangler).' : `Tâche planifiée : HTTP ${r.status}.`);
  } catch (e) {
    info(`Tâche planifiée non déclenchée : ${e.message}`);
  }
}

function presentationJeton(utilisateur, discret) {
  const jeton = lireJeton('interface', utilisateur);
  if (discret) return info(`Jeton interface : ${fichierJeton('interface', utilisateur).replace(homedir(), '~')}`);
  const wl = spawnSync('sh', ['-c', 'command -v wl-copy'], { stdio: 'ignore' }).status === 0 && process.env.WAYLAND_DISPLAY;
  if (wl) {
    const r = spawnSync('wl-copy', [], { input: jeton, stdio: ['pipe', 'ignore', 'ignore'] });
    if (r.status === 0) return info('Jeton interface copié dans le presse-papiers : le coller dans la web app.');
  }
  info(`Jeton interface, à coller dans la web app :\n\n  ${jeton}\n`);
}

async function local(options) {
  if (await portOccupe()) arreter(`le port ${PORT} est déjà pris (Focus déjà lancé ?).`);
  dependances();
  webApp();
  preparerDossier();
  info('Migrations de la base locale…');
  d1('migrations', 'apply');
  const choix = choisirConfig(options.includes('--exemple'));
  jetons(choix.utilisateur);
  writeFileSync(F_UTILISATEUR, `${choix.utilisateur}\n`, { mode: 0o600 });
  const avecSecrets = secrets();

  let arret = false;
  const wrangler = spawn(
    WRANGLER,
    ['dev', '--local', '--persist-to', PERSIST, '--port', String(PORT), '--ip', '127.0.0.1',
      '--show-interactive-dev-session=false', '--var', 'FOCUS_ENVIRONNEMENT:local'],
    { cwd: API, env: ENV, stdio: ['ignore', 'inherit', 'inherit'], detached: true },
  );
  const fini = new Promise((ok) => wrangler.once('exit', ok));
  const arreterTout = async (code) => {
    if (arret) return;
    arret = true;
    info('Arrêt…');
    if (wrangler.exitCode === null) {
      try {
        process.kill(-wrangler.pid, 'SIGINT');
      } catch {}
      const delai = setTimeout(() => {
        try {
          process.kill(-wrangler.pid, 'SIGKILL');
        } catch {}
      }, 8000);
      await fini;
      clearTimeout(delai);
    }
    effacerDevVars();
    info(avecSecrets ? 'Arrêté, api/.dev.vars effacé.' : 'Arrêté.');
    process.exit(code);
  };
  process.on('SIGINT', () => arreterTout(0));
  process.on('SIGTERM', () => arreterTout(0));
  process.on('exit', effacerDevVars);
  wrangler.once('exit', (c) => !arret && (info(`wrangler s'est arrêté (code ${c}).`), arreterTout(1)));

  if (!(await attendrePret(wrangler))) return arreterTout(1);
  await config(choix);
  await tachePlanifiee();
  presentationJeton(choix.utilisateur, options.includes('--discret'));
  if (!options.includes('--discret')) spawn('xdg-open', [`${URL_API}/`], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  info(`Prêt : ${URL_API}/   ·   heure : npm run local:heure -- 18:00|+3h|reel   ·   arrêt : Ctrl-C`);
}

// ── local:heure ────────────────────────────────────────────────────────────────

/** Décalage (ms) du fuseau à l'instant t : heure locale − UTC. */
function decalageFuseau(t, fuseau) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t))
      .map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

const heureDans = (t, fuseau) => new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(t));

async function heure(valeur) {
  if (!valeur) arreter('usage : npm run local:heure -- 18:00 | +3h | -90min | reel');
  const utilisateur = utilisateurCourant();
  if (!utilisateur || !existsSync(fichierJeton('interface', utilisateur))) arreter('pas de jeton local : lancer d\'abord npm run local.');
  if (!(await portOccupe())) arreter('Focus n\'est pas lancé (npm run local).');
  const jeton = lireJeton('interface', utilisateur);
  const s = await appeler('/v1/statut', { jeton });
  const fuseau = s.json?.journee?.fuseau;

  let horloge;
  if (valeur === 'reel') horloge = null;
  else if (/^[+-]/.test(valeur)) horloge = valeur;
  else {
    const m = /^(\d{1,2})[:h](\d{2})$/.exec(valeur);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) arreter(`« ${valeur} » : attendu HH:MM, +3h, -90min ou reel.`);
    if (!fuseau) arreter(`fuseau de la journée inconnu (GET /v1/statut : HTTP ${s.statut}).`);
    const maintenant = Date.now();
    const local = new Date(maintenant + decalageFuseau(maintenant, fuseau)); // date du jour dans le fuseau, lue en UTC
    const naif = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), Number(m[1]), Number(m[2]));
    let cible = naif - decalageFuseau(naif, fuseau);
    cible = naif - decalageFuseau(cible, fuseau); // passage d'heure d'été
    const minutes = Math.round((cible - Math.floor(maintenant / 60_000) * 60_000) / 60_000); // garde les secondes : 18:00:ss
    horloge = `${minutes < 0 ? '-' : '+'}${Math.abs(minutes)}min`;
  }
  const r = await appeler('/v1/dev/horloge', { methode: 'POST', jeton, corps: { horloge } });
  if (r.statut !== 200) arreter(`HTTP ${r.statut} : ${JSON.stringify(r.json)}`);
  const lisible = fuseau ? ` — ${heureDans(Date.parse(r.json.heure_serveur), fuseau)} (${fuseau})` : '';
  info(`Horloge : ${r.json.reglage ?? 'réelle'}${lisible}.`);
  const apres = await appeler('/v1/statut', { jeton });
  if (apres.json?.phase) info(`Phase : ${apres.json.phase}.`);
}

// ── local:reset ────────────────────────────────────────────────────────────────

async function reset() {
  if (await portOccupe()) arreter('Focus tourne encore : l\'arrêter (Ctrl-C) avant de tout effacer.');
  rmSync(join(API, PERSIST), { recursive: true, force: true });
  rmSync(DOSSIER, { recursive: true, force: true });
  effacerDevVars();
  info('Base locale (api/.wrangler/local) et jetons locaux (~/.config/focus/local) effacés.');
}

const [commande, ...reste] = process.argv.slice(2);
if (commande === 'heure') await heure(reste[0]);
else if (commande === 'reset') await reset();
else await local(process.argv.slice(2));
