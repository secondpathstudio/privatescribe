/**
 * Runtime fetch of the Ollama engine — see OLLAMA_RUNTIME_FETCH_SPEC.md.
 *
 * PrivateScribe no longer bundles the Ollama runtime in the installer: bundling
 * it with CUDA pushed the Win/Linux installers past GitHub's 2 GiB Release-asset
 * cap. Instead the engine is fetched once, on demand, into the user data dir
 * (which survives app updates), so installers stay small and app auto-updates
 * don't re-ship ~1.2 GB.
 *
 * This is a runtime port of scripts/fetch-ollama.mjs: same pinned version
 * (electron/ollama-version.ts), same SHA-256 verification against the release's
 * sha256sum.txt, and the same `.ollama-binary` marker that
 * platform.ts:resolveOllamaBinary reads. Extraction avoids any system tool that
 * isn't guaranteed on an end-user box: macOS/Windows use the always-present
 * tar/tar.exe, and Linux's `.tar.zst` is decompressed in-process with fzstd
 * (pure JS), so we never depend on a system `zstd`.
 *
 * No Electron imports — the caller passes the target dir (userData/ollama-runtime
 * for standalone, a staging dir for the server install) and an optional progress
 * callback — so this stays unit-testable. Wiring lives in ollama-process.ts.
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { once } from 'events';
import { createReadStream, createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

import { Decompress } from 'fzstd';

import { resolveOllamaBinary } from './platform';
import { OLLAMA_VERSION } from './ollama-version';

const RELEASE_BASE = `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}`;
const LICENSE_URL = `https://raw.githubusercontent.com/ollama/ollama/v${OLLAMA_VERSION}/LICENSE`;

// Identifies a fully-staged runtime (version + platform/arch). Re-download when
// the marker differs, e.g. after an app update bumps OLLAMA_VERSION.
const STAGED_ID = `${OLLAMA_VERSION} ${process.platform}-${process.arch}`;
const VERSION_MARKER = '.ollama-version';

type ArchiveKind = 'tgz' | 'zst' | 'zip';

export interface OllamaFetchProgress {
  phase: 'download' | 'verify' | 'extract';
  /** Bytes received so far (download phase only). */
  received?: number;
  /** Total bytes, when the server sends Content-Length (download phase only). */
  total?: number;
}

export type FetchResult = { ok: true } | { ok: false; error: string };

/** Resolve the pinned Ollama release asset for the host OS/arch. Mirrors
 *  scripts/fetch-ollama.mjs so the runtime fetch matches the build script. */
function resolveTarget(): { asset: string; kind: ArchiveKind; binary: string } {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  switch (process.platform) {
    case 'darwin':
      return { asset: 'ollama-darwin.tgz', kind: 'tgz', binary: 'ollama' };
    case 'linux':
      return { asset: `ollama-linux-${arch}.tar.zst`, kind: 'zst', binary: 'ollama' };
    case 'win32':
      return { asset: `ollama-windows-${arch}.zip`, kind: 'zip', binary: 'ollama.exe' };
    default:
      throw new Error(`unsupported platform for Ollama: ${process.platform}`);
  }
}

/** True when the pinned runtime is already fully staged in targetDir. Cheap —
 *  just stats the version marker. Callers use this to skip the download. */
export async function isOllamaRuntimeStaged(targetDir: string): Promise<boolean> {
  try {
    const staged = (await fs.readFile(path.join(targetDir, VERSION_MARKER), 'utf8')).trim();
    return staged === STAGED_ID;
  } catch {
    return false;
  }
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed (${res.status} ${res.statusText}): ${url}`);
  return res.text();
}

/** Pull the SHA-256 for `asset` out of the release's sha256sum.txt. Lines look
 *  like: "<hex>  ./ollama-linux-amd64.tar.zst". */
async function expectedSha(asset: string): Promise<string> {
  const text = await fetchText(`${RELEASE_BASE}/sha256sum.txt`);
  for (const line of text.split('\n')) {
    const [hex, name] = line.trim().split(/\s+/);
    if (name && name.replace(/^\.\//, '') === asset) return hex;
  }
  throw new Error(`sha256sum.txt for v${OLLAMA_VERSION} has no entry for ${asset}`);
}

async function download(
  url: string,
  dest: string,
  onProgress?: (p: OllamaFetchProgress) => void,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed (${res.status} ${res.statusText}): ${url}`);
  }
  const total = Number(res.headers.get('content-length')) || undefined;
  let received = 0;
  // Read the web stream directly (no Readable.fromWeb) for byte-accurate
  // progress and to sidestep the DOM-vs-node ReadableStream typing clash.
  const reader = res.body.getReader();
  const out = createWriteStream(dest);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      onProgress?.({ phase: 'download', received, total });
      if (!out.write(Buffer.from(value))) await once(out, 'drain');
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      out.end((err?: Error | null) => (err ? reject(err) : resolve())),
    );
  }
}

const SYSTEM_TAR = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';

/** Stream-decompress a `.zst` file to a `.tar` with fzstd (pure JS), so Linux
 *  extraction needs no system zstd. Streaming + drain backpressure keeps the
 *  ~2 GB of decompressed output off the heap. */
