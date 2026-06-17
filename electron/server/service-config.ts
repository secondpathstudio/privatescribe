/**
 * Server-mode service configuration (roadmap Phase 9 item 3).
 *
 * Pure config generation for the three daemons that make up a PrivateScribe
 * server — launchd plists on macOS, systemd units on Linux, WinSW service
 * wrappers on Windows. No side effects, so it's unit-testable without touching
 * the system. The privileged install/lifecycle (writing the service files,
 * elevation, launchctl / systemctl / WinSW) lives in service-control.ts.
 *
 * Topology: Caddy is the only LAN-facing process. The backend binds loopback
 * only; Ollama binds a private loopback port; Caddy terminates TLS on the LAN
 * port, serves the built SPA, and reverse-proxies /api to the backend.
 *
 * The daemons run as root (macOS/Linux) or LocalSystem (Windows) system
 * services — they survive logout with no user session — with data under a
 * shared system directory. The SQLCipher key is read by the backend from the
 * data dir's .env — never placed in a service file.
 */
import * as path from 'path';

import { exe, resolveOllamaBinary } from '../platform';

const IS_LINUX = process.platform === 'linux';
const IS_WIN = process.platform === 'win32';

// Machine-wide, writable base for a Windows server install (LocalSystem
// services can write here). ProgramData is the Windows equivalent of /var/lib.
const PROGRAM_DATA = process.env.ProgramData || 'C:\\ProgramData';

// Shared, service-owned locations for a server install (not the per-user
// app-support dir standalone uses). Windows uses ProgramData; Linux follows the
// FHS; macOS uses /Library.
export const SERVER_DATA_DIR = IS_WIN
  ? path.join(PROGRAM_DATA, 'PrivateScribe')
  : IS_LINUX
    ? '/var/lib/privatescribe'
    : '/Library/Application Support/PrivateScribe';
export const LOG_DIR = IS_WIN
  ? path.join(PROGRAM_DATA, 'PrivateScribe', 'logs')
  : IS_LINUX
    ? '/var/log/privatescribe'
    : '/Library/Logs/PrivateScribe';
export const LAUNCH_DAEMON_DIR = '/Library/LaunchDaemons';
export const SYSTEMD_UNIT_DIR = '/etc/systemd/system';
// Where the WinSW wrapper exes + their XML configs live on Windows. Under the
// data dir so they survive electron-updater swaps (which replace the install
// dir, not ProgramData); service-control.ts stages winsw.exe + config here.
export const WINSW_DIR = IS_WIN ? path.join(SERVER_DATA_DIR, 'services') : '';

export const LABELS = {
  backend: 'com.secondpath.privatescribe.backend',
  ollama: 'com.secondpath.privatescribe.ollama',
  caddy: 'com.secondpath.privatescribe.caddy',
} as const;

// systemd unit file names (Linux counterpart of LABELS).
export const UNIT_NAMES = {
  backend: 'privatescribe-backend.service',
  ollama: 'privatescribe-ollama.service',
  caddy: 'privatescribe-caddy.service',
} as const;

// Windows service ids — the WinSW <id> and the name shown in services.msc /
// queried with `sc query` (Windows counterpart of LABELS / UNIT_NAMES).
export const SERVICE_IDS = {
  backend: 'privatescribe-backend',
  ollama: 'privatescribe-ollama',
  caddy: 'privatescribe-caddy',
} as const;

// The app bundle id. Stamped into each daemon's plist as
// AssociatedBundleIdentifiers so macOS groups them under "PrivateScribe" in
// Login Items & Extensions, rather than under the signing identity.
export const APP_BUNDLE_ID = 'com.secondpath.privatescribe';

// Defaults. Only the LAN port is user-visible (the pairing URL); the other two
// are private loopback ports the operator never needs to know.
export const DEFAULT_PORTS = { lan: 8443, backend: 5111, ollama: 11435 } as const;

export interface ServerConfig {
  /** process.resourcesPath — the .app's Contents/Resources. */
  resourcesPath: string;
  /** LAN HTTPS port Caddy listens on (the pairing URL port). */
  lanPort: number;
  /** Loopback port the backend binds. */
  backendPort: number;
  /** Loopback port Ollama binds. */
  ollamaPort: number;
  /** Shared data dir (DB, audio, .env, caddy CA store). */
  dataDir: string;
  /** Absolute path the Ollama service execs. The runtime is fetched at install
   *  time into <dataDir>/ollama-runtime (it's no longer bundled), so the install
   *  flow sets this from the staged runtime's marker (the binary nests
   *  differently per OS). */
  ollamaBinaryPath: string;
}

