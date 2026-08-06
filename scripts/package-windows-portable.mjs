/**
 * Assemble a portable Windows folder + zip (NSIS/MSI cannot pack ~1GB ONNX reliably).
 *
 * Expects:
 *   - apps/desktop/src-tauri/target/release/appsdesktop.exe  (tauri build --no-bundle)
 *   - apps/desktop/src-tauri/resources/{runtime,models,rag-server.zip,BUNDLE_INFO.json}
 *
 * Output:
 *   dist-windows/RAG-Assistant/… 
 *   dist-windows/RAG-Assistant-0.1.0-portable.zip
 */
import { execSync } from 'node:child_process';
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXE = path.join(ROOT, 'apps/desktop/src-tauri/target/release/appsdesktop.exe');
const RES = path.join(ROOT, 'apps/desktop/src-tauri/resources');
const OUT_ROOT = path.join(ROOT, 'dist-windows');
const OUT_DIR = path.join(OUT_ROOT, 'RAG-Assistant');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version || '0.1.0';
const ZIP = path.join(OUT_ROOT, `RAG-Assistant-${version}-portable.zip`);

function must(p, hint) {
  if (!existsSync(p)) throw new Error(`Missing ${p}${hint ? ` (${hint})` : ''}`);
}

must(EXE, 'run: pnpm --filter @bluelamp/desktop tauri build --no-bundle');
must(path.join(RES, 'runtime/node.exe'), 'run: pnpm bundle:windows-sidecar');
must(path.join(RES, 'rag-server.zip'));
must(path.join(RES, 'models/manifest.json'));

mkdirSync(OUT_ROOT, { recursive: true });
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

copyFileSync(EXE, path.join(OUT_DIR, 'RAG Assistant.exe'));
cpSync(path.join(RES, 'runtime'), path.join(OUT_DIR, 'runtime'), { recursive: true });
cpSync(path.join(RES, 'models'), path.join(OUT_DIR, 'models'), { recursive: true });
copyFileSync(path.join(RES, 'rag-server.zip'), path.join(OUT_DIR, 'rag-server.zip'));
copyFileSync(path.join(RES, 'BUNDLE_INFO.json'), path.join(OUT_DIR, 'BUNDLE_INFO.json'));

writeFileSync(
  path.join(OUT_DIR, 'README.txt'),
  [
    'RAG Assistant (portable)',
    '',
    '1. Unzip this folder anywhere (prefer a short path, e.g. D:\\apps\\RAG-Assistant).',
    '2. Run "RAG Assistant.exe".',
    '3. First launch extracts the RAG backend under %APPDATA%\\com.bluelamp.rag-assistant\\sidecar\\.',
    '4. Open Settings to configure remote Ollama. Without Ollama, chat returns retrieval summaries.',
    '',
    `Version: ${version}`,
    '',
  ].join('\r\n'),
);

console.log(`[portable] folder ${OUT_DIR}`);
let zipOut = ZIP;
try {
  if (existsSync(ZIP)) rmSync(ZIP, { force: true });
} catch {
  zipOut = path.join(OUT_ROOT, `RAG-Assistant-${version}-portable-${Date.now()}.zip`);
  console.warn(`[portable] existing zip locked; writing ${zipOut}`);
}
execSync(`tar -a -c -f "${zipOut}" -C "${OUT_ROOT}" RAG-Assistant`, {
  stdio: 'inherit',
  shell: true,
});
console.log(`[portable] zip ${zipOut}`);
