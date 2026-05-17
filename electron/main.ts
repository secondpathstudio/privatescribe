import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from 'electron';
import * as path from 'path';
import {
  onBackendCrash,
  startBackend,
  stopBackend,
  type BackendInfo,
} from './backend-process';
import {
  getOllamaMode,
  resolveOllama,
  setOllamaMode,
  startBundledOllama,
  stopOllama,
} from './ollama-process';
import { initAutoUpdater } from './updater';

// Set early so app.getName() and macOS menus pick this up instead of "Electron".
// In a packaged build this comes from CFBundleName in Info.plist (driven by
// productName in package.json) and the setName() call is a no-op.
app.setName('PrivateScribe');

// What shows in the "About PrivateScribe" panel from the app menu. In dev
// this would otherwise fall back to the Electron binary's Info.plist
// ("Electron 33.x.x"). Packaged builds also pick these up but can be
// overridden via the bundled Info.plist.
app.setAboutPanelOptions({
  applicationName: 'PrivateScribe',
  applicationVersion: app.getVersion(),
  version: app.getVersion(),
  copyright: `Copyright © ${new Date().getFullYear()} Second Path Studio`,
  credits:
    'A private, local AI scribe.\n' +
    'Fully open source — MIT licensed.\n' +
    'https://www.secondpath.dev',
});

// app.isPackaged is false when running via `electron .` from source, true once
// electron-builder has bundled the app. That's the right signal for whether to
// spawn the bundled Python backend vs assume a developer has `flask run` going.
const isDev = !app.isPackaged;

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const ICON_ICNS = path.join(ASSETS_DIR, 'icon.icns'); // used by electron-builder
const ICON_PNG = path.join(ASSETS_DIR, 'icon.png'); // used at dev runtime for Dock

let backend: BackendInfo | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * Wire up the renderer-facing Ollama IPC. The onboarding wizard and OllamaGate
 * call these to start the bundled runtime on demand (never automatically) and
 * to remember the user's engine choice. Registered once, before the window
 * opens, so an invoke can never race the handler.
 */
function registerOllamaIpc(): void {
  // Onboarding "I don't have Ollama" / OllamaGate escape hatch. Spawns the
  // bundled runtime, persists "bundled", and resolves once it answers (or
  // fails) so the renderer can show a real result.
  ipcMain.handle('ollama:start-bundled', () => startBundledOllama());
  // Onboarding "I have my own Ollama" — remember the choice; start nothing.
  ipcMain.handle('ollama:set-mode', (_event, mode: unknown) => {
    if (mode === 'bundled' || mode === 'system') setOllamaMode(mode);
    return { ok: true };
  });
  ipcMain.handle('ollama:get-mode', () => getOllamaMode());
}

// Single-instance lock: a second PrivateScribe would spawn a second backend
// against the same encrypted database and data directory — lock contention at
// best, and real corruption risk if both run a migration or key rotation at
// once. If another instance already holds the lock, focus it and quit this
// one. The whenReady() handler below also guards on this flag so a second
// instance never starts a backend.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Another launch was attempted — surface the window we already have.
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function buildMenu(): void {
  // Custom application menu. Without an Edit menu the standard Cmd+C/V/X/A
  // shortcuts don't work in inputs on macOS, so we include it explicitly.
  // View menu only exposes dev tools in dev builds.
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: isDev
        ? [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
          ]
        : [
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
          ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { role: 'close' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'PrivateScribe on GitHub',
          click: () =>
            shell.openExternal('https://github.com/secondpathstudio/privatescribe'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(apiBase: string): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'PrivateScribe',
    icon: ICON_PNG,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Passed through to preload.ts so the renderer learns which port the
      // backend ended up on. Read in preload via process.argv.
      additionalArguments: [`--api-base=${apiBase}`],
    },
  });
  mainWindow = win;

  if (isDev) {
    await win.loadURL('http://localhost:3000/#/login');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // HashRouter handles `#/login` cleanly from file:// URLs where
    // BrowserRouter can't reason about the pathname.
    await win.loadFile(
      path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html'),
      { hash: '/login' },
    );
  }
}

function handleBackendCrash(code: number | null, stderrTail: string): void {
  // The Python backend exited on its own after a clean start — every API
  // call from the renderer will now fail. Tell the user plainly and offer a
  // restart rather than leaving them with a silently broken window.
  const tail = stderrTail.trim();
  const detail =
    `The PrivateScribe engine stopped unexpectedly (exit code ${code ?? 'unknown'}).\n\n` +
    'The app needs to restart to keep working.' +
    (tail ? `\n\nLast log output:\n${tail.slice(-1500)}` : '');
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: 'PrivateScribe stopped working',
    message: 'The PrivateScribe engine stopped unexpectedly.',
    detail,
    buttons: ['Restart', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice === 0) {
    app.relaunch();
  }
  app.quit();
}

app.whenReady().then(async () => {
  // A second instance is already quitting (see the single-instance lock
  // above) — never spawn a backend or open a window from it.
  if (!isPrimaryInstance) return;

  // In dev the Dock icon comes from the Electron binary, so override at
  // runtime. PNG is more reliable than icns for nativeImage.createFromPath.
  // In packaged builds the icon is baked in by electron-builder.
  if (process.platform === 'darwin' && app.dock) {
    const img = nativeImage.createFromPath(ICON_PNG);
    if (!img.isEmpty()) {
      app.dock.setIcon(img);
    } else {
      console.warn(`[icon] failed to load dock icon from ${ICON_PNG}`);
    }
  }

  buildMenu();
  registerOllamaIpc();

  let apiBase: string;

  if (isDev) {
    // Developer is expected to have `flask run` going on :5000.
    apiBase = 'http://127.0.0.1:5000';
  } else {
    // Resolve Ollama before the backend: the backend reads OLLAMA_HOST at
    // spawn time, so it must be known first. resolveOllama() reuses a running
    // system Ollama, starts the bundled runtime if that was the user's
    // remembered choice, or starts nothing on a fresh install (onboarding
    // decides). It never throws and never blocks on readiness, and always
    // returns the fixed host the backend should target.
    const ollamaHost = await resolveOllama();

    try {
      backend = await startBackend(ollamaHost);
    } catch (err) {
      // The bundled Python backend failed to launch. Without it the app is
      // just an empty shell, so surface a clear error and quit rather than
      // leaving a dead Dock icon with no window.
      const detail = err instanceof Error ? err.message : String(err);
      dialog.showErrorBox(
        'PrivateScribe could not start',
        'The PrivateScribe engine failed to start, so the app cannot run.\n\n' +
          `Details: ${detail}\n\n` +
          'Try reopening PrivateScribe. If this keeps happening, please contact support.',
      );
      app.quit();
      return;
    }
    // Backend started cleanly — watch it for an unexpected exit so a
    // mid-session crash surfaces a dialog instead of a silently broken UI.
    onBackendCrash(backend, handleBackendCrash);
    apiBase = `http://127.0.0.1:${backend.port}`;
  }

  await createWindow(apiBase);

  // Check for app updates in the background — packaged builds only. A newer
  // release downloads silently and installs on the next quit (see updater.ts).
  if (!isDev) {
    initAutoUpdater();
  }
});

app.on('window-all-closed', () => {
  // PrivateScribe is a single-window app with a bundled backend — there's
  // nothing useful to keep resident once the window closes, so quit on all
  // platforms (macOS would normally stay alive). before-quit stops the
  // backend.
  app.quit();
});

app.on('before-quit', () => {
  if (backend) {
    stopBackend(backend);
    backend = null;
  }
  // No-op unless we started the bundled runtime ourselves.
  stopOllama();
});
