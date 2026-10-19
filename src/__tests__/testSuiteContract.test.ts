import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type PackageManifest = {
  scripts?: Record<string, string>;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const packagePath = join(__dirname, '../../package.json');
const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as PackageManifest;

describe('repository test command contract', () => {
  it('keeps the default test command deterministic and offline', () => {
    expect(manifest.scripts?.test).toBe('npm run test:unit');
    expect(manifest.scripts?.test).not.toMatch(/dist\/cli|test:api/);
  });

  it('keeps the live provider diagnostic explicit and separate', () => {
    expect(manifest.scripts?.['test:api']).toBe('node dist/cli.js test');
  });
});
