/**
 * Prepare Windows install resources under apps/desktop/src-tauri/resources/:
 *   runtime/node.exe
 *   rag-server.zip  (prod deploy of @bluelamp/rag-server, junctions materialized)
 *   models/         (BGE-M3 + slim manifest)
 *
 * Run on Windows (PowerShell / cmd) from repo root:
 *   node scripts/bundle-windows-sidecar.mjs
 */
import { execFileSync, execSync } from 'node:child_process';
import {
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESOURCES = path.join(ROOT, 'apps/desktop/src-tauri/resources');
const RAG_OUT = path.join(RESOURCES, 'rag-server');
const RAG_FLAT = path.join(RESOURCES, 'rag-server-flat');
const RUNTIME_OUT = path.join(RESOURCES, 'runtime');
const MODELS_OUT = path.join(RESOURCES, 'models');

function log(msg) {
  console.log(`[bundle-windows] ${msg}`);
}

function mustExist(p, hint) {
  if (!existsSync(p)) {
    throw new Error(`Missing ${p}${hint ? ` (${hint})` : ''}`);
  }
}

function rmIfExists(p) {
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

function patchWorkspacePackageExports(ragOut, pkgName) {
  const short = pkgName.replace(/^@/, '').replace('/', '+'); // @bluelamp/core → bluelamp+core
  const folder = pkgName.split('/')[1]; // core | pg-actions
  const candidates = [];
  const link = path.join(ragOut, 'node_modules', pkgName, 'package.json');
  if (existsSync(link)) candidates.push(link);
  const pnpmDir = path.join(ragOut, 'node_modules/.pnpm');
  if (existsSync(pnpmDir)) {
    for (const name of readdirSync(pnpmDir)) {
      if (!name.startsWith(`@${short}@`) && !name.startsWith(`${short}@`)) continue;
      const pkgPath = path.join(
        pnpmDir,
        name,
        'node_modules',
        pkgName,
        'package.json',
      );
      if (existsSync(pkgPath)) candidates.push(pkgPath);
    }
  }
  const seen = new Set();
  for (const pkgPath of candidates) {
    if (seen.has(pkgPath)) continue;
    seen.add(pkgPath);
    const dir = path.dirname(pkgPath);
    if (!existsSync(path.join(dir, 'dist/index.js'))) {
      throw new Error(`${pkgName} missing dist at ${dir}`);
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    pkg.main = './dist/index.js';
    pkg.types = './dist/index.d.ts';
    pkg.exports = {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        default: './dist/index.js',
      },
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    log(`patched ${pkgName} exports → ${pkgPath}`);
  }
  if (seen.size === 0) {
    throw new Error(`${pkgName} not found in deployed rag-server`);
  }
}

function patchCorePackageExports(ragOut) {
  patchWorkspacePackageExports(ragOut, '@bluelamp/core');
}

function patchPgActionsPackageExports(ragOut) {
  patchWorkspacePackageExports(ragOut, '@bluelamp/pg-actions');
}

/** v1 portable: no local GGUF / OCR packages (remote Ollama + BGE-M3 only). */
function pruneUnusedPackages(ragOut) {
  const nm = path.join(ragOut, 'node_modules');
  const dropExact = ['node-llama-cpp', 'paddleocr'];
  const dropScopes = ['@node-llama-cpp'];

  for (const name of dropExact) {
    rmIfExists(path.join(nm, name));
  }
  for (const scope of dropScopes) {
    rmIfExists(path.join(nm, scope));
  }

  const pnpm = path.join(nm, '.pnpm');
  if (existsSync(pnpm)) {
    const shared = path.join(pnpm, 'node_modules');
    if (existsSync(shared)) {
      for (const name of dropExact) rmIfExists(path.join(shared, name));
      for (const scope of dropScopes) rmIfExists(path.join(shared, scope));
    }
    for (const ent of readdirSync(pnpm)) {
      const lower = ent.toLowerCase();
      if (
        lower.startsWith('node-llama-cpp@') ||
        lower.startsWith('paddleocr@') ||
        lower.includes('node-llama-cpp@') ||
        lower.startsWith('@node-llama-cpp+')
      ) {
        rmIfExists(path.join(pnpm, ent));
        log(`pruned ${ent}`);
      }
    }
  }

  // Strip docs / maps / typescript sources from dependencies (keep runtime .js/.node)
  const killSuffixes = ['.md', '.markdown', '.map', '.ts', '.tsx'];
  const killDirNames = new Set([
    'test',
    'tests',
    '__tests__',
    'docs',
    'example',
    'examples',
    '.github',
  ]);

  function walkPrune(dir, depth = 0) {
    if (!existsSync(dir) || depth > 40) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (killDirNames.has(ent.name)) {
          rmIfExists(p);
          continue;
        }
        walkPrune(p, depth + 1);
      } else {
        const n = ent.name.toLowerCase();
        if (n.endsWith('.node')) continue;
        if (killSuffixes.some((s) => n.endsWith(s))) {
          try {
            rmSync(p, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  walkPrune(nm);
  removeBrokenEntries(nm);
  log('prune complete');
}

/** Remove broken symlinks/junctions (Windows junctions are not always isSymbolicLink). */
function removeBrokenEntries(dir, depth = 0) {
  if (!existsSync(dir) || depth > 50) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    try {
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        try {
          statSync(p);
        } catch {
          rmIfExists(p);
          log(`removed broken link ${p}`);
        }
        continue;
      }
      if (st.isDirectory()) {
        try {
          readdirSync(p);
          removeBrokenEntries(p, depth + 1);
        } catch {
          rmIfExists(p);
          log(`removed broken dir ${p}`);
        }
      } else {
        try {
          statSync(p);
        } catch {
          rmIfExists(p);
        }
      }
    } catch {
      rmIfExists(p);
    }
  }
}

/**
 * Zip/extract cannot preserve pnpm junctions. Materialize a fully-dereferenced
 * copy so the archive only contains real files/dirs.
 */
function materializeForZip(src, dest) {
  rmIfExists(dest);
  mkdirSync(path.dirname(dest), { recursive: true });
  // Node cpSync dereferences symlinks/junctions by default (verbatimSymlinks: false)
  cpSync(src, dest, { recursive: true, force: true });
  removeBrokenEntries(dest);
  log(`materialized ${dest}`);
}

/**
 * After materialize, ensure transformers peers resolve from top-level node_modules
 * (needed if deploy still used an isolated layout).
 */
function ensureTopLevelPeers(ragOut) {
  const nm = path.join(ragOut, 'node_modules');
  const shared = path.join(nm, '.pnpm', 'node_modules');
  const needed = [
    'onnxruntime-common',
    'onnxruntime-node',
    'onnxruntime-web',
    'sharp',
    'bindings',
    'file-uri-to-path',
    '@img/colour',
    '@img/sharp-win32-x64',
    '@huggingface/jinja',
  ];
  for (const rel of needed) {
    const dest = path.join(nm, ...rel.split('/'));
    if (existsSync(dest)) continue;
    let src = path.join(shared, ...rel.split('/'));
    if (!existsSync(src) && existsSync(path.join(nm, '.pnpm'))) {
      // search .pnpm store for package@version/node_modules/<name>
      const needle = rel.includes('/') ? rel.replace('/', '+') : `${rel}@`;
      for (const ent of readdirSync(path.join(nm, '.pnpm'))) {
        if (!ent.startsWith(needle) && !ent.startsWith(rel + '@')) continue;
        const candidate = path.join(nm, '.pnpm', ent, 'node_modules', ...rel.split('/'));
        if (existsSync(candidate)) {
          src = candidate;
          break;
        }
      }
    }
    if (!existsSync(src)) {
      log(`warn: missing peer: ${rel}`);
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
    log(`ensured peer ${rel}`);
  }
}

function findNodeExe() {
  const fromEnv = process.execPath;
  if (process.platform === 'win32' && fromEnv.toLowerCase().endsWith('node.exe')) {
    return fromEnv;
  }
  const candidates = [
    process.env.NODE_EXE,
    'C:\\Program Files\\nodejs\\node.exe',
    path.join(process.env.ProgramFiles || '', 'nodejs', 'node.exe'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error('node.exe not found; set NODE_EXE or install Node.js for Windows');
}

log(`repo=${ROOT}`);
if (process.platform !== 'win32') {
  console.warn('Warning: this script is intended to run on Windows for native modules.');
}

rmSync(RESOURCES, { recursive: true, force: true });
mkdirSync(RUNTIME_OUT, { recursive: true });
mkdirSync(MODELS_OUT, { recursive: true });

// 1) Build workspace packages needed by rag-server
log('building @bluelamp/core + @bluelamp/pg-actions + @bluelamp/rag-server…');
execSync('pnpm --filter @bluelamp/core build', { cwd: ROOT, stdio: 'inherit' });
execSync('pnpm --filter @bluelamp/pg-actions build', { cwd: ROOT, stdio: 'inherit' });
execSync('pnpm --filter @bluelamp/rag-server build', { cwd: ROOT, stdio: 'inherit' });

// 2) Deploy production tree (hoisted survives zip better than isolated junctions)
log('pnpm deploy rag-server…');
execSync(
  `pnpm --config.node-linker=hoisted --filter @bluelamp/rag-server deploy --prod --legacy "${RAG_OUT}"`,
  { cwd: ROOT, stdio: 'inherit', shell: true },
);
mustExist(path.join(RAG_OUT, 'dist/index.js'), 'rag-server build output');
mustExist(path.join(RAG_OUT, 'node_modules'), 'deployed dependencies');

patchCorePackageExports(RAG_OUT);
patchPgActionsPackageExports(RAG_OUT);
pruneUnusedPackages(RAG_OUT);
ensureTopLevelPeers(RAG_OUT);

// 3) Materialize (dereference junctions) then zip
materializeForZip(RAG_OUT, RAG_FLAT);
ensureTopLevelPeers(RAG_FLAT);
rmIfExists(RAG_OUT);

const zipPath = path.join(RESOURCES, 'rag-server.zip');
log(`zip rag-server → ${zipPath}`);
if (existsSync(zipPath)) rmSync(zipPath);
execSync(`tar -a -c -f "${zipPath}" -C "${RAG_FLAT}" .`, {
  stdio: 'inherit',
  shell: true,
});
mustExist(zipPath, 'rag-server.zip');
const zipSize = statSync(zipPath).size;
if (zipSize < 1_000_000) {
  throw new Error(`rag-server.zip too small (${zipSize} bytes)`);
}
log(`rag-server.zip size=${(zipSize / 1e6).toFixed(1)} MB`);
rmIfExists(RAG_FLAT);

// 4) Copy Windows node.exe
const nodeExe = findNodeExe();
log(`copy node → ${nodeExe}`);
copyFileSync(nodeExe, path.join(RUNTIME_OUT, 'node.exe'));

// 5) Slim models: BGE-M3 only
const srcModels = path.join(ROOT, 'models');
const bgeSrc = path.join(srcModels, 'Xenova/bge-m3');
mustExist(path.join(bgeSrc, 'onnx/model_fp16.onnx'), 'run pnpm models:ensure first');
log('copy BGE-M3…');
cpSync(bgeSrc, path.join(MODELS_OUT, 'Xenova/bge-m3'), { recursive: true });

const fullManifest = JSON.parse(readFileSync(path.join(srcModels, 'manifest.json'), 'utf-8'));
const slim = {
  ...fullManifest,
  models: fullManifest.models.filter((m) => m.id === 'embedding.bge-m3'),
};
writeFileSync(path.join(MODELS_OUT, 'manifest.json'), JSON.stringify(slim, null, 2));
log(`manifest models: ${slim.models.map((m) => m.id).join(', ')}`);

// 6) Marker for Tauri / extract invalidation
writeFileSync(
  path.join(RESOURCES, 'BUNDLE_INFO.json'),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      node: execFileSync(nodeExe, ['-v']).toString().trim(),
      platform: process.platform,
      arch: process.arch,
      ragServerZip: 'rag-server.zip',
      seedDb: 'seed/piflow.db',
    },
    null,
    2,
  ),
);

// 7) Empty SQLite seed (schema only — never ship .data / test KB)
log('prepare empty seed piflow.db…');
execSync(`node "${path.join(ROOT, 'scripts/prepare-empty-piflow-db.mjs')}"`, {
  cwd: ROOT,
  stdio: 'inherit',
});
mustExist(path.join(RESOURCES, 'seed/piflow.db'), 'empty seed db');

log('done → apps/desktop/src-tauri/resources/ (rag-server.zip + models + node + seed)');
