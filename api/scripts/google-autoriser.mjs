#!/usr/bin/env node
// Autorisation Google Agenda (bloc « Dormir ») : obtient un refresh token, une fois, sur ce PC.
//   node scripts/google-autoriser.mjs            (ou : npm run google:autoriser)
//
// Lit le client OAuth (type « installed », téléchargé depuis la console Google Cloud) dans
// ~/.config/focus/prod/google-client.json, ouvre la page de consentement Google dans le
// navigateur (xdg-open), reçoit le code sur un petit serveur 127.0.0.1:<port libre> (méthode
// « loopback IP » de https://developers.google.com/identity/protocols/oauth2/native-app, avec
// PKCE S256), l'échange, et écrit le refresh token dans ~/.config/focus/prod/google-refresh-token
// (mode 600). Rien de secret n'est affiché : ni le client, ni le code, ni les jetons.
// Portée demandée : https://www.googleapis.com/auth/calendar.events (seulement).
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DOSSIER = join(homedir(), '.config', 'focus', 'prod');
const CLIENT = join(DOSSIER, 'google-client.json');
const SORTIE = join(DOSSIER, 'google-refresh-token');
const PORTEE = 'https://www.googleapis.com/auth/calendar.events';
const URL_AUTORISATION = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_JETON = 'https://oauth2.googleapis.com/token';
const DELAI_MS = 5 * 60 * 1000;

function arreter(message) {
  console.error(`Erreur : ${message}`);
  process.exit(1);
}

const base64url = (octets) => Buffer.from(octets).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function lireClient() {
  let brut;
  try {
    brut = JSON.parse(readFileSync(CLIENT, 'utf8'));
  } catch {
    arreter(`client OAuth illisible (${CLIENT}) : fichier absent ou JSON invalide.`);
  }
  const c = brut?.installed;
  if (!c) arreter('le client OAuth doit être de type « Application de bureau » (clé « installed »).');
  if (typeof c.client_id !== 'string' || typeof c.client_secret !== 'string' || !c.client_id || !c.client_secret) {
    arreter('client_id ou client_secret absent du client OAuth.');
  }
  return { id: c.client_id, secret: c.client_secret };
}

const page = (titre, texte) =>
  `<!doctype html><html lang="fr"><meta charset="utf-8"><title>${titre}</title>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
  `<h1 style="font-size:1.25rem">${titre}</h1><p>${texte}</p></body></html>`;

async function principal() {
  const client = lireClient();
  const verificateur = base64url(randomBytes(32));
  const defi = base64url(createHash('sha256').update(verificateur).digest());
  const etat = base64url(randomBytes(16));

  let terminer;
  const resultat = new Promise((ok) => (terminer = ok));
  const serveur = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/') {
      res.writeHead(404).end();
      return;
    }
    const erreur = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (url.searchParams.get('state') !== etat) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Échec', 'Réponse inattendue (state).'));
      terminer({ erreur: 'réponse de Google sans le bon « state » (requête étrangère ?)' });
      return;
    }
    if (erreur || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Autorisation refusée', 'Vous pouvez fermer cet onglet.'));
      terminer({ erreur: `autorisation refusée par Google (${erreur ?? 'pas de code'})` });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Autorisation reçue', 'Vous pouvez fermer cet onglet et revenir au terminal.'));
    terminer({ code });
  });
  await new Promise((ok, ko) => serveur.once('error', ko).listen(0, '127.0.0.1', ok));
  const port = serveur.address().port;
  const redirection = `http://127.0.0.1:${port}`;

  const autorisation = new URL(URL_AUTORISATION);
  autorisation.search = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirection,
    response_type: 'code',
    scope: PORTEE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: defi,
    code_challenge_method: 'S256',
    state: etat,
  }).toString();

  console.log('Ouverture de la page de consentement Google dans le navigateur…');
  console.log('(Compte Google de l’agenda ; « application non vérifiée » : Paramètres avancés → Accéder à Focus.)');
  const navigateur = spawn('xdg-open', [autorisation.toString()], { stdio: 'ignore', detached: true });
  navigateur.on('error', () => terminer({ erreur: 'xdg-open indisponible : impossible d’ouvrir le navigateur.' }));
  navigateur.unref();

  const minuterie = setTimeout(() => terminer({ erreur: 'pas de réponse du navigateur en 5 minutes' }), DELAI_MS);
  const r = await resultat;
  clearTimeout(minuterie);
  serveur.close();
  if (r.erreur) arreter(r.erreur);

  let reponse;
  try {
    reponse = await fetch(URL_JETON, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: r.code,
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: redirection,
        code_verifier: verificateur,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    arreter('pas de réponse de oauth2.googleapis.com.');
  }
  let corps = {};
  try {
    corps = await reponse.json();
  } catch {
    // Corps illisible : traité par le code HTTP.
  }
  if (!reponse.ok) arreter(`échange du code refusé (HTTP ${reponse.status}${typeof corps.error === 'string' ? `, ${corps.error}` : ''}).`);
  if (typeof corps.refresh_token !== 'string' || !corps.refresh_token) {
    arreter('Google n’a pas renvoyé de refresh token (révoquer l’accès sur myaccount.google.com/permissions puis relancer).');
  }
  if (typeof corps.scope === 'string' && !corps.scope.split(' ').includes(PORTEE)) {
    arreter('la portée calendar.events n’a pas été accordée (case décochée sur l’écran de consentement ?).');
  }
  writeFileSync(SORTIE, corps.refresh_token, { mode: 0o600 });
  chmodSync(SORTIE, 0o600);
  console.log('Autorisation enregistrée');
}

principal().catch((e) => arreter(e instanceof Error ? e.message : 'erreur inattendue'));
