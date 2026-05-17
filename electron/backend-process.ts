import { spawn, type ChildProcess } from 'child_process';
import { app } from 'electron';
import * as path from 'path';

export interface BackendInfo {
  process: ChildProcess;
  port: number;
}

const PORT_LINE = /PRIVATESCRIBE_PORT=(\d+)/;
const STARTUP_TIMEOUT_MS = 30_000;

// Set true once we intentionally stop the backend (app quitting) so the crash
// watcher can tell a clean shutdown apart from an unexpected exit.
let stopping = false;

// Rolling tail of the backend's stderr, kept so a crash dialog can show the
// last thing it printed — usually a Python traceback. Capped to stay small.
const STDERR_TAIL_MAX = 4000;
let stderrTail = '';

export async function startBackend(ollamaHost: string): Promise<BackendInfo> {
  // In a packaged app the PyInstaller binary lives at
  // <Resources>/backend/privatescribe-backend. process.resourcesPath is the
  // .app's Contents/Resources/ on macOS.
  const binaryPath = path.join(
    process.resourcesPath,
    'backend',
    'privatescribe-backend',
  );
  const dataDir = app.getPath('userData');

  const child = spawn(binaryPath, [], {
    env: {
      ...process.env,
      PRIVATESCRIBE_DATA_DIR: dataDir,
      // The Ollama main.ts resolved for us — a reused system instance or the
      // bundled runtime. The backend's ollama client reads OLLAMA_HOST.
      OLLAMA_HOST: ollamaHost,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Backend did not announce a port within 30s'));
    }, STARTUP_TIMEOUT_MS);

    let stdoutBuf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const match = stdoutBuf.match(PORT_LINE);
      if (match) {
        clearTimeout(timer);
        resolve(parseInt(match[1], 10));
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-STDERR_TAIL_MAX);
      console.error('[backend stderr]', text);
    });

    // spawn() failures (e.g. the binary is missing) surface here, not as a
    // throw — without this a missing binary just looks like a 30s timeout.
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Backend process failed to start: ${err.message}`));
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Backend exited with code ${code} before announcing port`));
    });
  });

  return { process: child, port };
}

/**
 * Watch an already-started backend for an *unexpected* exit. The callback
 * fires at most once, and never for the exit caused by stopBackend() during a
 * normal app quit. `stderrTail` is the last few KB the backend logged.
 */
export function onBackendCrash(
  info: BackendInfo,
  callback: (code: number | null, stderrTail: string) => void,
): void {
  info.process.once('exit', (code) => {
    if (stopping) return;
    callback(code, stderrTail);
  });
}

export function stopBackend(info: BackendInfo): void {
  stopping = true;
  if (!info.process.killed) {
    info.process.kill();
  }
}
