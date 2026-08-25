/**
 * Copy the Tauri NSIS setup.exe into dist-windows/.
 *
 * Expects:
 *   apps/desktop/src-tauri/target/release/bundle/nsis/*-setup.exe
 *
 * Output:
 *   dist-windows/piFlow-<version>-x64-setup.exe
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NSIS_DIR = path.join(
  ROOT,
  'apps/desktop/src-tauri/target/release/bundle/nsis',
);
const OUT_ROOT = path.join(ROOT, 'dist-windows');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version || '0.1.0';
const DEST = path.join(OUT_ROOT, `piFlow-${version}-x64-setup.exe`);

function must(p, hint) {
  if (!existsSync(p)) throw new Error(`Missing ${p}${hint ? ` (${hint})` : ''}`);
}

must(NSIS_DIR, 'run: pnpm --filter @bluelamp/desktop exec tauri build --bundles nsis');

const setup = readdirSync(NSIS_DIR).find((name) => name.toLowerCase().endsWith('-setup.exe'));
if (!setup) {
  throw new Error(`No *-setup.exe in ${NSIS_DIR}`);
}

mkdirSync(OUT_ROOT, { recursive: true });
const src = path.join(NSIS_DIR, setup);
try {
  if (existsSync(DEST)) rmSync(DEST, { force: true });
} catch {
  /* dest locked — copyFileSync will throw with a clear path */
}
copyFileSync(src, DEST);
console.log(`[installer] ${src}`);
console.log(`[installer] copied ${DEST}`);
