import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crateRoot = join(projectRoot, 'add-ons', 'bgraph-main', 'bgraph-main');
const target = 'wasm32-unknown-unknown';
const result = spawnSync(
  'cargo',
  [
    'build',
    '--lib',
    '--release',
    '--target',
    target,
    '--no-default-features',
    '--features',
    'all-archetypes,json,wasm'
  ],
  { cwd: crateRoot, stdio: 'inherit', shell: process.platform === 'win32' }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const source = join(crateRoot, 'target', target, 'release', 'bgraph.wasm');
const destination = join(projectRoot, 'public', 'bgraph.wasm');
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);

console.log(`bgraph WASM: ${statSync(destination).size} bytes -> ${destination}`);
