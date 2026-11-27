// Bundles the server and everything it imports from packages/core into one file, server/index.mjs,
// so an installed Power needs nothing from this repository. Run: node powers/grounded-quiz/scripts/build.mjs
//
// esbuild is the copy already installed for the worker (apps/worker), so the Power adds no dependency.
import { createRequire } from 'node:module';
import process from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const power = resolve(here, '..');
const root = resolve(power, '..', '..');

export async function buildServer({ outfile = join(power, 'server', 'index.mjs') } = {}) {
  let esbuild;
  try {
    esbuild = createRequire(join(root, 'apps', 'worker', 'package.json'))('esbuild');
  } catch {
    throw new Error('esbuild not found. Run `pnpm install` at the repository root first.');
  }
  await esbuild.build({
    entryPoints: [join(power, 'src', 'main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    legalComments: 'none',
    logLevel: 'warning',
    absWorkingDir: root,
  });
  return outfile;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = await buildServer();
  process.stdout.write(`Built ${file}\n`);
}
