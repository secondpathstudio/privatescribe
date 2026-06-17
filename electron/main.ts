import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  shell,
  Tray,
} from 'electron';
import { autoUpdater } from 'electron-updater';
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
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import { Bonjour } from 'bonjour-service';

/** The subset of a discovered mDNS service we read (avoids depending on the
 *  library's exported type, which is a value, not a type). */
type MdnsService = {
  port?: number;
  name?: string;
  host?: string;
  addresses?: string[];
  txt?: Record<string, string>;
};
import { defaultServerConfig } from './server/service-config';
import {
  installServer,
  isServerInstalled,
  restartServer,
  uninstallServer,
} from './server/service-control';
import {
  readAppMode,
  serverOrigin,
  writeAppMode,
} from './server/app-mode';

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
// System-tray icon shown only in server mode (the control panel). Kept resident
// so closing the window doesn't lose access to the dashboard.
let serverTray: Tray | null = null;

/**
 * Create the system-tray icon (the menu bar on macOS) for a server box. The
 * server services run independently of this app, so the tray is just the
 * control panel: reopen the dashboard, check for updates, or quit the panel
 * (the server keeps serving).
 */
function createServerTray(apiBase: string): void {
  if (serverTray) return;
  const icon = nativeImage.createFromPath(ICON_PNG).resize({ width: 18, height: 18 });
  serverTray = new Tray(icon);
  serverTray.setToolTip('PrivateScribe Server');
  serverTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'PrivateScribe Server', enabled: false },
      { type: 'separator' },
      {
        label: 'Open Dashboard',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            void createWindow(apiBase);
          }
        },
      },
      {
        label: 'Check for Updates…',
        click: () => {
          if (!isDev) {
            autoUpdater
              .checkForUpdatesAndNotify()
              .catch((e) => console.error('[updater] manual check failed:', e));
          }
        },
      },
      { type: 'separator' },
      // Quits the control panel; the background services keep serving.
      { label: 'Quit PrivateScribe', click: () => app.quit() },
    ]),
  );
}

/**
 * Wire up the renderer-facing Ollama IPC. The onboarding wizard and OllamaGate
 * call these to start the bundled runtime on demand (never automatically) and
 * to remember the user's engine choice. Registered once, before the window
 * opens, so an invoke can never race the handler.
 */
function registerOllamaIpc(): void {
  // Onboarding "I don't have Ollama" / OllamaGate escape hatch. Fetches the
  // runtime on first use (streaming download progress back as
  // 'ollama:fetch-progress' events), starts it, persists "bundled", and resolves
  // once it answers (or fails) so the renderer can show a real result.
  ipcMain.handle('ollama:start-bundled', (event) =>
    startBundledOllama((p) => event.sender.send('ollama:fetch-progress', p)),
  );
  // Onboarding "I have my own Ollama" — remember the choice; start nothing.
  ipcMain.handle('ollama:set-mode', (_event, mode: unknown) => {
    if (mode === 'bundled' || mode === 'system') setOllamaMode(mode);
    return { ok: true };
  });
  ipcMain.handle('ollama:get-mode', () => getOllamaMode());
}

// --- Secure token storage (safeStorage, Phase 10 GAP-16) -----------------
// The desktop client keeps auth tokens encrypted at rest via the OS keychain
// (Electron safeStorage) instead of plaintext localStorage. Stored as one
// encrypted blob (a small key→value JSON map) under userData. The renderer
// reads a synchronous snapshot at boot (so auth restore stays sync) and writes
// asynchronously. Browser/PWA clients have no preload and fall back to
// localStorage on their side — untouched by this.
function secureStorePath(): string {
  return path.join(app.getPath('userData'), 'secure-store.bin');
}

function readSecureMap(): Record<string, string> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return {};
    const buf = fs.readFileSync(secureStorePath());
    const obj = JSON.parse(safeStorage.decryptString(buf));
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    // No file yet, key unavailable, or corrupt — start empty (forces a login).
    return {};
  }
}

function writeSecureMap(map: Record<string, string>): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[secure-store] OS encryption unavailable — not persisting tokens.');
      return;
    }
    fs.writeFileSync(secureStorePath(), safeStorage.encryptString(JSON.stringify(map)), {
      mode: 0o600,
    });
  } catch (err) {
    console.error('[secure-store] write failed:', err);
  }
}

