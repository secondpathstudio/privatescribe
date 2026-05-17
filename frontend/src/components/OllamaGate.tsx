import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { OLLAMA_DOWN_EVENT } from "@/lib/ollama";
import NeoButton from "@/components/neo/neo-button";

// Fast cadence while we're waiting for recovery — gives the modal/banner
// snappy feedback once the user starts Ollama. Slow cadence when known
// healthy — most sessions stay healthy and there's no reason to hammer.
const POLL_FAST_MS = 3000;
const POLL_SLOW_MS = 60_000;

// Grace window after mount before the gate may surface. The AI engine is
// bundled and started with the app, so a brief "not responding" right after
// launch just means it is still binding its port — not worth a modal. Only an
// outage that outlasts this window is shown.
const STARTUP_GRACE_MS = 10_000;

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

// Surfaces a down AI engine in the Electron shell. PrivateScribe bundles its
// own Ollama runtime and starts it with the app, so this is no longer an
// "install something" prompt — a failed health check means the engine is
// still starting up or has stopped.
// - Engine down past the startup grace window → modal explaining it; the fix
//   is to wait for it to recover or relaunch the app.
// - User dismisses → persistent yellow banner; the rest of the app stays
//   usable (templates, notes, account) — only AI formatting is paused.
// - Polling continues across both states, so the banner/modal auto-vanish
//   once the engine is back.
// Browser-only users (marketing site, plain vite preview) never see this.
export default function OllamaGate() {
  const inElectron =
    typeof window !== "undefined" && !!window.electron;

  const [status, setStatus] = useState<Status>(
    inElectron ? "checking" : "available",
  );
  const [dismissed, setDismissed] = useState(false);
  // Suppresses the gate for the first few seconds after launch so the normal
  // engine-startup window never flashes a modal. Flips true once and stays.
  const [graceElapsed, setGraceElapsed] = useState(false);
  // True while the built-in-engine escape hatch is starting the bundled
  // runtime; carries the failure message if that start didn't take.
  const [startingBundled, setStartingBundled] = useState(false);
  const [bundledError, setBundledError] = useState<string | null>(null);

  const tick = useCallback(async () => {
    const ok = await probe();
    setStatus(ok ? "available" : "unavailable");
  }, []);

  // Escape hatch: start (or restart) PrivateScribe's bundled AI engine. Works
  // both for a user who chose their own Ollama but can't get it running, and
  // to revive a bundled engine that crashed. The health poll picks up success
  // and dismisses the gate on its own.
  const useBundledEngine = useCallback(async () => {
    const ollama = window.electron?.ollama;
    if (!ollama) return;
    setStartingBundled(true);
    setBundledError(null);
    const result = await ollama.startBundled();
    setStartingBundled(false);
    if (result.ok) {
      setStatus("checking");
      tick();
    } else {
      setBundledError(result.error || "The built-in engine couldn't start.");
    }
  }, [tick]);

  // One-shot probe on mount so we don't wait a full slow interval for the
  // first answer.
  useEffect(() => {
    if (!inElectron) return;
    let cancelled = false;
    probe().then((ok) => {
      if (!cancelled) setStatus(ok ? "available" : "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [inElectron]);

  // One-time startup grace timer (see STARTUP_GRACE_MS).
  useEffect(() => {
    if (!inElectron) return;
    const handle = setTimeout(() => setGraceElapsed(true), STARTUP_GRACE_MS);
    return () => clearTimeout(handle);
  }, [inElectron]);

  // Periodic re-check; cadence depends on current health. Re-fires the
  // effect when status flips so the interval adapts.
  useEffect(() => {
    if (!inElectron) return;
    let cancelled = false;
    const intervalMs = status === "available" ? POLL_SLOW_MS : POLL_FAST_MS;
    const handle = setInterval(async () => {
      const ok = await probe();
      if (!cancelled) setStatus(ok ? "available" : "unavailable");
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [inElectron, status]);

  // Re-check when the user returns to the app window. Free signal that
  // covers the "I just installed Ollama, switched back" case without
  // waiting for the next slow tick.
  useEffect(() => {
    if (!inElectron) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [inElectron, tick]);

  // Reactive trigger: any fetch handler that hits a 503 on an Ollama-bound
  // endpoint fires this event via flagOllamaDown() — surface the failure
  // immediately instead of waiting up to POLL_FAST_MS for the next tick.
  useEffect(() => {
    if (!inElectron) return;
    const onDown = () => tick();
    window.addEventListener(OLLAMA_DOWN_EVENT, onDown);
    return () => window.removeEventListener(OLLAMA_DOWN_EVENT, onDown);
  }, [inElectron, tick]);

  // Pad the body when the banner is showing so it doesn't occlude the app's
  // fixed top nav. Cleaned up automatically when status flips or unmounts.
  const showingBanner =
    inElectron && graceElapsed && status === "unavailable" && dismissed;
  useEffect(() => {
    if (!showingBanner) return;
    const prev = document.body.style.paddingTop;
    document.body.style.paddingTop = "40px";
    return () => {
      document.body.style.paddingTop = prev;
    };
  }, [showingBanner]);

  if (!inElectron || status === "available" || !graceElapsed) return null;

  if (dismissed) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-between gap-3 border-b-[3px] border-black bg-yellow-300 px-4 py-2 text-sm font-bold shadow-[0_3px_0_0_#000]">
        <span className="truncate">
          ⚠ The AI engine isn't responding — AI formatting is paused. Notes
          and templates still work.
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
            AI engine unavailable
          </h3>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <p>
            PrivateScribe runs a language model on this device to format your
            transcripts into notes. That engine isn't responding right now.
          </p>
          <div className="border-[2px] border-black bg-yellow-50 p-3">
            <p className="font-bold mb-2">What to do:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>It may still be starting up — give it a few seconds.</li>
              <li>
                If you run your own Ollama, make sure it's started and stays
                running in the background.
              </li>
            </ul>
          </div>
          {window.electron?.ollama && (
            <div className="border-[2px] border-black bg-white p-3">
              <p className="font-bold mb-1">Use the built-in engine</p>
              <p className="mb-2 text-xs text-muted-foreground">
                PrivateScribe can run its own bundled AI engine on this device
                instead — no separate Ollama needed.
              </p>
              {bundledError && (
                <p className="mb-2 whitespace-pre-wrap break-words font-mono text-xs text-red-600">
                  {bundledError}
                </p>
              )}
              <NeoButton
                onClick={useBundledEngine}
                disabled={startingBundled}
                backgroundColor="#000000"
                textColor="#ffffff"
              >
                {startingBundled ? "Starting…" : "Use the built-in engine"}
              </NeoButton>
            </div>
          )}
          <p>
            Transcription and AI formatting are paused until it's back. Your
            notes and templates are unaffected — you can keep working on them.
          </p>
          <p className="text-xs text-muted-foreground">
            {status === "checking" ? "Checking…" : "Re-checking automatically."}
          </p>
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-xs underline text-muted-foreground"
            >
              Continue without it
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
