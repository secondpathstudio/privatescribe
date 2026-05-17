import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, NotebookPen, TriangleAlert } from "lucide-react";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

// The first-run admin wizard: Welcome → recovery-key intro → recovery-key
// backup → AI model picker → Whisper notice → use-case picker → finish (seed
// templates, mark done).
const TOTAL_STEPS = 6;

type CatalogUseCase = { id: string; label: string; templates: string[] };

type StepProps = {
  onNext: () => void;
  onBack?: () => void;
};

function WelcomeStep({ onNext }: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-black uppercase">Welcome to PrivateScribe</h1>
      <p className="text-sm">
        PrivateScribe turns your recordings into clean, structured notes — and
        it does the whole job on this device. Your audio and your notes never
        leave your computer.
      </p>
      <p className="text-sm">
        This quick setup walks you through backing up your encryption key,
        choosing an AI model, and picking a few templates to start from.
      </p>
      <div className="flex justify-end pt-2">
        <NeoButton onClick={onNext} backgroundColor="#fd3777" textColor="#ffffff">
          Get started
        </NeoButton>
      </div>
    </div>
  );
}

// An intro screen ahead of the recovery-key step. A new, non-technical admin
// has likely never seen a raw encryption key and finds the wall of hex
// alarming — this explains, in plain terms, what it is and what they'll do
// before they're shown the real thing.
function RecoveryKeyIntroStep({ onNext, onBack }: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-black uppercase">What's a recovery key?</h1>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Left: what the key is */}
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            The next step asks you to save your{" "}
            <strong>recovery key</strong> — a long string of letters and
            numbers that looks something like this:
          </p>

          <div className="border-4 border-black bg-gray-100 p-3">
            <pre className="select-none whitespace-pre-wrap break-all font-mono text-sm text-gray-400">
              7f3a9c2e1b8d4f6a0c5e9b2d7a1f8c3e6b4d9a2f0e7c5b1d…
            </pre>
            <p className="mt-1 text-xs font-black uppercase tracking-wider text-gray-500">
              Example only — not your real key
            </p>
          </div>

          <p className="text-sm">
            Never seen anything like that? That's completely normal, and you
            don't need to understand it. Think of it as the{" "}
            <strong>spare key to your house</strong> — you don't study how
            it's cut, you just keep it somewhere safe in case you're ever
            locked out.
          </p>
          <p className="text-sm">
            PrivateScribe keeps all of your notes on this device and
            encrypted. This key is the one thing that can unlock them if you
            move to a new computer or restore from a backup. No one else — not
            even us — has a copy, so it's worth keeping, but it isn't
            something to worry about day to day.
          </p>
        </div>

        {/* Right: where to keep it */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-black uppercase tracking-wider">
            Where to keep it
          </p>
          <div className="flex items-start gap-3 border-4 border-black bg-white p-3">
            <KeyRound className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">
              <strong>In a password manager</strong> — apps like 1Password,
              Bitwarden, or your built-in iCloud Keychain. Best choice if you
              already use one.
            </p>
          </div>
          <div className="flex items-start gap-3 border-4 border-black bg-white p-3">
            <NotebookPen className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">
              <strong>Written on paper</strong> — kept somewhere physically
              safe, like with your passport or other important documents.
            </p>
          </div>
          <div className="flex items-start gap-3 border-4 border-black bg-red-100 p-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm">
              <strong>Avoid:</strong> a plain email to yourself, or an
              unprotected file on your desktop.
            </p>
          </div>

          <div className="mt-2 border-4 border-black bg-yellow-100 p-4 text-sm">
            <p className="font-black uppercase tracking-wide">
              On the next screen
            </p>
            <p className="mt-1">
              You'll reveal your key and save a copy in one of the places
              above. That's the whole job.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <NeoButton onClick={onBack}>Back</NeoButton>
        <NeoButton onClick={onNext} backgroundColor="#fd3777" textColor="#ffffff">
          Got it — show me the key
        </NeoButton>
      </div>
    </div>
  );
}

