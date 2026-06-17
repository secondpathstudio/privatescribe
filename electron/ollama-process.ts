/**
 * Ollama lifecycle for the packaged desktop app.
 *
 * PrivateScribe fetches the Ollama runtime on demand into the user data dir
 * (see electron/ollama-download.ts and OLLAMA_RUNTIME_FETCH_SPEC.md) — it is no
 * longer bundled in the installer, which kept the Win/Linux installers under
 * GitHub's 2 GiB Release cap. Many users — developers especially — already run
 * Ollama, and starting a second daemon next to theirs wastes resources. So the
 * runtime is *never* fetched or started automatically on a fresh install: the
 * first-run onboarding wizard asks whether the user already has Ollama, and only
 * downloads + starts the built-in runtime if they say they don't (via
 * startBundledOllama(), driven by an IPC call from the renderer).
 *
 * The choice is remembered in a small JSON file under userData (getOllamaMode /
 * setOllamaMode). On every later launch resolveOllama() reads it:
 *
 *   - If something already serves the Ollama API on 127.0.0.1:11434, reuse it
 *     untouched. We never manage a process we did not start.
 *   - Else if mode is "bundled" and the runtime is already staged, start it.
 *     (If it isn't staged yet, boot does not block on the ~1.2 GB download —
 *     onboarding or OllamaGate fetches it on demand.)
 *   - Else (mode "system", or unset on first run) start nothing — onboarding
 *     or OllamaGate will prompt the user.
 *
 * The bundled runtime binds the standard 127.0.0.1:11434, exactly where a
 * system Ollama serves. That means the backend's OLLAMA_HOST is always the
 * same host no matter which engine wins, so the bundled runtime can come up
 * after the backend has already started without any reconfiguration.
 *
 * Ollama is *optional* — the app still edits notes and templates without it,
 * and OllamaGate in the renderer surfaces a "down" state — so nothing here may
 * throw or block startup. A bundled-runtime crash is logged and retried a few
 * times rather than escalated to a dialog.
 *
 * Dev runs (`npm run dev`) never reach resolveOllama(): main.ts resolves Ollama
 * only in the packaged branch. The IPC-driven startBundledOllama() still works
 * in dev (it falls back to the build-resources/ staging dir).
 */
import { spawn, type ChildProcess } from 'child_process';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import {
  ensureOllamaRuntime,
  isOllamaRuntimeStaged,
  type OllamaFetchProgress,
} from './ollama-download';
import { resolveOllamaBinary } from './platform';

/** Which AI engine the user opted into during onboarding. */
export type OllamaMode = 'bundled' | 'system';

// The fixed host the backend always targets as OLLAMA_HOST. A system Ollama
// serves here by default; the bundled runtime is told to bind here too, so the
// backend never has to be reconfigured when the engine changes.
const OLLAMA_HOST = '127.0.0.1:11434';

// Probe budget for "is an Ollama already running here?". A free port refuses
// the connection instantly; this ceiling only bites if something accepts the
// socket but never answers.
const PROBE_TIMEOUT_MS = 1500;

// How long startBundledOllama() waits for the freshly spawned runtime to
// answer before reporting a failure to the caller, and how long the
// fire-and-forget readiness logger keeps polling.
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 500;

// A bundled runtime that exits on its own is restarted, up to this many times
// before we let it stay down.
const MAX_RESTARTS = 3;
const RESTART_DELAY_MS = 1500;

// Rolling tail of the bundled runtime's output, kept for crash diagnostics.
const OUTPUT_TAIL_MAX = 4000;

// Set true once we intentionally stop the runtime (app quitting) so the exit
// handler tells a clean shutdown apart from a crash and skips the restart.
let stopping = false;
let restarts = 0;
let outputTail = '';
// The bundled `ollama serve` child, or null when we never started one.
let bundledProc: ChildProcess | null = null;
// Last spawn()-level failure (missing/non-executable binary). spawn() reports
// these on the 'error' event rather than throwing, so we stash it here for
// startBundledOllama()'s readiness loop to surface.
let lastSpawnError: string | null = null;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Persisted engine choice
// ---------------------------------------------------------------------------