export function defaultServerConfig(resourcesPath: string): ServerConfig {
  return {
    resourcesPath,
    lanPort: DEFAULT_PORTS.lan,
    backendPort: DEFAULT_PORTS.backend,
    ollamaPort: DEFAULT_PORTS.ollama,
    dataDir: SERVER_DATA_DIR,
    // Placeholder — the install flow overrides this with the exact path derived
    // from the staged runtime's marker. Until then it best-effort points at the
    // post-install location.
    ollamaBinaryPath: resolveOllamaBinary(path.join(SERVER_DATA_DIR, 'ollama-runtime')),
  };
}

/** Absolute paths to the bundled binaries and assets within the .app. */
export function serverPaths(resourcesPath: string) {
  return {
    backend: path.join(resourcesPath, 'backend', exe('privatescribe-backend')),
    // NOTE: the Ollama binary is NOT here — the runtime is fetched at install
    // time into <dataDir>/ollama-runtime (cfg.ollamaBinaryPath), not bundled.
    caddy: path.join(resourcesPath, 'caddy-runtime', exe('privatescribe-webserver')),
    caddyfileTemplate: path.join(resourcesPath, 'caddy-runtime', 'Caddyfile.template'),
    // WinSW service-wrapper exe (Windows only; staged by fetch-winsw.mjs).
    // service-control.ts copies this to <id>.exe per service at install time.
    winsw: path.join(resourcesPath, 'winsw-runtime', exe('winsw')),
    // Plain (non-asar) SPA files for Caddy to serve — see extraResources.
    frontend: path.join(resourcesPath, 'frontend'),
    pyannote: path.join(resourcesPath, 'pyannote-models'),
  };
}

