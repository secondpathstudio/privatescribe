/**
 * Server-mode service install + lifecycle (roadmap Phase 9 item 3b).
 *
 * Installs the three PrivateScribe daemons (backend, Ollama, Caddy) as macOS
 * LaunchDaemons so the server survives logout and restarts on crash. The
 * privileged steps — writing to /Library/LaunchDaemons, chown root:wheel,
 * launchctl bootstrap — run inside a single shell script executed once with
 * administrator privileges (the native auth prompt), so the operator approves
 * the whole install in one elevation.
 *
 * The plist/Caddyfile *contents* come from service-config.ts (pure, tested).
 * The script-building functions here are also pure and unit-tested; only
 * runElevated() and the install/uninstall/restart wrappers touch the system,
 * and those require a real Mac with admin to verify (no elevation in CI).
 *
 * Idempotent: install boots out any existing daemons before bootstrapping, so
 * a re-install (or an auto-update restart) is safe.
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import {
  backendPlist,
  caddyPlist,
  caddyfilePath,
  LABELS,
  LAUNCH_DAEMON_DIR,
  LOG_DIR,
  ollamaPlist,
  renderCaddyfile,
  serverPaths,
  ServerConfig,
} from './service-config';

const execFileAsync = promisify(execFile);

const ORDER = ['backend', 'ollama', 'caddy'] as const;
type DaemonName = (typeof ORDER)[number];

function daemonPlistPath(name: DaemonName): string {
  return path.join(LAUNCH_DAEMON_DIR, `${LABELS[name]}.plist`);
}

/** Shell-quote a path for safe embedding in the install script. */
function sh(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * The privileged install script. Pure (returns the script text) so it can be
 * asserted in tests. `staging` holds the plists + Caddyfile the unprivileged
 * Electron process already wrote; this copies them into place and loads them.
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

  // Each daemon: bootout any existing instance (ignore errors), install the
  // plist with the right owner/mode, then bootstrap it into the system domain.
  for (const name of ORDER) {
    const dest = daemonPlistPath(name);
    const src = path.join(staging, `${name}.plist`);
    lines.push(`launchctl bootout system/${LABELS[name]} 2>/dev/null || true`);
    lines.push(`cp ${sh(src)} ${sh(dest)}`);
    lines.push(`chown root:wheel ${sh(dest)}`);
    lines.push(`chmod 644 ${sh(dest)}`);
    lines.push(`launchctl bootstrap system ${sh(dest)}`);
  }
  return lines.join('\n') + '\n';
}

/** Tear down all three daemons and remove their plists. */
export function buildUninstallScript(): string {
  const lines: string[] = ['#!/bin/sh'];
  for (const name of ORDER) {
    lines.push(`launchctl bootout system/${LABELS[name]} 2>/dev/null || true`);
    lines.push(`rm -f ${sh(daemonPlistPath(name))}`);
  }
  return lines.join('\n') + '\n';
}

/** Restart all three daemons in dependency order (used after an auto-update,
 *  which replaces the .app the daemons' ProgramArguments point at). */
export function buildRestartScript(): string {
  const lines: string[] = ['#!/bin/sh'];
  for (const name of ORDER) {
    // kickstart -k restarts the service (killing it first if running).
    lines.push(`launchctl kickstart -k system/${LABELS[name]} 2>/dev/null || true`);
  }
  return lines.join('\n') + '\n';
}

/** Run a shell script once with administrator privileges (native auth prompt).
 *  macOS-only; device-test-pending. */
async function runElevated(scriptBody: string, promptReason: string): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-svc-'));
  const scriptPath = path.join(dir, 'install.sh');
  fs.writeFileSync(scriptPath, scriptBody, { mode: 0o700 });
  try {
    // osascript shows the system auth dialog; the script then runs as root.
    // `with prompt` customizes the dialog text so the operator knows why.
    const apple =
      `do shell script "/bin/sh " & quoted form of ${JSON.stringify(scriptPath)} ` +
      `with prompt ${JSON.stringify(promptReason)} with administrator privileges`;
    await execFileAsync('osascript', ['-e', apple]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** True when all three daemon plists are present in /Library/LaunchDaemons.
 *  Statting them needs no elevation. */
export function isServerInstalled(): boolean {
  return ORDER.every((name) => fs.existsSync(daemonPlistPath(name)));
}

/** Stage the rendered config to a temp dir and install + start the daemons. */
export async function installServer(cfg: ServerConfig): Promise<void> {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-stage-'));
  try {
    fs.writeFileSync(path.join(staging, 'backend.plist'), backendPlist(cfg));
    fs.writeFileSync(path.join(staging, 'ollama.plist'), ollamaPlist(cfg));
    fs.writeFileSync(path.join(staging, 'caddy.plist'), caddyPlist(cfg));

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