function RecoveryKeyStep({ onNext, onBack }: StepProps) {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null until the admin re-authenticates and the key is revealed.
  const [backupKey, setBackupKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [acking, setAcking] = useState(false);

  const reveal = async () => {
    if (!password || revealing) return;
    setRevealing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/backup-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not reveal the key (status ${res.status}).`);
        return;
      }
      setBackupKey(data.backup_key);
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setRevealing(false);
    }
  };

  const copy = async () => {
    if (!backupKey) return;
    try {
      await navigator.clipboard.writeText(backupKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the user can still select the key by hand.
    }
  };

  // Acknowledge clears the persistent "back up your key" obligation. A failed
  // call is non-fatal: the pending-backup banner stays on as the safety net.
  const acknowledgeAndContinue = async () => {
    setAcking(true);
    try {
      await fetch(`${API_BASE}/api/acknowledge-backup-key`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
      });
    } catch {
      // ignore — see above
    }
    setAcking(false);
    onNext();
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-black uppercase">Back up your recovery key</h1>
      <p className="text-sm">
        Your database is encrypted with a recovery key — it is the only thing
        that can decrypt your data. If it is ever lost, your notes cannot be
        recovered. Save it somewhere durable: a password manager or an
        encrypted backup.
      </p>

      {backupKey === null ? (
        <>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="recovery-key-password"
              className="text-xs font-black uppercase tracking-wider"
            >
              Confirm your password to view the key
            </label>
            <div className="relative">
              <input
                id="recovery-key-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") reveal(); }}
                className="w-full border-4 border-black bg-white p-3 pr-12 font-bold text-black focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-black transition-colors hover:text-[#fd3777]"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm font-bold text-red-600">{error}</p>
          )}
          <div className="flex items-center justify-between pt-2">
            <NeoButton onClick={onBack} disabled={revealing}>
              Back
            </NeoButton>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onNext}
                className="text-xs font-bold uppercase tracking-wider underline"
              >
                Skip for now
              </button>
              <NeoButton
                onClick={reveal}
                disabled={!password || revealing}
                backgroundColor="#fd3777"
                textColor="#ffffff"
              >
                {revealing ? "Revealing…" : "Reveal recovery key"}
              </NeoButton>
            </div>
          </div>
        </>
      ) : (
        <>
          <pre className="select-all whitespace-pre-wrap break-all border-4 border-black bg-gray-100 p-3 font-mono text-sm text-black">
            {backupKey}
          </pre>
          <p className="text-sm font-bold">
            Save this key somewhere safe before continuing. You can view it
            again later from Admin → Encryption.
          </p>
          <div className="flex items-center justify-between pt-2">
            <NeoButton onClick={copy}>{copied ? "Copied!" : "Copy key"}</NeoButton>
            <NeoButton
              onClick={acknowledgeAndContinue}
              disabled={acking}
              backgroundColor="#fd3777"
              textColor="#ffffff"
            >
              {acking ? "Saving…" : "I've saved it — continue"}
            </NeoButton>
          </div>
        </>
      )}
    </div>
  );
}

// The curated models the first-run picker offers. Each `tag` is exactly what
// gets passed to `ollama pull` and stored as the app-wide default model — so
// the picked model is both downloaded and used to fill templates. Sizes are
// approximate; the real byte counts come from the pull progress stream.
type PickerModel = {
  tag: string;
  label: string;
  params: string;
  approxGb: number;
  blurb: string;
  recommended?: boolean;
};

const PICKER_MODELS: PickerModel[] = [
  {
    tag: "gemma3:4b",
    label: "Gemma 3",
    params: "4B",
    approxGb: 3.3,
    blurb: "Google's compact model — careful, tidy output.",
    recommended: true,
  },
  {
    tag: "llama3.2",
    label: "Llama 3.2",
    params: "3B",
    approxGb: 2.0,
    blurb: "Fast and well-rounded — the smallest download here.",
  },
  {
    tag: "qwen3:4b",
    label: "Qwen 3",
    params: "4B",
    approxGb: 2.5,
    blurb: "Strong instruction-following — a capable all-rounder.",
  },
  {
    tag: "phi4-mini",
    label: "Phi-4 Mini",
    params: "3.8B",
    approxGb: 2.5,
    blurb: "Microsoft's compact model — efficient, with solid reasoning.",
  },
  {
    tag: "mistral",
    label: "Mistral",
    params: "7B",
    approxGb: 4.1,
    blurb: "A proven 7B model — the most capable here, and the largest.",
  },
];

// Ollama reports installed models tagged ("llama3.2:latest"); a bare tag like
// "llama3.2" means ":latest". Normalize both sides before comparing.
const normalizeTag = (tag: string): string =>
  tag.includes(":") ? tag : `${tag}:latest`;

// One progress line from the /api/ollama/pull NDJSON stream.
type ModelPullProgress = {
  status?: string;
  total?: number;
  completed?: number;
  error?: string;
  done?: boolean;
};

function formatGb(bytes?: number): string {
  if (!bytes) return "0.0 GB";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

type ModelPickerStepProps = StepProps & {
  selected: string;
  onSelect: (tag: string) => void;
};

type PickerPhase = "loading" | "ready" | "down";

// When the engine is down we don't assume the user has Ollama, and we never
// start the bundled runtime behind their back. Instead we ask: "ask" presents
// the yes/no question, "have-it" waits for an existing user to start their own
// Ollama, "bundled" starts PrivateScribe's built-in engine on demand.
type DownStep = "ask" | "have-it" | "bundled";

// Progress of the on-demand bundled-engine launch within the "bundled" step.
type BundledState = "starting" | "failed";

// Step 4 of the wizard: get a local AI engine running, then pick the language
// model. The chosen model is downloaded here (streamed `ollama pull` with a
// progress bar) and reported up so the wizard can persist it as the app-wide
// default. When the engine is down we ask whether the user already has Ollama:
// if so, we wait for them to start it; if not, we start PrivateScribe's
// bundled runtime on demand — never automatically, so a user who already runs
// Ollama is never saddled with a second engine.
function ModelPickerStep({ selected, onSelect, onNext, onBack }: ModelPickerStepProps) {
  const auth = useAuth();
  const [phase, setPhase] = useState<PickerPhase>("loading");
  // Which "engine down" screen to show. Only meaningful while phase === "down".
  const [downStep, setDownStep] = useState<DownStep>("ask");
  // Progress of the bundled-engine launch. Only meaningful in the "bundled"
  // down-step.
  const [bundledState, setBundledState] = useState<BundledState>("starting");
  const [bundledError, setBundledError] = useState<string | null>(null);
  // Normalized tags of models already present in Ollama.
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState<ModelPullProgress | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The Electron-only Ollama bridge. Undefined in a plain browser, where there
  // is no bundled runtime to start.
  const ollamaApi =
    typeof window !== "undefined" ? window.electron?.ollama : undefined;

  // Probe the engine and load the installed-model list. Returns whether the
  // engine answered; on success it flips the phase to "ready". It never sets
  // phase to "loading" or "down" itself, so it can double as a no-flicker
  // auto-poll while we wait for an engine to come up.
  const refreshModels = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/ollama/models`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) return false;
      const data = await res.json();
      const models: { name: string }[] = data.models || [];
      setInstalled(new Set(models.map((m) => normalizeTag(m.name))));
      setPhase("ready");
      return true;
    } catch {
      return false;
    }
  }, [auth.token]);

  // First probe on mount: engine up → "ready", otherwise → "down" so we can
  // ask the user how they want to proceed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await refreshModels();
      if (!cancelled && !ok) setPhase("down");
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshModels]);

  // While waiting for an engine — the user's own Ollama, or the bundled one —
  // poll until it answers; refreshModels() then flips the phase to "ready".
  useEffect(() => {
    if (phase !== "down") return;
    const waiting =
      downStep === "have-it" ||
      (downStep === "bundled" && bundledState === "starting");
    if (!waiting) return;
    const id = setInterval(() => {
      void refreshModels();
    }, 2500);
    return () => clearInterval(id);
  }, [phase, downStep, bundledState, refreshModels]);

  // Abort an in-flight pull if the user leaves the step. Ollama resumes a
  // partial download on the next pull, so this costs nothing.
  useEffect(() => () => abortRef.current?.abort(), []);

  // "Yes, I have Ollama" — remember the choice and wait for the user to start
  // their own Ollama; the poll above advances to the picker once it answers.
  const chooseSystem = () => {
    void ollamaApi?.setMode("system");
    setDownStep("have-it");
  };

  // "No, I don't have Ollama" / the escape hatch — start PrivateScribe's
  // bundled engine on demand. The IPC call resolves once the runtime answers
  // (or fails), so we get a definitive result to drive the UI.
  const startBundledEngine = useCallback(async () => {
    setDownStep("bundled");
    setBundledState("starting");
    setBundledError(null);
    if (!ollamaApi) {
      // Plain browser build: there is no bundled runtime to start. Fall back
      // to walking the user through a manual Ollama install.
      setBundledState("failed");
      return;
    }
    const result = await ollamaApi.startBundled();
    if (result.ok) {
      // Confirm through the backend, then drop into the model picker.
      if (!(await refreshModels())) {
        setBundledState("failed");
        setBundledError("The engine started but isn't responding yet.");
      }
    } else {
      setBundledState("failed");
      setBundledError(result.error || "The built-in engine couldn't start.");
    }
  }, [ollamaApi, refreshModels]);

  const selectedIsInstalled = installed.has(normalizeTag(selected));
  const selectedModel =
    PICKER_MODELS.find((m) => m.tag === selected) ?? PICKER_MODELS[0];

  // Stream `ollama pull` for the selected model, painting a progress bar from
  // the NDJSON events. On success the model is marked installed locally.
  const downloadSelected = async () => {
    setPulling(true);
    setProgress({ status: "starting" });
    setPullError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`${API_BASE}/api/ollama/pull`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ model: selected }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Download failed (status ${res.status}).`);
      }
      // NDJSON: one JSON object per line; the final line carries done:true,
      // with `error` set on failure.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalEvent: ModelPullProgress | null = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt: ModelPullProgress = JSON.parse(line);
            setProgress(evt);
            if (evt.done) finalEvent = evt;
          } catch {
            // ignore a malformed line
          }
        }
      }
      if (finalEvent?.error) {
        setPullError(finalEvent.error);
      } else {
        setInstalled((prev) => new Set(prev).add(normalizeTag(selected)));
      }
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") {
        setPullError(e.message || "Download failed.");
      }
    } finally {
      setPulling(false);
      abortRef.current = null;
    }
  };

  const percent =
    progress?.total && progress?.completed
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-black uppercase">Choose your AI model</h1>
      <p className="text-sm">
        PrivateScribe runs a language model on this device to turn transcripts
        into formatted notes. Pick one to download — you can add or switch
        models later from Admin → Models.
      </p>

      {phase === "loading" && (
        <p className="text-sm text-muted-foreground">Checking the AI engine…</p>
      )}

      {phase === "down" && downStep === "ask" && (
        <div className="flex flex-col gap-3">
          <div className="border-4 border-black bg-yellow-100 p-4 text-sm">
            <p className="font-bold">The local AI engine isn't running yet.</p>
            <p className="mt-1">
              PrivateScribe needs a local AI engine — Ollama — to turn
              transcripts into formatted notes. It ships with its own built-in
              copy, but if you already run Ollama yourself we'll use that one
              instead. Do you already have Ollama installed?
            </p>
          </div>
          <button
            type="button"
            onClick={chooseSystem}
            className="border-4 border-black bg-white p-4 text-left text-black transition-colors hover:bg-gray-100"
          >
            <div className="font-black uppercase tracking-wide">
              Yes, I already have Ollama
            </div>
            <div className="mt-1 text-xs">
              Use my existing Ollama — I just need to start it.
            </div>
          </button>
          <button
            type="button"
            onClick={() => void startBundledEngine()}
            className="border-4 border-black bg-white p-4 text-left text-black transition-colors hover:bg-gray-100"
          >
            <div className="font-black uppercase tracking-wide">
              No — use the built-in engine
            </div>
            <div className="mt-1 text-xs">
              Start PrivateScribe's own AI engine. Nothing else to install.
            </div>
          </button>
        </div>
      )}

      {phase === "down" && downStep === "have-it" && (
        <div className="flex flex-col gap-2 border-4 border-black bg-yellow-100 p-4 text-sm">
          <p className="font-black uppercase tracking-wide">Start Ollama</p>
          <p>
            Open the Ollama app from your Applications (or run{" "}
            <code className="border border-black bg-white px-1 font-mono">
              ollama serve
            </code>{" "}
            in a terminal).
          </p>
          <p>
            <strong>
              Ollama needs to stay running in the background
            </strong>{" "}
            whenever you use PrivateScribe — if you quit it, AI formatting will
            stop working.
          </p>
          <p>
            PrivateScribe is watching for it — this page continues on its own
            as soon as Ollama is up.
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <button
              type="button"
              onClick={() => setDownStep("ask")}
              className="text-xs font-bold uppercase tracking-wider underline"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => void startBundledEngine()}
              className="text-xs font-bold uppercase tracking-wider underline"
            >
              Use the built-in engine instead
            </button>
          </div>
        </div>
      )}

      {phase === "down" &&
        downStep === "bundled" &&
        bundledState === "starting" && (
          <div className="flex flex-col gap-2 border-4 border-black bg-yellow-100 p-4 text-sm">
            <p className="animate-pulse font-black uppercase tracking-wide">
              Starting the built-in AI engine…
            </p>
            <p>
              PrivateScribe is starting its own local AI engine. The first
              launch can take a moment — this page continues on its own once
              it's ready.
            </p>
          </div>
        )}

      {phase === "down" &&
        downStep === "bundled" &&
        bundledState === "failed" &&
        ollamaApi && (
          <div className="flex flex-col gap-2 border-4 border-black bg-red-100 p-4 text-sm">
            <p className="font-black uppercase tracking-wide">
              The built-in engine didn't start
            </p>
            {bundledError && (
              <p className="whitespace-pre-wrap break-words font-mono text-xs">
                {bundledError}
              </p>
            )}
            <p>You can try again, or start your own Ollama instead.</p>
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <button
                type="button"
                onClick={() => void startBundledEngine()}
                className="text-xs font-bold uppercase tracking-wider underline"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => setDownStep("ask")}
                className="text-xs font-bold uppercase tracking-wider underline"
              >
                ← Back
              </button>
            </div>
          </div>
        )}

      {/* Plain browser build — no bundled runtime; walk a manual install. */}
      {phase === "down" &&
        downStep === "bundled" &&
        bundledState === "failed" &&
        !ollamaApi && (
          <div className="flex flex-col gap-2 border-4 border-black bg-yellow-100 p-4 text-sm">
            <p className="font-black uppercase tracking-wide">Install Ollama</p>
            <ol className="ml-5 list-decimal space-y-1">
              <li>
                Go to{" "}
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold underline"
                >
                  ollama.com/download
                </a>{" "}
                and download Ollama for your system.
              </li>
              <li>Open the downloaded file and follow the installer.</li>
              <li>
                Launch Ollama. It runs quietly in the background — keep it
                running whenever you use PrivateScribe.
              </li>
              <li>
                Come back here and click <strong>Re-check</strong>.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setDownStep("ask")}
              className="self-start pt-1 text-xs font-bold uppercase tracking-wider underline"
            >
              ← Back
            </button>
          </div>
        )}

      {phase === "ready" && (
        <div className="flex flex-col gap-3">
          {PICKER_MODELS.map((m) => {
            const on = m.tag === selected;
            const have = installed.has(normalizeTag(m.tag));
            return (
              <button
                key={m.tag}
                type="button"
                aria-pressed={on}
                disabled={pulling}
                onClick={() => onSelect(m.tag)}
                className={
                  "border-4 border-black p-4 text-left transition-colors disabled:opacity-60 " +
                  (on ? "bg-[#fd3777] text-white" : "bg-white text-black")
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-black uppercase tracking-wide">
                    {m.label} <span className="text-xs font-bold">{m.params}</span>
                  </span>
                  <span className="shrink-0 text-xs font-black uppercase tracking-wider">
                    {have ? "✓ Installed" : `~${m.approxGb.toFixed(1)} GB`}
                  </span>
                </div>
                <div className="mt-1 text-xs">
                  {m.recommended && (
                    <span className="font-black uppercase">Recommended · </span>
                  )}
                  {m.blurb}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {pullError && (
        <p role="alert" className="text-sm font-bold text-red-600">
          {pullError}
        </p>
      )}

      {pulling && progress && (
        <div className="space-y-1 border-4 border-black bg-yellow-50 p-3 text-sm">
          <div className="font-bold">{progress.status || "Downloading…"}</div>
          {percent !== null && (
            <>
              <div className="h-3 border-2 border-black">
                <div
                  className="h-full bg-[#fd3777]"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {formatGb(progress.completed)} / {formatGb(progress.total)} ({percent}%)
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <NeoButton onClick={onBack} disabled={pulling}>
          Back
        </NeoButton>
        {phase === "down" ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onNext}
              className="text-xs font-bold uppercase tracking-wider underline"
            >
              Continue anyway
            </button>
            <NeoButton
              onClick={() => void refreshModels()}
              backgroundColor="#fd3777"
              textColor="#ffffff"
            >
              Re-check
            </NeoButton>
          </div>
        ) : pulling ? (
          <NeoButton onClick={() => abortRef.current?.abort()}>
            Cancel download
          </NeoButton>
        ) : selectedIsInstalled ? (
          <NeoButton onClick={onNext} backgroundColor="#fd3777" textColor="#ffffff">
            Next
          </NeoButton>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onNext}
              className="text-xs font-bold uppercase tracking-wider underline"
            >
              Skip for now
            </button>
            <NeoButton
              onClick={downloadSelected}
              disabled={phase !== "ready"}
              backgroundColor="#fd3777"
              textColor="#ffffff"
            >
              Download {selectedModel.label} (~{selectedModel.approxGb.toFixed(1)} GB)
            </NeoButton>
          </div>
        )}
      </div>
    </div>
  );
}

function WhisperNoticeStep({ onNext, onBack }: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-black uppercase">Transcription</h1>
      <p className="text-sm">
        PrivateScribe transcribes your recordings with Whisper, running locally
        on this device. It's set to a sensible default model that works well
        for most recordings.
      </p>
      <p className="text-sm">
        If you want a faster or more accurate model later, you can change it
        anytime in Admin → Transcription. Nothing to do here for now.
      </p>
      <div className="flex items-center justify-between pt-2">
        <NeoButton onClick={onBack}>Back</NeoButton>
        <NeoButton onClick={onNext} backgroundColor="#fd3777" textColor="#ffffff">
          Next
        </NeoButton>
      </div>
    </div>
  );
}

type UseCaseStepProps = StepProps & {
  selected: string[];
  onToggle: (id: string) => void;
  finishing: boolean;
};

function UseCaseStep({ selected, onToggle, onNext, onBack, finishing }: UseCaseStepProps) {
  const auth = useAuth();
  // null = catalog not loaded yet.
  const [catalog, setCatalog] = useState<CatalogUseCase[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/onboarding/catalog`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setCatalog(d.useCases ?? []); })
      .catch(() => { if (!cancelled) setCatalog([]); });
    return () => { cancelled = true; };
  }, [auth.token]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-black uppercase">What will you use it for?</h1>
      <p className="text-sm">
        Pick any that apply — we'll add a few starter templates for each. You
        can edit, add, or remove templates anytime from the Templates page.
      </p>

      {catalog === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {catalog.map((useCase) => {
            const on = selected.includes(useCase.id);
            return (
              <button
                key={useCase.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(useCase.id)}
                className={
                  "border-4 border-black p-4 text-left transition-colors " +
                  (on ? "bg-[#fd3777] text-white" : "bg-white text-black")
                }
              >
                <div className="font-black uppercase tracking-wide">{useCase.label}</div>
                <div className="mt-1 text-xs">{useCase.templates.join(" · ")}</div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex justify-between pt-2">
        <NeoButton onClick={onBack} disabled={finishing}>
          Back
        </NeoButton>
        <NeoButton
          onClick={onNext}
          disabled={finishing}
          backgroundColor="#fd3777"
          textColor="#ffffff"
        >
          {finishing ? "Finishing…" : selected.length > 0 ? "Finish setup" : "Skip for now"}
        </NeoButton>
      </div>
    </div>
  );
}

export default function OnboardingWizard() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [useCases, setUseCases] = useState<string[]>([]);
  // The model chosen in the picker step — sent to /complete as the app-wide
  // default. Pre-set to the recommended model so a skipped picker still sends
  // a sensible value.
  const [defaultModel, setDefaultModel] = useState("gemma3:4b");
  const [finishing, setFinishing] = useState(false);
  // null = onboarding status not yet known.
  const [completed, setCompleted] = useState<boolean | null>(null);

  // Don't let an admin who already finished onboarding re-run the wizard.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/onboarding/status`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setCompleted(!!d.completed); })
      // Probe failed — let them through the wizard rather than blocking it.
      .catch(() => { if (!cancelled) setCompleted(false); });
    return () => { cancelled = true; };
  }, [auth.token]);

  const toggleUseCase = (id: string) => {
    setUseCases((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // Seed the picked starter templates and mark onboarding complete, then drop
  // the admin into a fresh note. A failed call is non-fatal — we still let
  // them into the app rather than trapping them in the wizard.
  const finish = async () => {
    setFinishing(true);
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ useCases, defaultModel }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch {
      toast.error(
        "Setup didn't fully finish — you can add templates anytime from the Templates page.",
      );
    }
    navigate("/notes/new", { replace: true });
  };

  const next = () => {
    if (step < TOTAL_STEPS - 1) setStep(step + 1);
    else finish();
  };

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  if (completed === null) return null; // brief blank during the one-roundtrip probe
  if (completed) return <Navigate to="/notes" replace />;

  return (
    <div className="min-h-screen flex justify-center items-start px-4 py-10">
      <div
        className={`w-full border-4 border-black bg-white p-8 shadow-[8px_8px_0px_0px_#000000] ${
          step === 1 ? "max-w-3xl" : "max-w-xl"
        }`}
      >
        {step === 0 && <WelcomeStep onNext={next} />}
        {step === 1 && <RecoveryKeyIntroStep onNext={next} onBack={back} />}
        {step === 2 && <RecoveryKeyStep onNext={next} onBack={back} />}
        {step === 3 && (
          <ModelPickerStep
            selected={defaultModel}
            onSelect={setDefaultModel}
            onNext={next}
            onBack={back}
          />
        )}
        {step === 4 && <WhisperNoticeStep onNext={next} onBack={back} />}
        {step === 5 && (
          <UseCaseStep
            selected={useCases}
            onToggle={toggleUseCase}
            onNext={next}
            onBack={back}
            finishing={finishing}
          />
        )}
      </div>
    </div>
  );
}
