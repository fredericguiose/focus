// Chiffrement d'un secret gardé en base (AES-GCM 256, Web Crypto). La clé est dérivée par HKDF
// du secret Worker `CLE_CHIFFREMENT` ; `contexte` (données associées) lie le chiffré à son usage.
import { depuisBase64, versBase64 } from './xiaomi';

export interface Chiffre {
  v: 1;
  iv: string;
  donnees: string;
}

const utf8 = (t: string) => new TextEncoder().encode(t);

async function cle(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8('focus'), info: utf8('chiffrement-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function chiffrer(secret: string, clair: string, contexte: string): Promise<Chiffre> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const donnees = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(contexte) }, await cle(secret), utf8(clair));
  return { v: 1, iv: versBase64(iv), donnees: versBase64(new Uint8Array(donnees)) };
}

/** null si la clé, le contexte ou le chiffré ne correspondent pas (jamais d'exception). */
export async function dechiffrer(secret: string, c: Chiffre, contexte: string): Promise<string | null> {
  try {
    const clair = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: depuisBase64(c.iv), additionalData: utf8(contexte) },
      await cle(secret),
      depuisBase64(c.donnees),
    );
    return new TextDecoder().decode(clair);
  } catch {
    return null;
  }
}
