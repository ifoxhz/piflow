import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { getDataDir } from './paths.js';

const MAX_BYTES = 20 * 1024 * 1024;
/** Keep current + .1 + .2 */
const KEEP_ROTATED = 2;
const LOG_NAME = 'rag-server.log';

let stream: fs.WriteStream | null = null;
let currentSize = 0;
let initialized = false;

const originalLog = console.log.bind(console);
const originalInfo = console.info.bind(console);
const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);
const originalDebug = console.debug.bind(console);

export function getLogDir(): string {
  return path.join(getDataDir(), 'logs');
}

export function getServerLogPath(): string {
  return path.join(getLogDir(), LOG_NAME);
}

function closeStream(): void {
  if (!stream) return;
  try {
    stream.end();
  } catch {
    /* ignore */
  }
  stream = null;
}

function rotateLogs(): void {
  closeStream();
  const logPath = getServerLogPath();
  for (let i = KEEP_ROTATED; i >= 1; i--) {
    const src = i === 1 ? logPath : `${logPath}.${i - 1}`;
    const dest = `${logPath}.${i}`;
    if (fs.existsSync(dest)) {
      try {
        fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
    }
    if (fs.existsSync(src)) {
      try {
        fs.renameSync(src, dest);
      } catch {
        /* ignore */
      }
    }
  }
  currentSize = 0;
}

function ensureStream(): fs.WriteStream {
  if (stream) return stream;
  fs.mkdirSync(getLogDir(), { recursive: true });
  const logPath = getServerLogPath();
  if (fs.existsSync(logPath)) {
    currentSize = fs.statSync(logPath).size;
    if (currentSize >= MAX_BYTES) {
      rotateLogs();
    }
  } else {
    currentSize = 0;
  }
  stream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
  stream.on('error', (err) => {
    originalError.call(console, '[file-logger] write error:', err);
  });
  return stream;
}

function writeLine(level: string, args: unknown[]): void {
  try {
    const line =
      `${new Date().toISOString()} [${level}] ${util.format(...args)}`.replace(/\r?\n/g, ' ') +
      '\n';
    const buf = Buffer.byteLength(line, 'utf8');
    if (currentSize > 0 && currentSize + buf > MAX_BYTES) {
      rotateLogs();
    }
    const s = ensureStream();
    s.write(line);
    currentSize += buf;
  } catch {
    /* never throw from logging */
  }
}

/** Tee console → rotating `{dataDir}/logs/rag-server.log` (20MB × 3). Also keeps stdout. */
export function initFileLogger(): { logDir: string; logFile: string } {
  if (initialized) {
    return { logDir: getLogDir(), logFile: getServerLogPath() };
  }
  initialized = true;

  fs.mkdirSync(getLogDir(), { recursive: true });
  ensureStream();

  console.log = (...args: unknown[]) => {
    originalLog(...args);
    writeLine('info', args);
  };
  console.info = (...args: unknown[]) => {
    originalInfo(...args);
    writeLine('info', args);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    writeLine('warn', args);
  };
  console.error = (...args: unknown[]) => {
    originalError(...args);
    writeLine('error', args);
  };
  console.debug = (...args: unknown[]) => {
    originalDebug(...args);
    writeLine('debug', args);
  };

  writeLine('info', [
    `[file-logger] writing to ${getServerLogPath()} (rotate ${MAX_BYTES / (1024 * 1024)}MB × ${KEEP_ROTATED + 1})`,
  ]);

  return { logDir: getLogDir(), logFile: getServerLogPath() };
}