function registerSecureStoreIpc(): void {
  // Synchronous decrypted snapshot — preload reads this once before the SPA
  // loads so the renderer can restore the session without an async gap.
  ipcMain.on('secure:get-all', (event) => {
    event.returnValue = readSecureMap();
  });
  // Merge a patch of keys into the stored map (e.g. {access_token, user}).
  ipcMain.handle('secure:set', (_event, patch: Record<string, string>) => {
    if (patch && typeof patch === 'object') {
      const map = readSecureMap();
      Object.assign(map, patch);
      writeSecureMap(map);
    }
    return { ok: true };
  });
  // Forget everything (logout / ephemeral close).
  ipcMain.handle('secure:clear', () => {
    try {
      fs.rmSync(secureStorePath(), { force: true });
    } catch {
      /* already gone */
    }
    return { ok: true };
  });
}

/**
 * Best-effort LAN IPv4 for the pairing URL: the first non-internal IPv4 across
 * the machine's interfaces. Returns null if none is found (e.g. offline), in
 * which case callers fall back to a placeholder. The dashboard QR uses the
 * backend's own resolver; this mirrors it for the pre-relaunch wizard screen.
 */
function lanIp(): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

/**
 * Wire up the renderer-facing server-mode IPC for the "Become a server" wizard
 * (Phase 9). install/uninstall shell out to launchctl/systemctl behind a single
 * admin prompt (electron/server/service-control.ts); errors are returned to the
 * renderer rather than thrown so the wizard can show them.
 */
