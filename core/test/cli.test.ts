import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXEMPLE, remplacer } from './aides';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

function valider(...args: string[]) {
  const r = spawnSync(join(RACINE, 'node_modules/.bin/tsx'), ['src/cli-valider.ts', ...args], { cwd: RACINE, encoding: 'utf8' });
  return { code: r.status, sortie: r.stdout, erreurs: r.stderr };
}

describe('cli-valider', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'focus-valider-'));

  it('config valide : code 0', () => {
    const r = valider(fileURLToPath(new URL('../../config/exemple.yaml', import.meta.url)));
    expect(r.code).toBe(0);
    expect(r.sortie).toMatch(/configuration valide \(4 modes, 2 routines, 9 apps, 3 appareils\)/);
  });

  it('config refusée : code 1 et erreurs listées', () => {
    const fichier = join(dossier, 'faux.yaml');
    writeFileSync(fichier, remplacer(EXEMPLE, 'routine_par_defaut: semaine', 'routine_par_defaut: semaines'));
    const r = valider(fichier);
    expect(r.code).toBe(1);
    expect(r.erreurs).toContain('configuration refusée (1 erreur)');
    expect(r.erreurs).toContain('- routine_par_defaut : routine inconnue « semaines »');
  });

  it('appel faux : code 2', () => {
    expect(valider().code).toBe(2);
    expect(valider(join(dossier, 'absent.yaml')).code).toBe(2);
  });
}, 30_000);