/** Where the rendered Caddyfile and Caddy's CA store live at runtime. */
export function caddyfilePath(cfg: ServerConfig): string {
  return path.join(cfg.dataDir, 'Caddyfile');
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface PlistSpec {
  label: string;
  programArguments: string[];
  environment?: Record<string, string>;
  workingDirectory?: string;
  stdoutPath: string;
  stderrPath: string;
}

/** Render a launchd LaunchDaemon plist. RunAtLoad + KeepAlive => starts at
 *  boot and restarts on crash. Runs as root (no UserName key). */
export function renderPlist(spec: PlistSpec): string {
  const args = spec.programArguments
    .map((a) => `\t\t<string>${xmlEscape(a)}</string>`)
    .join('\n');
  const env = spec.environment
    ? '\t<key>EnvironmentVariables</key>\n\t<dict>\n' +
      Object.entries(spec.environment)
        .map(
          ([k, v]) =>
            `\t\t<key>${xmlEscape(k)}</key>\n\t\t<string>${xmlEscape(v)}</string>`,
        )
        .join('\n') +
      '\n\t</dict>\n'
    : '';
  const workdir = spec.workingDirectory
    ? `\t<key>WorkingDirectory</key>\n\t<string>${xmlEscape(spec.workingDirectory)}</string>\n`
    : '';
  // Attribute the daemon to the app so macOS groups it under "PrivateScribe"
  // (not the Developer ID) in Login Items & Extensions.
  const assoc =
    `\t<key>AssociatedBundleIdentifiers</key>\n\t<string>${xmlEscape(APP_BUNDLE_ID)}</string>\n`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${xmlEscape(spec.label)}</string>
${assoc}\t<key>ProgramArguments</key>
\t<array>
${args}
\t</array>
${env}${workdir}\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${xmlEscape(spec.stdoutPath)}</string>
\t<key>StandardErrorPath</key>
\t<string>${xmlEscape(spec.stderrPath)}</string>
</dict>
</plist>
`;
}

export function backendPlist(cfg: ServerConfig): string {
  const p = serverPaths(cfg.resourcesPath);
  return renderPlist({
    label: LABELS.backend,
    programArguments: [p.backend],
    environment: {
      // launchd gives daemons no HOME; tools that expect one (matplotlib's
      // font cache, etc.) need it. Point it at the writable data dir.
      HOME: cfg.dataDir,
      PRIVATESCRIBE_MODE: 'server',
      PRIVATESCRIBE_DATA_DIR: cfg.dataDir,
      // Backend binds loopback only — Caddy is the LAN face. This overrides
      // server mode's default 0.0.0.0 bind (see backend deployment.bind_host).
      PRIVATESCRIBE_HOST: '127.0.0.1',
      PRIVATESCRIBE_PORT: String(cfg.backendPort),
      // Caddy's LAN HTTPS port — what clients actually connect to. The backend
      // advertises this (not its own loopback port) over mDNS for discovery.
      PRIVATESCRIBE_LAN_PORT: String(cfg.lanPort),
      OLLAMA_HOST: `127.0.0.1:${cfg.ollamaPort}`,
      PYANNOTE_MODELS_DIR: p.pyannote,
    },
    stdoutPath: path.join(LOG_DIR, 'backend.log'),
    stderrPath: path.join(LOG_DIR, 'backend.err.log'),
  });
}

export function ollamaPlist(cfg: ServerConfig): string {
  return renderPlist({
    label: LABELS.ollama,
    programArguments: [cfg.ollamaBinaryPath, 'serve'],
    environment: {
      // Ollama hard-errors ("$HOME is not defined") under launchd without HOME.
      HOME: cfg.dataDir,
      OLLAMA_HOST: `127.0.0.1:${cfg.ollamaPort}`,
      // Persist pulled models in the shared data dir, not root's home.
      OLLAMA_MODELS: path.join(cfg.dataDir, 'ollama-models'),
    },
    stdoutPath: path.join(LOG_DIR, 'ollama.log'),
    stderrPath: path.join(LOG_DIR, 'ollama.err.log'),
  });
}

export function caddyPlist(cfg: ServerConfig): string {
  const p = serverPaths(cfg.resourcesPath);
  return renderPlist({
    label: LABELS.caddy,
    programArguments: [
      p.caddy,
      'run',
      '--config',
      caddyfilePath(cfg),
      '--adapter',
      'caddyfile',
    ],
    environment: {
      // launchd sets no HOME; Caddy warns and may misplace assets without it.
      HOME: cfg.dataDir,
      // Caddy persists its internal CA + leaf cert here so the cert (and the
      // fingerprint clients pin) is stable across restarts.
      XDG_DATA_HOME: path.join(cfg.dataDir, 'caddy', 'data'),
      XDG_CONFIG_HOME: path.join(cfg.dataDir, 'caddy', 'config'),
    },
    stdoutPath: path.join(LOG_DIR, 'caddy.log'),
    stderrPath: path.join(LOG_DIR, 'caddy.err.log'),
  });
}

/** Quote a word for a systemd ExecStart= or Environment= line: double quotes
 *  allow \ and " escapes, and % must be doubled or systemd expands it as a
 *  specifier. */
function unitQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
}

interface UnitSpec {
  description: string;
  execStart: string[];
  environment?: Record<string, string>;
  stdoutPath: string;
  stderrPath: string;
}

/** Render a systemd system unit — the Linux counterpart of renderPlist.
 *  Restart=always restarts on crash; enabling it (WantedBy=multi-user.target)
 *  starts it at boot. Runs as root, matching the macOS LaunchDaemons. */
export function renderUnit(spec: UnitSpec): string {
  const lines = [
    '[Unit]',
    `Description=${spec.description}`,
    'After=network.target',
    '',
    '[Service]',
    `ExecStart=${spec.execStart.map(unitQuote).join(' ')}`,
  ];
  for (const [k, v] of Object.entries(spec.environment ?? {})) {
    lines.push(`Environment=${unitQuote(`${k}=${v}`)}`);
  }
  lines.push(
    'Restart=always',
    'RestartSec=2',
    // append: needs systemd >= 240 (2018) — a given on any distro recent
    // enough to run the app.
    `StandardOutput=append:${spec.stdoutPath}`,
    `StandardError=append:${spec.stderrPath}`,
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  );
  return lines.join('\n') + '\n';
}

export function backendUnit(cfg: ServerConfig): string {
  const p = serverPaths(cfg.resourcesPath);
  return renderUnit({
    description: 'PrivateScribe backend',
    execStart: [p.backend],
    environment: {
      // System services get no HOME; tools that expect one (matplotlib's
      // font cache, etc.) need it. Point it at the writable data dir.
      HOME: cfg.dataDir,
      PRIVATESCRIBE_MODE: 'server',
      PRIVATESCRIBE_DATA_DIR: cfg.dataDir,
      // Backend binds loopback only — Caddy is the LAN face.
      PRIVATESCRIBE_HOST: '127.0.0.1',
      PRIVATESCRIBE_PORT: String(cfg.backendPort),
      // Caddy's LAN HTTPS port — what clients actually connect to. The backend
      // advertises this (not its own loopback port) over mDNS for discovery.
      PRIVATESCRIBE_LAN_PORT: String(cfg.lanPort),
      OLLAMA_HOST: `127.0.0.1:${cfg.ollamaPort}`,
      PYANNOTE_MODELS_DIR: p.pyannote,
    },
    stdoutPath: path.join(LOG_DIR, 'backend.log'),
    stderrPath: path.join(LOG_DIR, 'backend.err.log'),
  });
}

export function ollamaUnit(cfg: ServerConfig): string {
  return renderUnit({
    description: 'PrivateScribe Ollama runtime',
    execStart: [cfg.ollamaBinaryPath, 'serve'],
    environment: {
      // Ollama hard-errors ("$HOME is not defined") without HOME.
      HOME: cfg.dataDir,
      OLLAMA_HOST: `127.0.0.1:${cfg.ollamaPort}`,
      // Persist pulled models in the shared data dir, not root's home.
      OLLAMA_MODELS: path.join(cfg.dataDir, 'ollama-models'),
    },
    stdoutPath: path.join(LOG_DIR, 'ollama.log'),
    stderrPath: path.join(LOG_DIR, 'ollama.err.log'),
  });
}

export function caddyUnit(cfg: ServerConfig): string {
  const p = serverPaths(cfg.resourcesPath);
  return renderUnit({
    description: 'PrivateScribe web server (Caddy)',
    execStart: [p.caddy, 'run', '--config', caddyfilePath(cfg), '--adapter', 'caddyfile'],
    environment: {
      HOME: cfg.dataDir,
      // Caddy persists its internal CA + leaf cert here so the cert (and the
      // fingerprint clients pin) is stable across restarts.
      XDG_DATA_HOME: path.join(cfg.dataDir, 'caddy', 'data'),
      XDG_CONFIG_HOME: path.join(cfg.dataDir, 'caddy', 'config'),
    },
    stdoutPath: path.join(LOG_DIR, 'caddy.log'),
    stderrPath: path.join(LOG_DIR, 'caddy.err.log'),
  });
}

// ---------------------------------------------------------------------------
// Windows: WinSW service wrappers — the counterpart of the launchd plists and
// systemd units above. WinSW wraps each bundled exe as a Windows Service.
// ---------------------------------------------------------------------------

/** Escape a value for an XML attribute (WinSW `<env name=".." value="..">`):
 *  the element-text entities plus the double-quote that delimits the value. */
function xmlAttr(s: string): string {
  return xmlEscape(s).replace(/"/g, '&quot;');
}

interface WinswSpec {
  /** Windows service id — also the WinSW wrapper exe basename + log prefix. */
  id: string;
  /** Friendly name shown in services.msc. */
  displayName: string;
  description: string;
  /** [executable, ...args] — mirrors programArguments / execStart. */
  command: string[];
  environment?: Record<string, string>;
  /** Directory WinSW writes <id>.out.log / <id>.err.log into. */
  logDir: string;
}

/** Render a WinSW service-wrapper XML — the Windows counterpart of renderPlist
 *  / renderUnit. startmode=Automatic starts it at boot; onfailure=restart is
 *  the KeepAlive / Restart=always equivalent. With no <serviceaccount>, WinSW
 *  runs it as LocalSystem, matching the root daemons on macOS/Linux. */
export function renderWinswConfig(spec: WinswSpec): string {
  const [executable, ...args] = spec.command;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<service>',
    `  <id>${xmlEscape(spec.id)}</id>`,
    `  <name>${xmlEscape(spec.displayName)}</name>`,
    `  <description>${xmlEscape(spec.description)}</description>`,
    `  <executable>${xmlEscape(executable)}</executable>`,
  ];
  // One <startargument> per arg sidesteps the quoting pitfalls of a single
  // <arguments> string when a path contains spaces.
  for (const a of args) {
    lines.push(`  <startargument>${xmlEscape(a)}</startargument>`);
  }
  for (const [k, v] of Object.entries(spec.environment ?? {})) {
    lines.push(`  <env name="${xmlAttr(k)}" value="${xmlAttr(v)}"/>`);
  }
  lines.push(
    '  <startmode>Automatic</startmode>',
    // Restart on crash 2s later — KeepAlive / Restart=always + RestartSec=2.
    '  <onfailure action="restart" delay="2 sec"/>',
    // Reset the failure counter after an hour of uptime so an isolated late
    // crash still triggers a restart.
    '  <resetfailure>1 hour</resetfailure>',
    // WinSW writes <id>.out.log / <id>.err.log here (rolled by size so they
    // can't grow unbounded), mirroring the per-service logs on the others.
    '  <log mode="roll-by-size"/>',
    `  <logpath>${xmlEscape(spec.logDir)}</logpath>`,
    '</service>',
  );
  return lines.join('\n') + '\n';
}

export function backendService(cfg: ServerConfig): string {
  const p = serverPaths(cfg.resourcesPath);
  return renderWinswConfig({
    id: SERVICE_IDS.backend,
    displayName: 'PrivateScribe Backend',
    description: 'PrivateScribe backend (API + transcription)',
    command: [p.backend],
    environment: {
      // LocalSystem has no real profile; point tools that expect a home
      // (matplotlib's font cache, etc.) at the writable data dir.
      HOME: cfg.dataDir,
      PRIVATESCRIBE_MODE: 'server',
      PRIVATESCRIBE_DATA_DIR: cfg.dataDir,
      // Backend binds loopback only — Caddy is the LAN face.
      PRIVATESCRIBE_HOST: '127.0.0.1',
      PRIVATESCRIBE_PORT: String(cfg.backendPort),
      // Caddy's LAN HTTPS port — what clients connect to; advertised over mDNS.
      PRIVATESCRIBE_LAN_PORT: String(cfg.lanPort),
      OLLAMA_HOST: `127.0.0.1:${cfg.ollamaPort}`,
      PYANNOTE_MODELS_DIR: p.pyannote,
    },
    logDir: LOG_DIR,
  });
}

export function ollamaService(cfg: ServerConfig): string {
  return renderWinswConfig({
    id: SERVICE_IDS.ollama,
    displayName: 'PrivateScribe Ollama',
    description: 'PrivateScribe Ollama runtime',
    command: [cfg.ollamaBinaryPath, 'serve'],
    environment: {
      HOME: cfg.dataDir,
      // Ollama on Windows reads USERPROFILE; LocalSystem's points into
      // system32\config — redirect it at the writable data dir too.
      USERPROFILE: cfg.dataDir,
      OLLAMA_HOST: `127.0.0.1:${cfg.ollamaPort}`,
      // Persist pulled models in the shared data dir, not the service profile.
      OLLAMA_MODELS: path.join(cfg.dataDir, 'ollama-models'),
    },
    logDir: LOG_DIR,
  });
}

export function caddyService(cfg: ServerConfig): string {
  const p = serverPaths(cfg.resourcesPath);
  return renderWinswConfig({
    id: SERVICE_IDS.caddy,
    displayName: 'PrivateScribe Web Server',
    description: 'PrivateScribe web server (Caddy)',
    command: [p.caddy, 'run', '--config', caddyfilePath(cfg), '--adapter', 'caddyfile'],
    environment: {
      HOME: cfg.dataDir,
      // Caddy checks XDG_DATA_HOME first on every OS (Windows included); pin it
      // so the internal CA + leaf cert (and the fingerprint clients pin) stay
      // stable across restarts instead of landing under the service profile.
      XDG_DATA_HOME: path.join(cfg.dataDir, 'caddy', 'data'),
      XDG_CONFIG_HOME: path.join(cfg.dataDir, 'caddy', 'config'),
    },
    logDir: LOG_DIR,
  });
}

/** Render the bundled Caddyfile template with this deployment's values. */
export function renderCaddyfile(template: string, cfg: ServerConfig): string {
  const p = serverPaths(cfg.resourcesPath);
  return template
    .replace(/{{LAN_PORT}}/g, String(cfg.lanPort))
    .replace(/{{BACKEND_PORT}}/g, String(cfg.backendPort))
    .replace(/{{FRONTEND_ROOT}}/g, p.frontend);
}
