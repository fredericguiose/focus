declare namespace Cloudflare {
  interface Env {
    MIGRATIONS: import('cloudflare:test').D1Migration[];
    TODOIST_TOKEN?: string;
  }
}

declare module '*?raw' {
  const contenu: string;
  export default contenu;
}