async function zstdToTar(srcZst: string, destTar: string): Promise<void> {
  const out = createWriteStream(destTar);
  let writeErr: Error | null = null;
  out.on('error', (e) => {
    writeErr = e;
  });
  const dctx = new Decompress((chunk) => out.write(Buffer.from(chunk)));
  let prev: Buffer | null = null;
  for await (const chunk of createReadStream(srcZst)) {
    if (writeErr) throw writeErr;
    if (prev) dctx.push(prev, false);
    prev = chunk as Buffer;
    if (out.writableNeedDrain) await once(out, 'drain');
  }
  dctx.push(prev ?? new Uint8Array(0), true); // final chunk flushes fzstd
  await new Promise<void>((resolve, reject) =>
    out.end((err?: Error | null) => (err ? reject(err) : resolve())),
  );
  if (writeErr) throw writeErr;
}

async function extractInto(archive: string, kind: ArchiveKind, outDir: string): Promise<void> {
  if (kind === 'tgz') {
    // macOS: system tar handles gzip. bsdtar is always present.
    execFileSync(SYSTEM_TAR, ['xzf', archive, '-C', outDir], { stdio: 'ignore' });
  } else if (kind === 'zip') {
    // Windows: System32 bsdtar auto-detects zip. (MSYS GNU tar misreads C:\ as
    // host:path, so we call System32 explicitly via SYSTEM_TAR.)
    execFileSync(SYSTEM_TAR, ['-xf', archive, '-C', outDir], { stdio: 'ignore' });
  } else {
    // Linux: .zst → .tar (fzstd, no system zstd) → untar (system tar always present).
    const tarPath = archive.replace(/\.zst$/, '');
    await zstdToTar(archive, tarPath);
    try {
      execFileSync('tar', ['-xf', tarPath, '-C', outDir], { stdio: 'ignore' });
    } finally {
      await fs.rm(tarPath, { force: true });
    }
  }
}

/** Recursively locate `name` under `root` (depth-capped). Ollama's binary nests
 *  differently per archive (flat on macOS, bin/ on Linux), so we find it rather
 *  than assume a layout — and we never move it (libs resolve relative to it). */
async function findBinary(root: string, name: string, depth = 0): Promise<string | null> {
  if (depth > 5) return null;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return p;
    if (entry.isDirectory()) {
      const found = await findBinary(p, name, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Ensure the pinned Ollama runtime is staged in `targetDir`. Idempotent: a no-op
 * when the marker already matches the pin. Otherwise downloads the release asset
 * to a sibling temp file, verifies its SHA-256 (never extracts/execs an
 * unverified binary), extracts into a sibling temp dir, then atomically renames
 * it into place and writes the `.ollama-binary` + `.ollama-version` markers.
 *
 * Never throws — returns {ok:false,error} so the caller can drive UI. Cleans up
 * its temp files on every path (success or failure).
 */
export async function ensureOllamaRuntime(
  targetDir: string,
  onProgress?: (p: OllamaFetchProgress) => void,
): Promise<FetchResult> {
  if (await isOllamaRuntimeStaged(targetDir)) return { ok: true };

  let target;
  try {
    target = resolveTarget();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const parent = path.dirname(targetDir);
  const stamp = `${process.pid}-${Date.now()}`;
  const archivePath = path.join(parent, `.ollama-dl-${stamp}-${target.asset}`);
  const stageDir = path.join(parent, `.ollama-stage-${stamp}`);

  try {
    await fs.mkdir(parent, { recursive: true });

    const wantSha = await expectedSha(target.asset);
    await download(`${RELEASE_BASE}/${target.asset}`, archivePath, onProgress);

    onProgress?.({ phase: 'verify' });
    const got = await sha256(archivePath);
    if (got !== wantSha) {
      throw new Error(
        `checksum mismatch for ${target.asset} — refusing to use it ` +
          `(expected ${wantSha.slice(0, 12)}…, got ${got.slice(0, 12)}…)`,
      );
    }

    onProgress?.({ phase: 'extract' });
    await fs.rm(stageDir, { recursive: true, force: true });
    await fs.mkdir(stageDir, { recursive: true });
    await extractInto(archivePath, target.kind, stageDir);

    const binary = await findBinary(stageDir, target.binary);
    if (!binary) {
      throw new Error(`could not find ${target.binary} in the extracted Ollama archive`);
    }
    await fs.chmod(binary, 0o755); // no-op on Windows, harmless
    // Marker read by platform.ts:resolveOllamaBinary. Forward slashes work on
    // every OS (Node path APIs accept them on Windows).
    const binaryRel = path.relative(stageDir, binary).split(path.sep).join('/');
    await fs.writeFile(path.join(stageDir, '.ollama-binary'), binaryRel + '\n');

    // Ship Ollama's license (MIT) alongside the runtime. Best-effort.
    try {
      await fs.writeFile(path.join(stageDir, 'LICENSE-ollama.txt'), await fetchText(LICENSE_URL));
    } catch {
      /* a network blip on the license must not fail the install */
    }

    await fs.writeFile(path.join(stageDir, VERSION_MARKER), `${STAGED_ID}\n`);

    // Atomic swap into place: same parent dir => rename is atomic on one FS.
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.rename(stageDir, targetDir);

    return { ok: true };
  } catch (err) {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await fs.rm(archivePath, { force: true }).catch(() => {});
  }
}

/** Absolute path to the staged Ollama binary in targetDir (reads the marker
 *  fetch wrote). Convenience for callers that already know it's staged. */
export function stagedOllamaBinary(targetDir: string): string {
  return resolveOllamaBinary(targetDir);
}
