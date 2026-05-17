/**
 * Ollama lifecycle for the packaged desktop app.
 *
 * PrivateScribe bundles the Ollama runtime (see scripts/fetch-ollama.mjs and
 * extraResources in electron-builder.yml) so a fresh install needs no separate
 * Ollama setup. But many users — developers especially — already run Ollama.
 * Starting a second daemon next to theirs would waste resources and fight over
 * the port, so this module does detect-or-spawn:
 *
 *   - If something already serves the Ollama API on the default
 *     127.0.0.1:11434, reuse it untouched. We never manage a process we did
 *     not start, and never stop the user's own Ollama.
 *   - Otherwise spawn the bundled `ollama serve` on a private free port, so a
 *     user's Ollama starting up later cannot collide with it.
 *
 * Either way the resolved host is handed to the backend as OLLAMA_HOST (see
 * backend-process.ts); the backend's ollama client already reads that env var.
 *
 * Ollama is *optional* — the app still edits notes and templates without it,
 * and OllamaGate in the renderer surfaces a "down" state — so nothing here may
 * throw or block startup. A bundled-runtime crash is logged and retried a few
 * times rather than escalated to a dialog.
 *
 * Dev runs (`npm run dev`) never reach this module: main.ts resolves Ollama
 * only in the packaged branch, and a developer runs their own Ollama just as
 * they run their own `flask run` backend.
 */
import { spawn, type ChildProcess } from 'child_process';
import { createServer, type AddressInfo } from 'net';
import * as path from 'path';

export interface OllamaInfo {
  /** host:port the backend should target as OLLAMA_HOST. */
  host: string;
  /**
   * The bundled `ollama serve` process we spawned, or null when we resolved to
   * a system Ollama. stopOllama() only ever kills a non-null process.
   */
  process: ChildProcess | null;
}

// Ollama's registered default. A system install serves here; the bundled
// runtime deliberately does not, to stay clear of it.
const DEFAULT_OLLAMA_HOST = '127.0.0.1:11434';

// Probe budget for "is an Ollama already running here?". A free port refuses
// the connection instantly; this ceiling only bites if something accepts the
// socket but never answers.
const PROBE_TIMEOUT_MS = 1500;

// How long to keep probing the bundled runtime for a readiness log line.
// Purely diagnostic — readiness is never awaited.
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 500;

// A bundled runtime that exits on its own is restarted on the *same* port (so
// the backend's already-built ollama client stays valid), up to this many
// times before we let it stay down.
const MAX_RESTARTS = 3;
const RESTART_DELAY_MS = 1500;

// Rolling tail of the bundled runtime's output, kept for crash diagnostics.
const OUTPUT_TAIL_MAX = 4000;

// Set true once we intentionally stop the runtime (app quitting) so the exit
// handler tells a clean shutdown apart from a crash and skips the restart.
let stopping = false;
let restarts = 0;
let outputTail = '';

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** True when an Ollama API server answers at `host` within the probe budget. */
async function isOllamaUp(host: string): Promise<boolean> {
  try {
    // /api/version is Ollama-specific: a 200 here proves both that something
    // is listening and that it is actually Ollama — not an unrelated service
    // that happens to hold the port.
    const res = await fetch(`http://${host}/api/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ask the OS for an unused TCP port on the loopback interface. */
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Spawn (or re-spawn) the bundled `ollama serve` bound to info.host, wiring up
 * crash handling. Reassigns info.process so stopOllama() always sees the live
 * child; binaryPath/host are reused verbatim on a restart.
 */
function spawnBundled(info: OllamaInfo, binaryPath: string): void {
  // OLLAMA_HOST tells `ollama serve` where to bind. OLLAMA_MODELS is left
  // unset on purpose: the runtime then uses the standard ~/.ollama/models, so
  // there is one model store on the machine no matter which Ollama is running.
  const child = spawn(binaryPath, ['serve'], {
    env: { ...process.env, OLLAMA_HOST: info.host },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  info.process = child;

  const collect = (chunk: Buffer): void => {
    outputTail = (outputTail + chunk.toString()).slice(-OUTPUT_TAIL_MAX);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  // spawn() failures (missing or non-executable binary) arrive here, not as a
  // throw — without this handler an EPIPE/ENOENT would be an uncaught error.
  child.on('error', (err) => {
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
      if (!stopping) spawnBundled(info, binaryPath);
    }, RESTART_DELAY_MS);
  });
}

/**
 * Poll the bundled runtime until it answers, then log the outcome. Diagnostic
 * only — never awaited, so a slow or dead runtime cannot delay the window.
 */
async function logWhenReady(host: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isOllamaUp(host)) {
      console.log(`[ollama] bundled runtime is serving on ${host}`);
      return;
    }
    await delay(READY_POLL_MS);
  }
  console.warn(
    `[ollama] bundled runtime did not become ready within ${READY_TIMEOUT_MS}ms`,
  );
}

/**
 * Resolve which Ollama the backend should use. Reuses a running system Ollama
 * if one is found, otherwise starts the bundled runtime. Never throws and
 * never blocks on readiness — safe to await directly in main.ts.
 */
export async function resolveOllama(): Promise<OllamaInfo> {
  if (await isOllamaUp(DEFAULT_OLLAMA_HOST)) {
    console.log(`[ollama] reusing the Ollama already running on ${DEFAULT_OLLAMA_HOST}`);
    return { host: DEFAULT_OLLAMA_HOST, process: null };
  }

  try {
    const host = `127.0.0.1:${await pickFreePort()}`;
    // Packaged layout: extraResources puts the runtime under
    // Resources/ollama-runtime/ (see electron-builder.yml).
    const binaryPath = path.join(process.resourcesPath, 'ollama-runtime', 'ollama');
    console.log(`[ollama] no system Ollama found — starting bundled runtime on ${host}`);
    const info: OllamaInfo = { host, process: null };
    spawnBundled(info, binaryPath);
    void logWhenReady(host);
    return info;
  } catch (err) {
    // Bundled startup failed outright. The app still runs; OllamaGate shows
    // LLM features as unavailable.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ollama] could not start the bundled runtime: ${msg}`);
    return { host: DEFAULT_OLLAMA_HOST, process: null };
  }
}

/**
 * Stop the bundled runtime on app quit. No-op when we reused a system Ollama —
 * we must never kill a process we did not start.
 */
export function stopOllama(info: OllamaInfo): void {
  stopping = true;
  if (info.process && !info.process.killed) {
    info.process.kill();
  }
}