/** Path to the JSON file that remembers the user's onboarding engine choice. */
function configPath(): string {
  return path.join(app.getPath('userData'), 'ollama-config.json');
}

/** The remembered engine mode, or null if onboarding has not chosen one yet. */
export function getOllamaMode(): OllamaMode | null {
  try {
    const mode = JSON.parse(fs.readFileSync(configPath(), 'utf8'))?.mode;
    return mode === 'bundled' || mode === 'system' ? mode : null;
  } catch {
    // No file yet (first run), or unreadable — treat as "not chosen".
    return null;
  }
}

/** Remember the user's engine choice so later launches know what to start. */
export function setOllamaMode(mode: OllamaMode): void {
  try {
    fs.writeFileSync(configPath(), JSON.stringify({ mode }), 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ollama] could not persist engine mode: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------

/** True when an Ollama API server answers at OLLAMA_HOST within the budget. */
async function isOllamaUp(): Promise<boolean> {
  try {
    // /api/version is Ollama-specific: a 200 here proves both that something
    // is listening and that it is actually Ollama — not an unrelated service
    // that happens to hold the port.
    const res = await fetch(`http://${OLLAMA_HOST}/api/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Where the Ollama runtime lives on disk. Packaged: fetched on demand into the
 *  user data dir (it is no longer bundled in Resources — see
 *  OLLAMA_RUNTIME_FETCH_SPEC.md). Dev: the build-resources/ staging dir, so
 *  `npm run build:ollama` pre-stages it and dev never re-downloads. */
function ollamaRuntimeDir(): string {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'ollama-runtime')
    : path.join(__dirname, '..', '..', 'build-resources', 'ollama');
}

/** Absolute path to the `ollama` binary inside the runtime dir. Its location
 * varies per platform (flat on mac, nested on Linux), so resolveOllamaBinary
 * reads the `.ollama-binary` marker the fetch wrote. */
function bundledBinaryPath(): string {
  return resolveOllamaBinary(ollamaRuntimeDir());
}

/**
 * Spawn (or re-spawn) the bundled `ollama serve` bound to OLLAMA_HOST, wiring
 * up crash handling. Reassigns the module-level bundledProc so stopOllama()
 * always sees the live child.
 */
function spawnBundled(): void {
  lastSpawnError = null;
  // OLLAMA_HOST tells `ollama serve` where to bind. OLLAMA_MODELS is left
  // unset on purpose: the runtime then uses the standard ~/.ollama/models, so
  // there is one model store on the machine no matter which Ollama is running.
  const child = spawn(bundledBinaryPath(), ['serve'], {
    env: { ...process.env, OLLAMA_HOST },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bundledProc = child;

  const collect = (chunk: Buffer): void => {
    outputTail = (outputTail + chunk.toString()).slice(-OUTPUT_TAIL_MAX);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  // spawn() failures (missing or non-executable binary) arrive here, not as a
  // throw — without this handler an EPIPE/ENOENT would be an uncaught error.
  child.on('error', (err) => {
    lastSpawnError = err.message;
    console.error(`[ollama] bundled runtime process error: ${err.message}`);
  });

  child.on('exit', (code, signal) => {
    if (stopping) return; // expected — stopOllama() killed it on quit.
    const tail = outputTail.trim().slice(-800);
    console.error(
      '[ollama] bundled runtime exited unexpectedly ' +
        `(code ${code ?? 'null'}, signal ${signal ?? 'none'})` +
        (tail ? `\n[ollama] last output:\n${tail}` : ''),
    );
    if (restarts >= MAX_RESTARTS) {
      console.error(
        `[ollama] not restarting after ${MAX_RESTARTS} attempts — ` +
          'LLM formatting stays unavailable until the app is restarted',
      );
      return;
    }
    restarts += 1;
    console.log(`[ollama] restarting bundled runtime (${restarts}/${MAX_RESTARTS})`);
    setTimeout(() => {
      if (!stopping) spawnBundled();
    }, RESTART_DELAY_MS);
  });
}

/**
 * Poll the bundled runtime until it answers, then log the outcome. Diagnostic
 * only — never awaited, so a slow or dead runtime cannot delay the window.
 */
async function logWhenReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isOllamaUp()) {
      console.log(`[ollama] bundled runtime is serving on ${OLLAMA_HOST}`);
      return;
    }
    await delay(READY_POLL_MS);
  }
  console.warn(
    `[ollama] bundled runtime did not become ready within ${READY_TIMEOUT_MS}ms`,
  );
}

/**
 * Download (if needed) and start the built-in runtime on demand, remembering
 * "bundled" as the engine choice. Driven by an IPC call from the onboarding
 * wizard's "I don't have Ollama" branch, or OllamaGate's escape hatch. The
 * optional onProgress streams the one-time runtime download to the caller's UI.
 *
 * Idempotent: returns ok immediately when Ollama already answers (a system
 * install, or a runtime we started earlier). Otherwise it fetches the runtime if
 * it isn't staged, spawns it, and waits — up to READY_TIMEOUT_MS — for it to
 * answer, so the caller gets a definitive ok/error to drive its UI.
 */
export async function startBundledOllama(
  onProgress?: (p: OllamaFetchProgress) => void,
): Promise<{
  ok: boolean;
  error?: string;
}> {
  setOllamaMode('bundled');

  if (await isOllamaUp()) return { ok: true };

  // The runtime is no longer bundled — fetch it on first use (a no-op once the
  // pinned version is staged), streaming progress to the caller.
  const dir = ollamaRuntimeDir();
  if (!(await isOllamaRuntimeStaged(dir))) {
    const fetched = await ensureOllamaRuntime(dir, onProgress);
    if (!fetched.ok) {
      return { ok: false, error: `The local AI engine could not be downloaded — ${fetched.error}` };
    }
  }

  // Only spawn a fresh child if we don't already have one coming up.
  if (!bundledProc || bundledProc.killed || bundledProc.exitCode !== null) {
    restarts = 0;
    stopping = false;
    console.log('[ollama] starting bundled runtime on demand');
    spawnBundled();
  }

  // Wait for it to answer so the wizard can move on with a real result.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isOllamaUp()) return { ok: true };
    if (lastSpawnError) {
      return {
        ok: false,
        error: `The built-in engine could not start (${lastSpawnError}).`,
      };
    }
    await delay(READY_POLL_MS);
  }
  const tail = outputTail.trim().slice(-400);
  return {
    ok: false,
    error:
      'The built-in engine did not finish starting in time.' +
      (tail ? `\n\n${tail}` : ''),
  };
}

/**
 * Resolve which Ollama the backend should target, and start the bundled
 * runtime if that is the remembered choice. Never throws and never blocks on
 * readiness — safe to await directly in main.ts. Always returns OLLAMA_HOST;
 * the backend targets that host whether or not anything serves it yet.
 */
export async function resolveOllama(): Promise<string> {
  if (await isOllamaUp()) {
    console.log(`[ollama] reusing the Ollama already running on ${OLLAMA_HOST}`);
    return OLLAMA_HOST;
  }

  const mode = getOllamaMode();
  if (mode === 'bundled' && (await isOllamaRuntimeStaged(ollamaRuntimeDir()))) {
    console.log('[ollama] engine mode is "bundled" — starting the staged runtime');
    try {
      restarts = 0;
      stopping = false;
      spawnBundled();
      void logWhenReady();
    } catch (err) {
      // Bundled startup failed outright. The app still runs; OllamaGate shows
      // LLM features as unavailable.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ollama] could not start the bundled runtime: ${msg}`);
    }
  } else {
    // First run (mode unset), the user chose their own Ollama, or "bundled" was
    // chosen but the runtime isn't fetched yet — never block boot on a ~1.2 GB
    // download. Onboarding (first run) or OllamaGate (later) fetches + starts it
    // on demand.
    console.log(
      '[ollama] not starting a runtime at boot — leaving it to onboarding/OllamaGate',
    );
  }
  return OLLAMA_HOST;
}

/**
 * Stop the bundled runtime on app quit. No-op when we never started one — we
 * must never kill an Ollama the user runs themselves.
 */
export function stopOllama(): void {
  stopping = true;
  if (bundledProc && !bundledProc.killed) {
    bundledProc.kill();
  }
}
