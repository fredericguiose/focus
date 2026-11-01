/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" : l'interface parle à une API simulée en mémoire (développement, démonstration). */
  readonly VITE_API_SIMULEE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
