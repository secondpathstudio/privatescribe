/**
 * Server-mode service install + lifecycle (roadmap Phase 9 item 3b).
 *
 * Installs the three PrivateScribe daemons (backend, Ollama, Caddy) as system
 * services — macOS LaunchDaemons or Linux systemd units — so the server
 * survives logout and restarts on crash. The privileged steps — writing the
 * service files, chown/chmod, launchctl bootstrap / systemctl enable — run
 * inside a single shell script executed once with administrator privileges
 * (osascript's native auth prompt on macOS, polkit's pkexec on Linux), so the
 * operator approves the whole install in one elevation.
 *
 * The plist/unit/Caddyfile *contents* come from service-config.ts (pure,
 * tested). The script-building functions here are also pure; only
 * runElevated() and the install/uninstall/restart wrappers touch the system,
 * and those require a real machine with admin to verify (no elevation in CI).
 *
 * Idempotent: install stops any existing daemons before (re)starting, so a
 * re-install (or an auto-update restart) is safe.
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import {
  backendPlist,
  backendUnit,
  caddyPlist,
  caddyUnit,
  caddyfilePath,
  LABELS,
  LAUNCH_DAEMON_DIR,
  LOG_DIR,
  ollamaPlist,
  ollamaUnit,
  renderCaddyfile,
  serverPaths,
  ServerConfig,
  SYSTEMD_UNIT_DIR,
  UNIT_NAMES,
} from './service-config';

const execFileAsync = promisify(execFile);

const IS_LINUX = process.platform === 'linux';

const ORDER = ['backend', 'ollama', 'caddy'] as const;
type DaemonName = (typeof ORDER)[number];

/** Where the daemon's service file lives once installed. */
function serviceFilePath(name: DaemonName): string {
  return IS_LINUX
    ? path.join(SYSTEMD_UNIT_DIR, UNIT_NAMES[name])
    : path.join(LAUNCH_DAEMON_DIR, `${LABELS[name]}.plist`);
}

/** The staged service file's name within the staging dir. */
function stagedFileName(name: DaemonName): string {
  return IS_LINUX ? `${name}.service` : `${name}.plist`;
}

