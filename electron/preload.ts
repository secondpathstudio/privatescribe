import { contextBridge, ipcRenderer } from 'electron';

function readApiBase(): string {
  const arg = process.argv.find((a) => a.startsWith('--api-base='));
  return arg ? arg.slice('--api-base='.length) : 'http://127.0.0.1:5000';
}

contextBridge.exposeInMainWorld('electron', {
  apiBase: readApiBase(),
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
    /** The pairing info clients need: the LAN URL + port. */
    info: (): Promise<{ lanPort: number; pairingUrl: string } | null> =>
      ipcRenderer.invoke('server:info'),
  },
});
