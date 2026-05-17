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
});