/** Shell-quote a path for safe embedding in the install script. */
function sh(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * The privileged install script. Pure (returns the script text) so it can be
 * asserted in tests. `staging` holds the plists/units + Caddyfile the
 * unprivileged Electron process already wrote; this copies them into place
 * and loads them.
 */
export function buildInstallScript(cfg: ServerConfig, staging: string): string {
  const lines: string[] = ['#!/bin/sh', 'set -e'];

  // Shared data + log dirs (root-owned; the daemons run as root).
  for (const d of [
    cfg.dataDir,
    path.join(cfg.dataDir, 'caddy', 'data'),
    path.join(cfg.dataDir, 'caddy', 'config'),
    path.join(cfg.dataDir, 'ollama-models'),
    LOG_DIR,
  ]) {
    lines.push(`mkdir -p ${sh(d)}`);
  }

  // Rendered Caddyfile into the data dir.
  lines.push(`cp ${sh(path.join(staging, 'Caddyfile'))} ${sh(caddyfilePath(cfg))}`);

  if (IS_LINUX) {
    // Install the unit files, then enable (start at boot) + restart (pick up
    // new config/binaries even if an older install is already running).
    for (const name of ORDER) {
      const dest = serviceFilePath(name);
      lines.push(`cp ${sh(path.join(staging, stagedFileName(name)))} ${sh(dest)}`);
      lines.push(`chown root:root ${sh(dest)}`);
      lines.push(`chmod 644 ${sh(dest)}`);
    }
    lines.push('systemctl daemon-reload');
    for (const name of ORDER) {
      lines.push(`systemctl enable ${UNIT_NAMES[name]}`);
      lines.push(`systemctl restart ${UNIT_NAMES[name]}`);
    }
  } else {
    // Each daemon: bootout any existing instance (ignore errors), install the
    // plist with the right owner/mode, then bootstrap it into the system domain.
    for (const name of ORDER) {
      const dest = serviceFilePath(name);
      const src = path.join(staging, stagedFileName(name));
      lines.push(`launchctl bootout system/${LABELS[name]} 2>/dev/null || true`);
      lines.push(`cp ${sh(src)} ${sh(dest)}`);
      lines.push(`chown root:wheel ${sh(dest)}`);
      lines.push(`chmod 644 ${sh(dest)}`);
      lines.push(`launchctl bootstrap system ${sh(dest)}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** Tear down all three daemons and remove their service files. */
export function buildUninstallScript(): string {
  const lines: string[] = ['#!/bin/sh'];
  if (IS_LINUX) {
    for (const name of ORDER) {
      lines.push(`systemctl disable --now ${UNIT_NAMES[name]} 2>/dev/null || true`);
      lines.push(`rm -f ${sh(serviceFilePath(name))}`);
    }
    lines.push('systemctl daemon-reload || true');
  } else {
    for (const name of ORDER) {
      lines.push(`launchctl bootout system/${LABELS[name]} 2>/dev/null || true`);
      lines.push(`rm -f ${sh(serviceFilePath(name))}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** Restart all three daemons in dependency order (used after an auto-update,
 *  which replaces the app the daemons' exec paths point at). */
export function buildRestartScript(): string {
  const lines: string[] = ['#!/bin/sh'];
  for (const name of ORDER) {
    if (IS_LINUX) {
      lines.push(`systemctl restart ${UNIT_NAMES[name]} 2>/dev/null || true`);
    } else {
      // kickstart -k restarts the service (killing it first if running).
      lines.push(`launchctl kickstart -k system/${LABELS[name]} 2>/dev/null || true`);
    }
  }
  return lines.join('\n') + '\n';
}

/** Run a shell script once with administrator privileges via the platform's
 *  native auth prompt. Device-test-pending. */
async function runElevated(scriptBody: string, promptReason: string): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-svc-'));
  const scriptPath = path.join(dir, 'install.sh');
  fs.writeFileSync(scriptPath, scriptBody, { mode: 0o700 });
  try {
    if (IS_LINUX) {
      // pkexec shows the polkit auth dialog. The generic dialog can't carry
      // promptReason — custom text would need a polkit policy file shipped
      // with the app. Exit 126 = dismissed, 127 = not authorized.
      try {
        await execFileAsync('pkexec', ['/bin/sh', scriptPath]);
      } catch (err) {
        // execFile errors carry a string errno on spawn failure ('ENOENT')
        // and the numeric exit status when the command ran and failed.
        const e = err as { code?: string | number };
        if (e.code === 'ENOENT') {
          throw new Error(
            'pkexec was not found — install your distribution\'s polkit package, then try again.',
          );
        }
        if (e.code === 126 || e.code === 127) {
          throw new Error('Administrator authorization was cancelled or denied.');
        }
        throw err;
      }
    } else if (process.platform === 'darwin') {
      // osascript shows the system auth dialog; the script then runs as root.
      // `with prompt` customizes the dialog text so the operator knows why.
      const apple =
        `do shell script "/bin/sh " & quoted form of ${JSON.stringify(scriptPath)} ` +
        `with prompt ${JSON.stringify(promptReason)} with administrator privileges`;
      await execFileAsync('osascript', ['-e', apple]);
    } else {
      throw new Error(`Server setup is not supported on this platform (${process.platform}).`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** True when all three daemons' service files are installed. Statting them
 *  needs no elevation. */
export function isServerInstalled(): boolean {
  return ORDER.every((name) => fs.existsSync(serviceFilePath(name)));
}

/** Stage the rendered config to a temp dir and install + start the daemons. */
export async function installServer(cfg: ServerConfig): Promise<void> {
  // An AppImage runs from an ephemeral squashfs mount (/tmp/.mount_*) that is
  // randomized per launch and unmounted when the app quits — systemd units
  // pointing into it would break as soon as the app closed. The .deb installs
  // to a stable /opt path, so server mode requires it.
  if (IS_LINUX && process.env.APPIMAGE) {
    throw new Error(
      'Server setup is not available from the AppImage build: the AppImage runs ' +
        'from a temporary mount that disappears when the app closes, so the ' +
        'background services would lose their files. Install the .deb package ' +
        'and run server setup from there.',
    );
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-stage-'));
  try {
    const render = IS_LINUX
      ? { backend: backendUnit, ollama: ollamaUnit, caddy: caddyUnit }
      : { backend: backendPlist, ollama: ollamaPlist, caddy: caddyPlist };
    for (const name of ORDER) {
      fs.writeFileSync(path.join(staging, stagedFileName(name)), render[name](cfg));
    }

    const template = fs.readFileSync(serverPaths(cfg.resourcesPath).caddyfileTemplate, 'utf8');
    fs.writeFileSync(path.join(staging, 'Caddyfile'), renderCaddyfile(template, cfg));

    await runElevated(
      buildInstallScript(cfg, staging),
      'PrivateScribe needs administrator access to install the server background services.',
    );
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export async function uninstallServer(): Promise<void> {
  await runElevated(
    buildUninstallScript(),
    'PrivateScribe needs administrator access to remove the server background services.',
  );
}

export async function restartServer(): Promise<void> {
  await runElevated(
    buildRestartScript(),
    'PrivateScribe needs administrator access to restart the server services.',
  );
}
