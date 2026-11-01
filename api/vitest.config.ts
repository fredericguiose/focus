import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Les tests tournent dans le vrai environnement Workers (workerd) avec une base D1 locale.
// Pas de wrangler.jsonc ici : il pointe vers ../web/dist, qui n'existe pas tant que la web
// app n'est pas construite.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: '2026-08-15',
        d1Databases: ['DB'],
        // FOCUS_ENVIRONNEMENT=local : un seul hôte, pas d'Access, comme l'instance locale.
        // test/acces.test.ts règle la production (hôtes, Access) requête par requête.
        bindings: {
          MIGRATIONS: await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url))),
          FOCUS_ENVIRONNEMENT: 'local',
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/preparation.ts'],
  },
});
