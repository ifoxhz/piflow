import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { PaddleOcrService } from 'paddleocr';
import { getModelsDir } from '../../../platform/paths.js';

type OcrImageInput = {
  width: number;
  height: number;
  /** RGB or RGBA packed pixels. */
  data: Uint8Array;
};

type PaddleOcrInstance = Awaited<ReturnType<typeof PaddleOcrService.createInstance>>;

const EXPECTED_DICT_LEN = 18709;

let servicePromise: Promise<PaddleOcrInstance> | null = null;

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/** Split dict file without dropping a trailing space-only entry. */
export function loadDictionary(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Build CTC dict from official PP-OCR `inference.yml` PostProcess.character_dict.
 * Appends a space if missing (model expects 18709 classes without blank).
 */
export function dictionaryFromInferenceYml(yml: string): string[] {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*character_dict:\s*$/.test(l));
  if (start < 0) {
    throw new Error('inference.yml missing character_dict');
  }
  const chars: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*-\s+(.*)$/);
    if (!m) {
      if (chars.length > 0) break;
      continue;
    }
    let item = m[1].trim();
    if (
      (item.startsWith("'") && item.endsWith("'")) ||
      (item.startsWith('"') && item.endsWith('"'))
    ) {
      item = item.slice(1, -1);
      item = item.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    chars.push(item);
  }
  if (!chars.includes(' ')) {
    chars.push(' ');
  }
  return chars;
}

function ocrModelRoot(): string {
  return process.env.PIFLOW_PADDLEOCR_DIR ?? path.join(getModelsDir(), 'paddleocr');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDictionary(dictPath: string, ymlPath: string): Promise<string[]> {
  if (await fileExists(dictPath)) {
    const existing = loadDictionary(await readFile(dictPath, 'utf-8'));
    if (existing.length >= EXPECTED_DICT_LEN) {
      return existing;
    }
  }
  if (!(await fileExists(ymlPath))) {
    throw new Error(
      `PP-OCR dictionary missing/short and no inference.yml at ${ymlPath}. Run: pnpm models:ensure ocr.ppocr-v6-small`,
    );
  }
  const chars = dictionaryFromInferenceYml(await readFile(ymlPath, 'utf-8'));
  await writeFile(dictPath, chars.map((c) => `${c}\n`).join(''), 'utf-8');
  return chars;
}

async function createOcrService(): Promise<PaddleOcrInstance> {
  const root = ocrModelRoot();
  const detPath = path.join(root, 'ppocr_v6_small/PP-OCRv6_small_det_infer.onnx');
  const recPath = path.join(root, 'ppocr_v6_small/PP-OCRv6_small_rec_infer.onnx');
  const dictPath = path.join(root, 'ppocr_v6_small/ppocrv6_dict.txt');
  const ymlPath = path.join(root, 'ppocr_v6_small/inference.yml');
  const oriPath = path.join(root, 'pp_lcnet_x0_25_textline_ori/PP-LCNet_x0_25_textline_ori_infer.onnx');

  const [detModel, recModel, textlineModel, dictionary] = await Promise.all([
    readFile(detPath),
    readFile(recPath),
    readFile(oriPath),
    ensureDictionary(dictPath, ymlPath),
  ]);

  if (dictionary.length < EXPECTED_DICT_LEN) {
    throw new Error(
      `PP-OCR dictionary too short (${dictionary.length}); expected ≥ ${EXPECTED_DICT_LEN}.`,
    );
  }

  console.log('[ingest] loading PP-OCR (PP-OCRv6_small)…');
  const service = await PaddleOcrService.createInstance({
    // paddleocr's OrtModule typing lags onnxruntime-node InferenceSession overloads
    ort: ort as never,
    modelPreset: 'PP-OCRv6_small',
    detection: { modelBuffer: toArrayBuffer(detModel) },
    recognition: {
      modelBuffer: toArrayBuffer(recModel),
      charactersDictionary: dictionary,
    },
    textlineOrientation: {
      modelBuffer: toArrayBuffer(textlineModel),
      threshold: 0.9,
    },
  });
  console.log('[ingest] PP-OCR ready');
  return service;
}

async function getOcrService(): Promise<PaddleOcrInstance> {
  if (!servicePromise) {
    servicePromise = createOcrService().catch((err) => {
      servicePromise = null;
      throw err;
    });
  }
  return servicePromise;
}

/** OCR one RGB(A) page image; returns plain text (may be empty). */
export async function ocrPageImage(image: OcrImageInput): Promise<string> {
  const ocr = await getOcrService();
  const results = await ocr.recognize(image, {
    ordering: {
      sortByReadingOrder: true,
      sameLineThresholdRatio: 0.15,
    },
  });
  return ocr.processRecognition(results).text.trim();
}
