/** Ollama controls exposed by the Electron preload (desktop app only). */
export type ElectronOllama = {
  /** Start the bundled runtime; resolves once it answers (or fails). */
  startBundled: () => Promise<{ ok: boolean; error?: string }>;
  /** Remember the user's engine choice without starting anything. */
  setMode: (mode: "bundled" | "system") => Promise<{ ok: boolean }>;
  /** The remembered engine choice, or null if onboarding hasn't chosen. */
  getMode: () => Promise<"bundled" | "system" | null>;
};

declare global {
  interface Window {
    electron?: { apiBase: string; ollama?: ElectronOllama };
  }
}

export const API_BASE: string =
  window.electron?.apiBase ??
  import.meta.env.VITE_API_BASE ??
  'http://127.0.0.1:5000';
