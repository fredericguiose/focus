import { applyD1Migrations, reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';

// Base vide et schéma à jour avant chaque test : aucun test ne dépend d'un autre.
beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.MIGRATIONS);
});
