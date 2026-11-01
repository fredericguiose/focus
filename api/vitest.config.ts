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
        bindings: { MIGRATIONS: await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url))) },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/preparation.ts'],
  },
});
