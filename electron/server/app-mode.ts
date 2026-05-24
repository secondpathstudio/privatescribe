/**
 * Deployment-role state for the desktop app (roadmap Phase 9/10 keystone).
 *
 * The same app runs in one of three roles, remembered in a small JSON file
 * under userData:
 *   - standalone — spawns its own local backend (the default desktop app)
 *   - server     — this Mac runs the server daemons; the app is the control
 *                  panel and talks to the local daemon behind Caddi at
 *                  https://127.0.0.1:<lanPort>
 *   - client     — connects to a remote server at serverUrl (Phase 10)
 *
 * In server/client mode the app does NOT spawn a backend; it points API_BASE at
 * the server (HTTPS, self-signed) and trusts that server's certificate via
 * trust-on-first-use pinning (trustServerCert), which is what lets Electron
 * reach a self-signed LAN server it would otherwise reject.
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type AppMode = 'standalone' | 'server' | 'client';

export interface AppModeConfig {
  mode: AppMode;
  /** client mode: the remote server origin (https://host:port). */
  serverUrl?: string;
  /** server mode: the local daemon's HTTPS (Caddy) port. */
  lanPort?: number;
  /** Pinned server-certificate fingerprint (trust-on-first-use). */
  certFingerprint?: string;
}

const DEFAULT_SERVER_PORT = 8443;

function configPath(): string {
  return path.join(app.getPath('userData'), 'app-mode.json');
}

export function readAppMode(): AppModeConfig {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (c && (c.mode === 'server' || c.mode === 'client' || c.mode === 'standalone')) {
      return c as AppModeConfig;
    }
  } catch {
    // No file / unreadable → default standalone.
  }
  return { mode: 'standalone' };
}

export function writeAppMode(config: AppModeConfig): void {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config), 'utf8');
  } catch (err) {
    console.error('[app-mode] failed to persist mode:', err);
  }
}

/** The server origin this app targets (server or client mode), or null when
 *  standalone. Trailing slash stripped so URL comparisons are exact. */
export function serverOrigin(config: AppModeConfig): string | null {
  if (config.mode === 'server') {
    return `https://127.0.0.1:${config.lanPort ?? DEFAULT_SERVER_PORT}`;
  }
  if (config.mode === 'client' && config.serverUrl) {
    return config.serverUrl.replace(/\/+$/, '');
  }
  return null;
}

/**
 * Trust-on-first-use check for the target server's self-signed certificate.
 * The first time we connect we pin the fingerprint; every later connection must
 * present the same one (a mismatch means the cert changed — possible MITM — and
 * is rejected). Returns true to trust the presented cert.
 */
export function trustServerCert(fingerprint: string): boolean {
  const config = readAppMode();
  if (!config.certFingerprint) {
    writeAppMode({ ...config, certFingerprint: fingerprint });
    return true;
  }
  return config.certFingerprint === fingerprint;
}
