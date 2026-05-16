import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { toast } from "sonner";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import NeoButton from "@/components/neo/neo-button";

// The first-run admin wizard: Welcome → recovery-key backup → Ollama check →
// Whisper notice → use-case picker → finish (seed templates, mark done).
const TOTAL_STEPS = 5;

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
        checking that the AI engine is ready, and picking a few templates to
        start from.
      </p>
      <div className="flex justify-end pt-2">
        <NeoButton onClick={onNext} backgroundColor="#fd3777" textColor="#ffffff">
          Get started
        </NeoButton>
      </div>
    </div>
  );
}

function RecoveryKeyStep({ onNext, onBack }: StepProps) {
  const auth = useAuth();
  const [password, setPassword] = useState("");
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
            <input
              id="recovery-key-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") reveal(); }}
              className="w-full border-4 border-black bg-white p-3 font-bold text-black focus:outline-none"
            />
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

type OllamaState = "checking" | "ready" | "no-model" | "down";

function OllamaCheckStep({ onNext, onBack }: StepProps) {
  const auth = useAuth();
  const [state, setState] = useState<OllamaState>("checking");
  const [defaultModel, setDefaultModel] = useState("llama3.2");

  // Probe Ollama: a 503/network failure means the daemon is down; otherwise
  // check the default model is among the installed ones (tag-tolerant, so
  // "llama3.2" matches "llama3.2:latest").
  const check = useCallback(async () => {
    setState("checking");
    try {
      const res = await fetch(`${API_BASE}/api/ollama/models`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) {
        setState("down");
        return;
      }
      const data = await res.json();
      const def: string = data.default || "llama3.2";
      setDefaultModel(def);
      const stripTag = (name: string) => name.split(":")[0];
      const models: { name: string }[] = data.models || [];
      const hasDefault = models.some((m) => stripTag(m.name) === stripTag(def));
      setState(hasDefault ? "ready" : "no-model");
    } catch {
      setState("down");
    }
  }, [auth.token]);

  useEffect(() => { check(); }, [check]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-black uppercase">Check the AI engine</h1>
      <p className="text-sm">
        PrivateScribe uses Ollama to run a language model locally — it's what
        turns your raw transcript into a formatted note.
      </p>

      {state === "checking" && (
        <p className="text-sm text-muted-foreground">Checking…</p>
      )}

      {state === "ready" && (
        <div className="border-4 border-black bg-green-100 p-4 text-sm font-bold">
          ✓ Ollama is running and the {defaultModel} model is installed —
          you're all set.
        </div>
      )}

      {state === "down" && (
        <div className="border-4 border-black bg-yellow-100 p-4 text-sm">
          <p className="mb-2 font-bold">Ollama doesn't appear to be running.</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Install Ollama from{" "}
              <a
                href="https://ollama.com/download/mac"
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline"
              >
                ollama.com/download/mac
              </a>
              .
            </li>
            <li>
              In a terminal, run:
              <pre className="mt-1 bg-black p-2 font-mono text-xs text-white">
                ollama pull {defaultModel}
              </pre>
            </li>
            <li>Leave Ollama running, then re-check.</li>
          </ol>
        </div>
      )}

      {state === "no-model" && (
        <div className="border-4 border-black bg-yellow-100 p-4 text-sm">
          <p className="mb-2 font-bold">
            Ollama is running, but the {defaultModel} model isn't installed yet.
          </p>
          <p className="mb-1">In a terminal, run:</p>
          <pre className="bg-black p-2 font-mono text-xs text-white">
            ollama pull {defaultModel}
          </pre>
          <p className="mt-2">Then re-check below.</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <NeoButton onClick={onBack}>Back</NeoButton>
        {state === "ready" ? (
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
              Continue anyway
            </button>
            <NeoButton
              onClick={check}
              disabled={state === "checking"}
              backgroundColor="#fd3777"
              textColor="#ffffff"
            >
              {state === "checking" ? "Checking…" : "Re-check"}
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
        body: JSON.stringify({ useCases }),
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
      <div className="w-full max-w-xl border-4 border-black bg-white p-8 shadow-[8px_8px_0px_0px_#000000]">
        {step === 0 && <WelcomeStep onNext={next} />}
        {step === 1 && <RecoveryKeyStep onNext={next} onBack={back} />}
        {step === 2 && <OllamaCheckStep onNext={next} onBack={back} />}
        {step === 3 && <WhisperNoticeStep onNext={next} onBack={back} />}
        {step === 4 && (
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
