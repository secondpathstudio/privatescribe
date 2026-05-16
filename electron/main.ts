import { app, BrowserWindow, dialog, Menu, nativeImage, shell } from 'electron';
import * as path from 'path';
import { startBackend, stopBackend, type BackendInfo } from './backend-process';

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

app.whenReady().then(async () => {
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

  let apiBase: string;

  if (isDev) {
    // Developer is expected to have `flask run` going on :5000.
    apiBase = 'http://127.0.0.1:5000';
  } else {
    try {
      backend = await startBackend();
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
