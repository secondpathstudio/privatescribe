import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
} from 'electron';
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
import { defaultServerConfig } from './server/service-config';
import {
  installServer,
  isServerInstalled,
  uninstallServer,
} from './server/service-control';

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

/**
 * Wire up the renderer-facing server-mode IPC for the "Become a server" wizard
 * (Phase 9). install/uninstall shell out to launchctl behind a single admin
 * prompt (electron/server/service-control.ts); errors are returned to the
 * renderer rather than thrown so the wizard can show them.
 */
function registerServerIpc(): void {
  ipcMain.handle('server:is-installed', () => isServerInstalled());

  ipcMain.handle('server:install', async (_event, opts: { lanPort?: number }) => {
    try {
      const cfg = defaultServerConfig(process.resourcesPath);
      if (opts && typeof opts.lanPort === 'number') cfg.lanPort = opts.lanPort;
      await installServer(cfg);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('server:uninstall', async () => {
    try {
      await uninstallServer();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('server:info', () => {
    const cfg = defaultServerConfig(process.resourcesPath);
    return { lanPort: cfg.lanPort, pairingUrl: `https://<this-mac-ip>:${cfg.lanPort}` };
  });
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
    // Created hidden and shown only after the content finishes loading, so the
    // user never sees a blank white frame while the renderer boots. The caller
    // closes the splash window once this one is shown.
    show: false,
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

  // System-audio capture for recording teleconference notes. The renderer
  // calls getDisplayMedia() only when the user picks "System audio"; we
  // auto-grant the primary screen as the carrier for loopback audio (no
  // source picker), and the renderer discards the video track, keeping just
  // the audio. macOS still gates this behind the OS Screen Recording prompt
  // the first time. Without this handler getDisplayMedia rejects outright.
  win.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        callback(
          sources.length
            ? { video: sources[0], audio: 'loopback' }
            : // No screen available — deny by granting nothing.
              { video: undefined },
        );
      })
      .catch(() => callback({ video: undefined }));
  });

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
  // loadFile/loadURL resolve once the document is loaded — reveal the window
  // now so the splash can hand off to a painted UI rather than a white flash.
  win.show();
  win.focus();
}

/**
 * Tiny frameless window shown the moment the app launches, so the user sees
 * "PrivateScribe is starting" instead of a bare Dock icon while the Python
 * backend (and possibly Ollama) spin up. Closed by the caller once the main
 * window is ready. No preload/IPC — it's a static splash.
 */
function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 440,
    height: 320,
    frame: false,
    resizable: false,
    center: true,
    show: true,
    title: 'PrivateScribe',
    backgroundColor: '#ffffff',
    icon: ICON_PNG,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <style>
      html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
      body{display:flex;flex-direction:column;align-items:center;justify-content:center;
        background:#fff;border:3px solid #000;box-sizing:border-box;color:#000;}
      h1{font-size:28px;font-weight:900;margin:0 0 6px;letter-spacing:-0.5px;}
      p{margin:0;font-size:14px;color:#444;}
      .spinner{margin-top:22px;width:34px;height:34px;border:4px solid #000;
        border-top-color:#fd3777;border-radius:50%;animation:spin 0.8s linear infinite;}
      @keyframes spin{to{transform:rotate(360deg);}}
    </style></head>
    <body>
      <h1>PrivateScribe</h1>
      <p>Starting your private workspace…</p>
      <div class="spinner"></div>
    </body></html>`;
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  return splash;
}

/**
 * Poll the backend until it actually serves a request, not just until its
 * process exists. /api/setup/status is unauthenticated and queries the DB, so
 * a 200 confirms HTTP is up *and* the encrypted DB opened. Resolves true once
 * ready, or false if it never answers within the timeout (the caller proceeds
 * anyway and lets the in-app error UI take over).
 */
async function waitForBackendReady(
  apiBase: string,
  timeoutMs = 30_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${apiBase}/api/setup/status`);
      if (res.ok) return true;
    } catch {
      // Backend not accepting connections yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function handleBackendCrash(code: number | null, stderrTail: string): void {
  // The Python backend exited on its own after a clean start — every API
  // call from the renderer will now fail. Show a plain-language message and
  // offer a restart rather than leaving a silently broken window. The raw
  // log (usually a Python traceback) is kept behind a "Show details…" button
  // so a non-technical user isn't confronted with a stack trace.
  const tail = stderrTail.trim();
  const friendlyDetail =
    "PrivateScribe's engine stopped running, so the app can't continue.\n\n" +
    'This is usually temporary — restarting normally fixes it. If it keeps ' +
    'happening, please contact support.';

  // Loop so "Show details…" can return the user to the restart/quit choice.
  for (;;) {
    const buttons = tail
      ? ['Restart', 'Quit', 'Show details…']
      : ['Restart', 'Quit'];
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'PrivateScribe stopped working',
      message: 'PrivateScribe stopped unexpectedly.',
      detail: friendlyDetail,
      buttons,
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 2) {
      dialog.showMessageBoxSync({
        type: 'none',
        title: 'Technical details',
        message: `Engine exit code: ${code ?? 'unknown'}`,
        detail: tail.slice(-3000),
        buttons: ['Back'],
        defaultId: 0,
      });
      continue;
    }
    if (choice === 0) {
      app.relaunch();
    }
    app.quit();
    return;
  }
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
  registerServerIpc();

  let apiBase: string;
  let splash: BrowserWindow | null = null;

  if (isDev) {
    // Developer is expected to have `flask run` going on :5000.
    apiBase = 'http://127.0.0.1:5000';
  } else {
    // Show the splash immediately so the first thing the user sees is a
    // branded "starting…" screen, not a bare Dock icon, while Ollama and the
    // Python backend come up.
    splash = createSplash();

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
      if (splash && !splash.isDestroyed()) splash.close();
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

    // The backend announced its port, but Flask may still be a beat away from
    // serving (DB open, FTS index, blueprint registration). Hold the splash
    // until it actually answers so the renderer's first fetch can't race it.
    await waitForBackendReady(apiBase);
  }

  await createWindow(apiBase);
  // Main window is painted and shown — retire the splash.
  if (splash && !splash.isDestroyed()) splash.close();

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
