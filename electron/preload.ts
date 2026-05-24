import { contextBridge, ipcRenderer } from 'electron';

function readApiBase(): string {
  const arg = process.argv.find((a) => a.startsWith('--api-base='));
  return arg ? arg.slice('--api-base='.length) : 'http://127.0.0.1:5000';
}

function readMode(): string {
  const arg = process.argv.find((a) => a.startsWith('--mode='));
  return arg ? arg.slice('--mode='.length) : 'standalone';
}

contextBridge.exposeInMainWorld('electron', {
  apiBase: readApiBase(),
  // Deployment role: 'standalone' | 'server' | 'client'. Lets the renderer
  // tailor first-run (e.g. the org-less super-admin setup in server mode).
  mode: readMode(),
  // Ollama controls used by the onboarding wizard and OllamaGate. The bundled
  // runtime is only ever started through startBundled() — never automatically.
  ollama: {
    /** Start the bundled runtime; resolves once it answers (or fails). */
    startBundled: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('ollama:start-bundled'),
    /** Remember the user's engine choice without starting anything. */
    setMode: (mode: 'bundled' | 'system'): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('ollama:set-mode', mode),
    /** The remembered engine choice, or null if onboarding hasn't chosen. */
    getMode: (): Promise<'bundled' | 'system' | null> =>
      ipcRenderer.invoke('ollama:get-mode'),
  },
  // Server-mode controls used by the "Become a server" wizard (Phase 9). These
  // drive the launchd service install/lifecycle (electron/server/*). Present
  // in every build; only invoked from the server-setup flow.
  server: {
    /** Whether the server daemons are already installed. */
    isInstalled: (): Promise<boolean> => ipcRenderer.invoke('server:is-installed'),
    /** Install + start the server daemons (prompts for admin). `lanPort` is
     *  the HTTPS port clients connect to. Resolves once launchctl has loaded. */
    install: (opts: { lanPort?: number }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('server:install', opts),
    /** Stop + remove the server daemons (prompts for admin). */
    uninstall: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('server:uninstall'),
    /** Restart the server daemons (prompts for admin) — e.g. after an update. */
    restart: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('server:restart'),
    /** Relaunch the app into server mode (after install) so it targets the
     *  daemon for first-run admin creation onward. Does not resolve — the app
     *  exits and relaunches. */
    finishSetup: (): Promise<void> => ipcRenderer.invoke('server:finish-setup'),
    /** The pairing info clients need: the LAN URL + port. */
    info: (): Promise<{ lanPort: number; pairingUrl: string } | null> =>
      ipcRenderer.invoke('server:info'),
  },
  // Client-pairing controls for the "Connect to a server" wizard (Phase 10).
  // probe() validates a candidate server is reachable and is a PrivateScribe
  // backend; connect() persists client mode and relaunches into it.
  client: {
    /** Browse the LAN (mDNS) for PrivateScribe servers. Returns those found
     *  within a short window; empty if discovery is blocked. */
    discover: (): Promise<{ name: string; origin: string; host: string }[]> =>
      ipcRenderer.invoke('client:discover'),
    /** Check a candidate server URL. Returns the normalized origin + cert
     *  fingerprint on success, or a user-facing error. Does not change mode. */
    probe: (
      url: string,
    ): Promise<{ ok: boolean; origin?: string; fingerprint?: string; error?: string }> =>
      ipcRenderer.invoke('client:probe', url),
    /** Switch this app into client mode for `url` and relaunch. Does not
     *  resolve — the app exits and reopens pointing at the server. */
    connect: (url: string): Promise<void> => ipcRenderer.invoke('client:connect', url),
  },
});
