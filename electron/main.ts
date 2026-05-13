import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { startBackend, stopBackend, type BackendInfo } from './backend-process';

// app.isPackaged is false when running via `electron .` from source, true once
// electron-builder has bundled the app. That's the right signal for whether to
// spawn the bundled Python backend vs assume a developer has `flask run` going.
const isDev = !app.isPackaged;

let backend: BackendInfo | null = null;

async function createWindow(apiBase: string): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Passed through to preload.ts so the renderer learns which port the
      // backend ended up on. Read in preload via process.argv.
      additionalArguments: [`--api-base=${apiBase}`],
    },
  });

  if (isDev) {
    await win.loadURL('http://localhost:3000/login');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(
      path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html'),
    );
  }
}

app.whenReady().then(async () => {
  let apiBase: string;

  if (isDev) {
    // Developer is expected to have `flask run` going on :5000.
    apiBase = 'http://127.0.0.1:5000';
  } else {
    backend = await startBackend();
    apiBase = `http://127.0.0.1:${backend.port}`;
  }

  await createWindow(apiBase);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(apiBase);
    }
  });
});

app.on('window-all-closed', () => {
  if (backend) {
    stopBackend(backend);
    backend = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (backend) {
    stopBackend(backend);
    backend = null;
  }
});
