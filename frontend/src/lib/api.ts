declare global {
  interface Window {
    electron?: { apiBase: string };
  }
}

export const API_BASE: string =
  window.electron?.apiBase ??
  import.meta.env.VITE_API_BASE ??
  'http://127.0.0.1:5000';
