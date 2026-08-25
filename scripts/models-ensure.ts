#!/usr/bin/env tsx
/**
 * Validate and download models listed in models/manifest.json
 * Default mirror: https://hf-mirror.com
 *
 * Usage:
 *   pnpm models:ensure
 *   pnpm models:ensure embedding.bge-m3
 *   pnpm models:download -- embedding.bge-m3
 */
import { ensureModel, findModelEntry, loadManifest } from '../apps/rag-server/src/model-manager.js';

const force = process.argv.includes('--force');
const filterId = process.argv
  .slice(2)
  .find((a) => !a.startsWith('-'));

async function main() {
  const mirror =
    process.env.HF_ENDPOINT ?? process.env.PIFLOW_HF_MIRROR ?? 'https://hf-mirror.com';
  const host = mirror.endsWith('/') ? mirror.slice(0, -1) : mirror;
  console.log(`[models-ensure] mirror: ${host}`);
  console.log(`[models-ensure] dir: ${process.env.PIFLOW_MODELS_DIR ?? 'models/ (repo)'}`);

  const manifest = await loadManifest();
  const ids = filterId ? [filterId] : manifest.models.map((m) => m.id);

  if (filterId && !manifest.models.some((m) => m.id === filterId)) {
    console.error(`Unknown model id: ${filterId}`);
    process.exit(1);
  }

  for (const id of ids) {
    const entry = await findModelEntry(id);
    await ensureModel(entry, { force });
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
