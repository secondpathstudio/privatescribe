/** Ollama controls exposed by the Electron preload (desktop app only). */
export type ElectronOllama = {
  /** Start the bundled runtime; resolves once it answers (or fails). */
  startBundled: () => Promise<{ ok: boolean; error?: string }>;
  /** Remember the user's engine choice without starting anything. */
  setMode: (mode: "bundled" | "system") => Promise<{ ok: boolean }>;
  /** The remembered engine choice, or null if onboarding hasn't chosen. */
  getMode: () => Promise<"bundled" | "system" | null>;
};

/** Server-mode controls exposed by the Electron preload (desktop app only),
 *  used by the "Become a server" wizard. */
export type ElectronServer = {
  isInstalled: () => Promise<boolean>;
  install: (opts: { lanPort?: number }) => Promise<{ ok: boolean; error?: string }>;
  uninstall: () => Promise<{ ok: boolean; error?: string }>;
  info: () => Promise<{ lanPort: number; pairingUrl: string } | null>;
};

declare global {
  interface Window {
    electron?: { apiBase: string; ollama?: ElectronOllama; server?: ElectronServer };
  }
}

/**
 * localStorage key holding the server URL a client was paired to. Written by
 * the client-mode pairing flow (Phase 10) and the mobile PWA (Phase 11); read
 * back here so a browser/PWA client resolves the right backend. The desktop
 * client also passes it through Electron as `apiBase`, which still wins.
 */
const SERVER_URL_KEY = 'privatescribe.serverUrl';

/** Trim and drop a trailing slash so `${API_BASE}/api/...` never doubles up. */
function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** The paired server URL, or null if this install isn't a client. */
export function getServerUrl(): string | null {
  try {
    const v = localStorage.getItem(SERVER_URL_KEY);
    return v ? normalizeBase(v) : null;
  } catch {
    // localStorage can throw in locked-down/private contexts — treat as unset.
    return null;
  }
}

/** Persist the server URL this client connects to (set during pairing). */
export function setServerUrl(url: string): void {
  localStorage.setItem(SERVER_URL_KEY, normalizeBase(url));
}

/** Forget the paired server (unpair / switch back to standalone). */
export function clearServerUrl(): void {
  localStorage.removeItem(SERVER_URL_KEY);
}

/**
 * The backend base URL, resolved once at load. Precedence:
 *   1. Electron's injected apiBase — authoritative (standalone local port, or
 *      the paired server URL the desktop client passes through).
 *   2. A persisted paired server URL — for a browser/PWA client.
 *   3. VITE_API_BASE — dev/build-time override.
 *   4. Loopback default.
 * Changing the stored URL takes effect on reload, which pairing triggers.
 */
export const API_BASE: string =
  window.electron?.apiBase ??
  getServerUrl() ??
  import.meta.env.VITE_API_BASE ??
  'http://127.0.0.1:5000';
