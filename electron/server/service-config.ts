/**
 * Server-mode service configuration (roadmap Phase 9 item 3).
 *
 * Pure config generation for the three macOS launchd daemons that make up a
 * PrivateScribe server — no side effects, so it's unit-testable without
 * touching the system. The privileged install/lifecycle (writing to
 * /Library/LaunchDaemons, elevation, launchctl) lives in service-control.ts.
 *
 * Topology: Caddy is the only LAN-facing process. The backend binds loopback
 * only; Ollama binds a private loopback port; Caddy terminates TLS on the LAN
 * port, serves the built SPA, and reverse-proxies /api to the backend.
 *
 * The daemons run as root LaunchDaemons (survive logout, no user session
 * needed) with data under a shared system directory. The SQLCipher key is read
 * by the backend from the data dir's .env — never placed in a plist.
 */
import * as path from 'path';

// Shared, root-owned locations for a server install (not the per-user
// app-support dir standalone uses).
export const SERVER_DATA_DIR = '/Library/Application Support/PrivateScribe';
export const LOG_DIR = '/Library/Logs/PrivateScribe';
export const LAUNCH_DAEMON_DIR = '/Library/LaunchDaemons';

export const LABELS = {
  backend: 'com.secondpath.privatescribe.backend',
  ollama: 'com.secondpath.privatescribe.ollama',
  caddy: 'com.secondpath.privatescribe.caddy',
} as const;

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
}

export function defaultServerConfig(resourcesPath: string): ServerConfig {
  return {
    resourcesPath,
    lanPort: DEFAULT_PORTS.lan,
    backendPort: DEFAULT_PORTS.backend,
    ollamaPort: DEFAULT_PORTS.ollama,
    dataDir: SERVER_DATA_DIR,
  };
}

/** Absolute paths to the bundled binaries and assets within the .app. */
export function serverPaths(resourcesPath: string) {
  return {
    backend: path.join(resourcesPath, 'backend', 'privatescribe-backend'),
    ollama: path.join(resourcesPath, 'ollama-runtime', 'ollama'),
    caddy: path.join(resourcesPath, 'caddy-runtime', 'caddy'),
    caddyfileTemplate: path.join(resourcesPath, 'caddy-runtime', 'Caddyfile.template'),
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
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${xmlEscape(spec.label)}</string>
\t<key>ProgramArguments</key>
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
      PRIVATESCRIBE_MODE: 'server',
      PRIVATESCRIBE_DATA_DIR: cfg.dataDir,
      // Backend binds loopback only — Caddy is the LAN face. This overrides
      // server mode's default 0.0.0.0 bind (see backend deployment.bind_host).
      PRIVATESCRIBE_HOST: '127.0.0.1',
      PRIVATESCRIBE_PORT: String(cfg.backendPort),
      OLLAMA_HOST: `127.0.0.1:${cfg.ollamaPort}`,
      PYANNOTE_MODELS_DIR: p.pyannote,
    },
    stdoutPath: path.join(LOG_DIR, 'backend.log'),
    stderrPath: path.join(LOG_DIR, 'backend.err.log'),
  });
}

export function ollamaPlist(cfg: ServerConfig): string {
  const p = serverPaths(cfg.resourcesPath);
  return renderPlist({
    label: LABELS.ollama,
    programArguments: [p.ollama, 'serve'],
    environment: {
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
      // Caddy persists its internal CA + leaf cert here so the cert (and the
      // fingerprint clients pin) is stable across restarts.
      XDG_DATA_HOME: path.join(cfg.dataDir, 'caddy', 'data'),
      XDG_CONFIG_HOME: path.join(cfg.dataDir, 'caddy', 'config'),
    },
    stdoutPath: path.join(LOG_DIR, 'caddy.log'),
    stderrPath: path.join(LOG_DIR, 'caddy.err.log'),
  });
}

/** Render the bundled Caddyfile template with this deployment's values. */
export function renderCaddyfile(template: string, cfg: ServerConfig): string {
  const p = serverPaths(cfg.resourcesPath);
  return template
    .replace(/{{LISTEN_ADDR}}/g, `https://0.0.0.0:${cfg.lanPort}`)
    .replace(/{{BACKEND_PORT}}/g, String(cfg.backendPort))
    .replace(/{{FRONTEND_ROOT}}/g, p.frontend);
}
