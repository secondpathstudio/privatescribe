import { spawn, type ChildProcess } from 'child_process';
import { app } from 'electron';
import * as path from 'path';

export interface BackendInfo {
  process: ChildProcess;
  port: number;
}

const PORT_LINE = /PRIVATESCRIBE_PORT=(\d+)/;
const STARTUP_TIMEOUT_MS = 30_000;

export async function startBackend(): Promise<BackendInfo> {
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
      console.error('[backend stderr]', chunk.toString());
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Backend exited with code ${code} before announcing port`));
    });
  });

  return { process: child, port };
}

export function stopBackend(info: BackendInfo): void {
  if (!info.process.killed) {
    info.process.kill();
  }
}
