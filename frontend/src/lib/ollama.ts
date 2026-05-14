export const OLLAMA_DOWN_EVENT = "ollama:down";

// Called by any fetch handler that hit a 503 talking to an Ollama-dependent
// endpoint. OllamaGate listens for this and triggers an immediate health
// recheck so the modal/banner reflects reality without waiting for the
// next poll tick.
export function flagOllamaDown(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OLLAMA_DOWN_EVENT));
  }
}
