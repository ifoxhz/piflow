/**
 * Isolated child process for PP-OCR. Native onnxruntime FATAL errors kill only
 * this process; the parent ingest job can skip the page and continue.
 *
 * IPC: parent → { id, width, height, data: ArrayBuffer }
 *      child  → { id, ok: true, text } | { id, ok: false, error }
 */
import { ocrPageImage } from './pp-ocr.js';

process.on('message', (msg: unknown) => {
  void handle(msg);
});

async function handle(msg: unknown): Promise<void> {
  if (!msg || typeof msg !== 'object') return;
  const m = msg as {
    id?: number;
    width?: number;
    height?: number;
    data?: ArrayBuffer;
  };
  if (typeof m.id !== 'number' || !m.data || !m.width || !m.height) return;

  try {
    const text = await ocrPageImage({
      width: m.width,
      height: m.height,
      data: new Uint8Array(m.data),
    });
    process.send?.({ id: m.id, ok: true, text });
  } catch (err) {
    process.send?.({
      id: m.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

process.send?.({ type: 'ready' });
