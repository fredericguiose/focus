/** Un motif renvoyé par l'API (« la nuit a déjà commencé… ») affiché seul : majuscule initiale. */
export function phrase(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}