function registerServerIpc(): void {
  ipcMain.handle('server:is-installed', () => isServerInstalled());

  ipcMain.handle('server:install', async (_event, opts: { lanPort?: number }) => {
    try {
      const cfg = defaultServerConfig(process.resourcesPath);
      if (opts && typeof opts.lanPort === 'number') cfg.lanPort = opts.lanPort;
      await installServer(cfg);
      // Remember this is now a server box so the next launch targets the daemon
      // (behind Caddy) instead of spawning a local backend. The wizard shows the
      // pairing URL, then calls server:finish-setup to relaunch into that mode.
      writeAppMode({ mode: 'server', lanPort: cfg.lanPort });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('server:uninstall', async () => {
    try {
      await uninstallServer();
      // Back to standalone so the app stops targeting the (now-removed) daemon.
      writeAppMode({ mode: 'standalone' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Relaunch into the just-configured server mode (called from the wizard's
  // final step) so the app points at the daemon for admin creation onward.
  ipcMain.handle('server:finish-setup', () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('server:restart', async () => {
    try {
      await restartServer();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('server:info', () => {
    const cfg = defaultServerConfig(process.resourcesPath);
    const host = lanIp() ?? '<server-ip>';
    // Deep-link to /login: a plain browser has no window.electron, so the SPA's
    // root route shows the public marketing page instead of the login screen.
    return { lanPort: cfg.lanPort, pairingUrl: `https://${host}:${cfg.lanPort}/login` };
  });
}

/**
 * Normalize whatever the user typed/scanned into a clean server origin:
 * default to https, drop any path/query (the pairing URL deep-links to /login,
 * but we want the bare origin), strip a trailing slash, and default the port to
 * the standard LAN port when none is given. Throws on input that isn't a URL.
 */
function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const u = new URL(withScheme); // throws on garbage
  // Force https — a PrivateScribe server is always TLS (Caddy).
  u.protocol = 'https:';
  if (!u.port) u.port = String(defaultServerConfig(process.resourcesPath).lanPort);
  return `https://${u.hostname}:${u.port}`;
}

/**
 * Wire up the renderer-facing client-pairing IPC (Phase 10). `probe` reaches a
 * candidate server with cert verification OFF (a PrivateScribe server is
 * self-signed; the real trust decision is trust-on-first-use when the app
 * relaunches into client mode) purely to confirm it's reachable AND actually a
 * PrivateScribe backend before we commit. `connect` persists client mode and
 * relaunches; the existing serverOrigin/certificate-error path then takes over.
 */
function registerClientIpc(): void {
  // Browse the LAN for PrivateScribe servers advertising over mDNS (the backend
  // daemon publishes _privatescribe._tcp). Collects for a short window and
  // returns the distinct servers found, newest-name-wins. Best-effort: a
  // multicast-blocked network just yields an empty list and the UI falls back
  // to manual entry.
  ipcMain.handle('client:discover', async () => {
    return await new Promise<{ name: string; origin: string; host: string }[]>((resolve) => {
      let bonjour: InstanceType<typeof Bonjour> | null = null;
      const found = new Map<string, { name: string; origin: string; host: string }>();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          bonjour?.destroy();
        } catch {
          /* ignore teardown errors */
        }
        resolve([...found.values()]);
      };
      try {
        bonjour = new Bonjour();
        const browser = bonjour.find({ type: 'privatescribe', protocol: 'tcp' });
        browser.on('up', (svc: MdnsService) => {
          const port = svc.port;
          // Prefer an IPv4 address (Caddy + the cert are reached by IP); fall
          // back to the advertised .local hostname when only IPv6 is present.
          const ipv4 = (svc.addresses ?? []).find((a: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a));
          const host = ipv4 || (svc.host ? svc.host.replace(/\.$/, '') : '');
          if (!host || !port) return;
          const origin = `https://${host}:${port}`;
          const txt = (svc.txt ?? {}) as Record<string, string>;
          found.set(origin, { name: txt.name || svc.name || host, origin, host });
        });
      } catch {
        finish();
        return;
      }
      setTimeout(finish, 2500);
    });
  });

  ipcMain.handle('client:probe', async (_event, rawUrl: unknown) => {
    let origin: string;
    try {
      origin = normalizeServerUrl(String(rawUrl ?? ''));
    } catch {
      return { ok: false, error: "That doesn't look like a valid server address." };
    }
    return await new Promise<{ ok: boolean; origin?: string; fingerprint?: string; error?: string }>(
      (resolve) => {
        const req = https.get(
          `${origin}/api/setup/status`,
          // Self-signed is expected here; this probe is a reachability + identity
          // check, not the security boundary. TOFU pinning happens on first load.
          { rejectUnauthorized: false, timeout: 8000 },
          (res) => {
            const cert = (res.socket as import('tls').TLSSocket).getPeerCertificate?.();
            let body = '';
            res.on('data', (c) => {
              body += c;
              if (body.length > 64_000) req.destroy(); // guard against a non-API endpoint
            });
            res.on('end', () => {
              try {
                const json = JSON.parse(body);
                // The setup-status shape is PrivateScribe's signature — a random
                // HTTPS server won't return it, so a typo'd host fails cleanly.
                if (res.statusCode === 200 && json && 'needs_setup' in json) {
                  resolve({ ok: true, origin, fingerprint: cert?.fingerprint256 });
                  return;
                }
              } catch {
                /* fall through to the error below */
              }
              resolve({ ok: false, error: "That address responded, but it isn't a PrivateScribe server." });
            });
          },
        );
        req.on('timeout', () => {
          req.destroy();
          resolve({ ok: false, error: "Couldn't reach that server. Check the address and that you're on the same network." });
        });
        req.on('error', () => {
          resolve({ ok: false, error: "Couldn't reach that server. Check the address and that you're on the same network." });
        });
      },
    );
  });

  // Commit: persist client mode (clearing any prior cert pin so the new server
  // is trusted fresh on first connect) and relaunch into it. Does not resolve —
  // the app exits and relaunches pointing at the server.
  ipcMain.handle('client:connect', (_event, rawUrl: unknown) => {
    const origin = normalizeServerUrl(String(rawUrl ?? ''));
    writeAppMode({ mode: 'client', serverUrl: origin });
    app.relaunch();
    app.exit(0);
  });

  // Re-attempt loading the server-hosted SPA (from the connection-loss retry
  // page). No-op outside server/client mode.
  ipcMain.handle('client:retry-connection', () => {
    const origin = serverOrigin(readAppMode());
    if (origin && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`${origin}/#/login`).catch(() => {
        /* did-fail-load re-shows the retry page */
      });
    }
  });
}

// --- Post-update service restart (Phase 9 item 7) -------------------------
// The services run binaries *inside* the installed app (the .app bundle on
// macOS, the install dir on Linux/Windows). An auto-update replaces those
// binaries in place (same path, new code), but the already-running services
// keep executing the old code until restarted. The control-panel app only
// updates when it's launched, so on launch we compare the recorded version to
// the current one and, if this box is a server, restart the services to pick
// up the new binaries (one admin prompt, with the operator right there).

function serverVersionMarkerPath(): string {
  return path.join(app.getPath('userData'), 'server-version.json');
}

function readLastServerVersion(): string | null {
  try {
    return JSON.parse(fs.readFileSync(serverVersionMarkerPath(), 'utf8'))?.version ?? null;
  } catch {
    return null;
  }
}

function writeServerVersion(version: string): void {
  try {
    fs.writeFileSync(serverVersionMarkerPath(), JSON.stringify({ version }), 'utf8');
  } catch (err) {
    console.error('[server] failed to record version marker:', err);
  }
}

async function maybeRestartServerAfterUpdate(): Promise<void> {
  // Only relevant on a server box; a no-op for standalone/client/dev.
  if (!isServerInstalled()) return;
  const current = app.getVersion();
  const last = readLastServerVersion();
  if (last && last !== current) {
    console.log(`[server] app updated ${last} → ${current}; restarting services`);
    try {
      await restartServer();
    } catch (err) {
      // Best-effort: a failed restart shouldn't block launch. The services keep
      // running the old binaries; the operator can restart from the dashboard.
      console.error('[server] post-update daemon restart failed:', err);
    }
  }
  writeServerVersion(current);
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

/**
 * A fully local "can't reach the server" page (a data: URL — no network, so it
 * works precisely when the server is down). Shown in server/client mode when
 * loading the SPA from the server fails, instead of Chromium's dead error page.
 * Offers a manual retry and auto-reconnects: it polls the server and reloads
 * the SPA the moment it's reachable again. `apiBase` is the server origin.
 */
function connectionErrorPage(apiBase: string, detail: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:#fff;color:#000;text-align:center;padding:24px;box-sizing:border-box;}
    h1{font-size:24px;font-weight:900;margin:0 0 8px;letter-spacing:-0.5px;}
    p{margin:0 0 6px;font-size:14px;color:#444;max-width:440px;line-height:1.4;}
    .detail{font-size:12px;color:#aaa;margin-top:10px;}
    button{margin-top:22px;font-weight:800;text-transform:uppercase;letter-spacing:1px;
      background:#fd3777;color:#fff;border:3px solid #000;box-shadow:5px 5px 0 #000;
      padding:12px 22px;cursor:pointer;font-size:14px;}
    button:active{transform:translate(2px,2px);box-shadow:3px 3px 0 #000;}
    .status{margin-top:16px;font-size:12px;color:#888;}
  </style></head><body>
    <h1>Can't reach the server</h1>
    <p>PrivateScribe can't connect to your server right now. It may be turned
       off or restarting, or this device may be on a different network.</p>
    <p class="detail">${esc(detail)}</p>
    <button onclick="retry()">Try again</button>
    <div class="status">Checking automatically…</div>
    <script>
      var ORIGIN = ${JSON.stringify(apiBase)};
      function retry(){ if (window.electron && window.electron.client) window.electron.client.retry(); }
      // Poll for reachability (no-cors: resolves iff the server answered) and
      // reload the SPA automatically when it comes back.
      setInterval(function(){
        fetch(ORIGIN + '/api/setup/status', { mode:'no-cors', cache:'no-store' })
          .then(function(){ retry(); }).catch(function(){});
      }, 4000);
    </script>
  </body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

/**
 * In server/client mode, catch a failed load of the server-hosted SPA and show
 * the local retry page instead of a stuck Chromium error. Wired before the
 * first load so even the initial connect is covered.
 */
function attachConnectionLossHandler(win: BrowserWindow, apiBase: string): void {
  win.webContents.on('did-fail-load', (_e, errorCode, errorDesc, _url, isMainFrame) => {
    // Only the top-level document failing strands the user; ignore subresources
    // and ABORTED (-3), which fires for superseded navigations (incl. our retry).
    if (!isMainFrame || errorCode === -3) return;
    win.loadURL(connectionErrorPage(apiBase, errorDesc || `Error ${errorCode}`)).catch(() => {});
  });
}

async function createWindow(apiBase: string): Promise<void> {
  const deploymentMode = readAppMode().mode;
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
      // Passed through to preload.ts so the renderer learns the backend URL
      // and the deployment role. Read in preload via process.argv.
      additionalArguments: [`--api-base=${apiBase}`, `--mode=${deploymentMode}`],
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
  } else if (deploymentMode === 'server' || deploymentMode === 'client') {
    // Load the SPA *from the server* (Caddy) so the page and /api are
    // same-origin — no CORS, and the cert-error handler trusts the load. This
    // is also how a client renders a remote server's UI (Phase 10). If the
    // server is unreachable, did-fail-load swaps in the local retry page.
    attachConnectionLossHandler(win, apiBase);
    await win.loadURL(`${apiBase}/#/login`).catch(() => {
      /* did-fail-load shows the retry screen */
    });
  } else {
    // Standalone: load the built SPA from Resources/frontend (the extraResources
    // copy, shared with Caddy in server mode). It used to live in the asar, but
    // moving the SPA to extraResources for Caddy removed it from the asar — so
    // load it from process.resourcesPath, not the old asar-relative path.
    // HashRouter handles `#/login` cleanly from file:// URLs.
    await win.loadFile(
      path.join(process.resourcesPath, 'frontend', 'index.html'),
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
  registerClientIpc();
  registerSecureStoreIpc();
  // If this box is a server and the app was just updated, restart the services
  // so they run the new binaries. No-op for standalone/dev.
  await maybeRestartServerAfterUpdate();

  let apiBase: string;
  let splash: BrowserWindow | null = null;

  const appMode = readAppMode();
  const remoteOrigin = serverOrigin(appMode);

  if (isDev) {
    // Developer is expected to have `flask run` going on :5000.
    apiBase = 'http://127.0.0.1:5000';
  } else if (remoteOrigin) {
    // Server-controller or client mode: the backend is a service behind Caddy
    // (server) or a remote server (client). Don't spawn a local backend or
    // Ollama — just point at it. The renderer's requests are trusted by the
    // certificate-error handler (trust-on-first-use). The services are managed
    // by the OS (launchd / systemd / WinSW), so we don't block on readiness
    // here; the Login page polls /api/setup/status and the dashboard reflects
    // live health.
    splash = createSplash();
    apiBase = remoteOrigin;
  } else {
    // Standalone: spawn our own backend.
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

  // Server box: add the system-tray control panel so the dashboard is reachable
  // even after the window is closed.
  if (appMode.mode === 'server') {
    createServerTray(apiBase);
  }

  // Check for app updates in the background — packaged builds only. A newer
  // release downloads silently and installs on the next quit (see updater.ts).
  if (!isDev) {
    initAutoUpdater();
  }
});

// In-session memory of the user's decision about a *changed* server cert, keyed
// by the new fingerprint, so we prompt once (not once per resource load).
let certChangeDecision: { fingerprint: string; trusted: boolean } | null = null;

// Trust the target server's self-signed certificate (server/client mode).
// PrivateScribe servers use a self-signed cert (Caddy's internal CA) on a
// private network, which Electron would otherwise reject. Trust-on-first-use:
// the first cert is pinned; an exact match is trusted silently. A *mismatch*
// (the server was reinstalled/rebuilt — or someone is impersonating it) is no
// longer a silent dead-end: we warn loudly with both fingerprints and let the
// user re-pin or cancel. Every other certificate error rejects.
app.on('certificate-error', (event, _webContents, url, _error, certificate, callback) => {
  const config = readAppMode();
  const origin = serverOrigin(config);
  if (!origin || !url.startsWith(origin)) {
    callback(false);
    return;
  }
  event.preventDefault();
  const fp = certificate.fingerprint;

  if (!config.certFingerprint) {
    // First connection — pin it (TOFU).
    writeAppMode({ ...config, certFingerprint: fp });
    callback(true);
    return;
  }
  if (config.certFingerprint === fp) {
    callback(true);
    return;
  }

  // Mismatch. Reuse this session's decision for the same new fingerprint so we
  // don't stack dialogs across the many cert checks a single page load makes.
  if (certChangeDecision?.fingerprint === fp) {
    callback(certChangeDecision.trusted);
    return;
  }
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Server identity changed',
    message: "This PrivateScribe server's security certificate has changed.",
    detail:
      'This is expected if the server was reinstalled or rebuilt. But it can ' +
      'also mean another device is impersonating the server on your network.\n\n' +
      `Server: ${origin}\n` +
      `Previously trusted: ${config.certFingerprint}\n` +
      `Now presenting:     ${fp}\n\n` +
      'Only trust the new certificate if you know the server was changed.',
    buttons: ['Cancel (stay safe)', 'Trust the new certificate'],
    defaultId: 0,
    cancelId: 0,
  });
  const trusted = choice === 1;
  certChangeDecision = { fingerprint: fp, trusted };
  if (trusted) writeAppMode({ ...readAppMode(), certFingerprint: fp });
  callback(trusted);
});

app.on('window-all-closed', () => {
  // Server mode: the services serve independently and the system-tray icon is
  // the control panel — stay resident so the dashboard can be reopened from it.
  if (readAppMode().mode === 'server') return;
  // Standalone/client: nothing useful to keep resident once the window closes,
  // so quit (macOS would normally stay alive). before-quit stops the backend.
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
