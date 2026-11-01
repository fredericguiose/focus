// Service worker. L'extension ne bloque rien : le client PC bloque par le fichier hosts. Quand un
// onglet échoue d'une façon qui ressemble à ce blocage, on demande à l'API si le domaine est bloqué
// et, si oui, on remplace la page d'erreur de Chrome par la page de l'extension.
import { demanderBlocage, lireReglages } from './commun.js';

const ERREURS_DE_BLOCAGE = new Set([
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_ADDRESS_INVALID',
  'net::ERR_CONNECTION_RESET',
]);

chrome.webNavigation.onErrorOccurred.addListener(
  (details) => {
    if (details.frameId !== 0 || !ERREURS_DE_BLOCAGE.has(details.error)) return;
    void traiter(details.tabId, details.url);
  },
  { url: [{ schemes: ['http', 'https'] }] },
);

async function traiter(ongletId: number, url: string): Promise<void> {
  const reglages = await lireReglages();
  if (!reglages) return;
  const domaine = new URL(url).hostname.toLowerCase();
  if (!domaine || domaine === new URL(reglages.api).hostname) return;
  try {
    const reponse = await demanderBlocage(reglages, domaine);
    if (!reponse.bloque) return;
  } catch {
    // API injoignable ou refus : la page d'erreur de Chrome reste affichée.
    return;
  }
  const page = new URL(chrome.runtime.getURL('bloque.html'));
  page.searchParams.set('url', url);
  await chrome.tabs.update(ongletId, { url: page.href });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install' && !(await lireReglages())) await chrome.runtime.openOptionsPage();
});
