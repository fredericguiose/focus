import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    // Chemin « racine » : Vite le résout depuis la racine du projet, sans dépendre de node:path.
    alias: [{ find: /^@\//, replacement: '/src/' }],
  },
  server: {
    // En développement, l'API locale (wrangler dev) répond sur la même origine.
    proxy: { '/v1': 'http://localhost:8787' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/preparation.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
