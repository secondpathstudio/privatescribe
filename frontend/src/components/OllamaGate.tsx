import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import NeoButton from "@/components/neo/neo-button";

const POLL_MS = 3000;

type Status = "checking" | "available" | "unavailable";

async function probe(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/ollama/health`);
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({ ok: false }));
    return !!data.ok;
  } catch {
    return false;
  }
}

// Surfaces Ollama-missing state in the Electron shell:
// - First detection → blocking modal with install steps.
// - User dismisses → persistent yellow banner; the rest of the app stays
//   usable (templates, account, etc.) but transcription will fail until
//   Ollama is back.
// - Polling continues across both states, so the banner/modal auto-vanish
//   when Ollama comes back online.
// Browser-only users (marketing site, plain vite preview) never see this.
export default function OllamaGate() {
  const inElectron =
    typeof window !== "undefined" && !!window.electron;

  const [status, setStatus] = useState<Status>(
    inElectron ? "checking" : "available",
  );
  const [dismissed, setDismissed] = useState(false);

  const tick = useCallback(async () => {
    const ok = await probe();
    setStatus(ok ? "available" : "unavailable");
  }, []);

  useEffect(() => {
    if (!inElectron) return;
    let cancelled = false;

    const run = async () => {
      const ok = await probe();
      if (!cancelled) setStatus(ok ? "available" : "unavailable");
    };

    run();
    const handle = setInterval(run, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [inElectron]);

  // Pad the body when the banner is showing so it doesn't occlude the app's
  // fixed top nav. Cleaned up automatically when status flips or unmounts.
  const showingBanner = inElectron && status === "unavailable" && dismissed;
  useEffect(() => {
    if (!showingBanner) return;
    const prev = document.body.style.paddingTop;
    document.body.style.paddingTop = "40px";
    return () => {
      document.body.style.paddingTop = prev;
    };
  }, [showingBanner]);

  if (!inElectron || status === "available") return null;

  if (dismissed) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-between gap-3 border-b-[3px] border-black bg-yellow-300 px-4 py-2 text-sm font-bold shadow-[0_3px_0_0_#000]">
        <span className="truncate">
          ⚠ Ollama not running — transcription is unavailable. Templates and
          notes can still be edited.
        </span>
        <button
          type="button"
          onClick={() => setDismissed(false)}
          className="shrink-0 border-[2px] border-black bg-white px-2 py-0.5 text-xs font-black uppercase shadow-[2px_2px_0_0_#000] hover:bg-yellow-100"
        >
          Show details
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg border-[3px] border-black bg-white shadow-[6px_6px_0_0_#000]">
        <div className="border-b-2 border-black bg-[#fd3777] px-5 py-3">
          <h3 className="font-black uppercase tracking-wide text-white">
            Ollama not detected
          </h3>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <p>
            PrivateScribe runs the language model locally via{" "}
            <strong>Ollama</strong>, which doesn't appear to be running.
          </p>
          <div className="border-[2px] border-black bg-yellow-50 p-3">
            <p className="font-bold mb-2">To get going:</p>
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                Install Ollama from{" "}
                <a
                  href="https://ollama.com/download/mac"
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-semibold"
                >
                  ollama.com/download/mac
                </a>
                .
              </li>
              <li>
                In a terminal, run:
                <pre className="mt-1 bg-black text-white p-2 font-mono text-xs">
                  ollama pull llama3.2
                </pre>
              </li>
              <li>Leave Ollama running in the menu bar.</li>
            </ol>
          </div>
          <p className="text-xs text-muted-foreground">
            {status === "checking"
              ? "Checking..."
              : "Re-checking every few seconds."}
          </p>
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-xs underline text-muted-foreground"
            >
              Continue without Ollama
            </button>
            <NeoButton
              onClick={() => {
                setStatus("checking");
                tick();
              }}
              backgroundColor="#fd3777"
              textColor="#ffffff"
            >
              Retry now
            </NeoButton>
          </div>
        </div>
      </div>
    </div>
  );
}
