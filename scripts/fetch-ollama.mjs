#!/usr/bin/env node
/**
 * Vendors the Ollama runtime into build-resources/ollama/ for the desktop build.
 *
 * PrivateScribe bundles Ollama so a fresh install needs no separate Ollama
 * setup. This script downloads Ollama's official headless runtime for the host
 * OS/arch (the CLI/server runtime, not the menu-bar GUI app), verifies it
 * against the SHA256 the release publishes, and extracts it. electron-builder
 * then copies build-resources/ollama/ into the app bundle as
 * Resources/ollama-runtime/ (see extraResources in electron-builder.yml), and
 * Electron spawns Resources/ollama-runtime/ollama[.exe] when no system Ollama
 * is already running.
 *
 * Per-platform release assets (the runtime is staged verbatim, GPU backends
 * included, so the app runs on CPU and/or GPU):
 *   - macOS:   ollama-darwin.tgz            (universal)        → tar xzf
 *   - Linux:   ollama-linux-{amd64,arm64}.tar.zst (needs zstd) → tar --zstd -xf
 *   - Windows: ollama-windows-{amd64,arm64}.zip                → tar -xf (bsdtar)
 *
 * Archive layouts vary: macOS extracts the binary flat at root, Linux nests it
 * under bin/ (with libs under lib/ollama/), Windows is its own thing. Rather
 * than hardcode each layout, this script locates the binary post-extraction
 * and writes its relative path to a `.ollama-binary` marker; Electron reads
 * that marker to spawn the runtime. Ollama still finds its libs via its real
 * on-disk location, so we never relocate the binary.
 *
 * Each archive extracts on its own native runner in the CI matrix, where the
 * matching extraction tool exists (zstd on Linux, bsdtar/tar.exe on Windows).
 *
 * Usage:
 *   node scripts/fetch-ollama.mjs           # stage the runtime for this OS
 *   node scripts/fetch-ollama.mjs --force   # re-download and re-stage
 *   OLLAMA_VERSION=0.x.y node scripts/fetch-ollama.mjs   # pin another version
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

// The pin lives in electron/ollama-version.ts (the single source of truth that
// the runtime fetcher imports), so the build script and the runtime download
// can't drift. Read it by regex rather than importing — this is a plain .mjs.
function readPinnedOllamaVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, '..', 'electron', 'ollama-version.ts'), 'utf8');
    const m = src.match(/OLLAMA_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (m && m[1]) return m[1];
  } catch {
    /* fall through to the literal fallback below */
  }
  return '0.24.0';
}

// Bump in electron/ollama-version.ts and re-test the packaged build — verify
// against https://github.com/ollama/ollama/releases.
const OLLAMA_VERSION = process.env.OLLAMA_VERSION || readPinnedOllamaVersion();

// Resolve the headless runtime asset (binary + GGML/MLX libraries, not the
// .app) for the host OS/arch. The binary's location WITHIN the archive varies
// per platform — we discover it post-extraction and tell Electron via the
// `.ollama-binary` marker rather than hardcoding it here.
function resolveTarget() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  switch (process.platform) {
    case 'darwin':
      // One universal asset, no arch suffix.
      return { asset: 'ollama-darwin.tgz', extract: 'tgz', binary: 'ollama' };
    case 'linux':
      return { asset: `ollama-linux-${arch}.tar.zst`, extract: 'zst', binary: 'ollama' };
    case 'win32':
      return { asset: `ollama-windows-${arch}.zip`, extract: 'zip', binary: 'ollama.exe' };
    default:
      throw new Error(`unsupported platform for Ollama runtime: ${process.platform}`);
  }
}

const TARGET = resolveTarget();
const ASSET = TARGET.asset;
const RELEASE_BASE = `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}`;
const LICENSE_URL = `https://raw.githubusercontent.com/ollama/ollama/v${OLLAMA_VERSION}/LICENSE`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(REPO_ROOT, 'build-resources', '.cache');
const ARCHIVE_PATH = path.join(CACHE_DIR, ASSET);
const OUT_DIR = path.join(REPO_ROOT, 'build-resources', 'ollama');
// Records which version + target is staged so re-runs are a no-op until the pin
// (or the host platform) changes — re-staging on a different OS must re-extract.
const VERSION_MARKER = path.join(OUT_DIR, '.ollama-version');
const STAGED_ID = `${OLLAMA_VERSION} ${process.platform}-${process.arch}`;

const force = process.argv.includes('--force');

function log(msg) {
  console.log(`[fetch-ollama] ${msg}`);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed (${res.status} ${res.statusText}): ${url}`);
  return res.text();
}

async function download(url, dest) {
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed (${res.status} ${res.statusText}): ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

// Extract an archive into outDir using whichever `tar` flavor matches the
// format. All three run on their native CI runner: GNU tar + zstd on Linux,
// bsdtar (System32 tar.exe) on Windows, bsdtar on macOS.
//
// On Windows we MUST call System32's bsdtar explicitly: Git-for-Windows
// installs MSYS2 GNU tar earlier on PATH, and GNU tar misreads absolute
// paths like `D:\a\...` as host:path (rsh/rcp legacy) and fails with
// "Cannot connect to D: resolve failed". bsdtar has no such legacy.
const TAR =
  process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';

function extract(archive, kind, outDir) {
  const args = {
    tgz: ['xzf', archive, '-C', outDir],
    zst: ['--zstd', '-xf', archive, '-C', outDir], // needs the zstd tool on PATH
    zip: ['-xf', archive, '-C', outDir], // bsdtar auto-detects zip
  }[kind];
  if (!args) throw new Error(`unknown archive kind: ${kind}`);
  execFileSync(TAR, args, { stdio: 'inherit' });
}

// Recursively locate a file by exact name under root. Used to find the
// ollama binary regardless of the archive's nesting (flat on macOS, bin/ on
// Linux, whatever Windows ships). Depth cap keeps a pathological archive
// from melting the script.
async function findBinary(root, name, depth = 0) {
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

// Total size of a directory tree, in bytes. Replaces a `du` shell-out so the
// script works on Windows (no du in System32) without a coreutils dependency.
async function dirSize(dir) {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(p);
    else if (entry.isFile()) total += (await fs.stat(p)).size;
  }
  return total;
}

// Pull the SHA256 for ASSET out of the release's sha256sum.txt. Lines look
// like: "<hex>  ./ollama-darwin.tgz".
async function expectedSha() {
  const text = await fetchText(`${RELEASE_BASE}/sha256sum.txt`);
  for (const line of text.split('\n')) {
    const [hex, name] = line.trim().split(/\s+/);
    if (name && name.replace(/^\.\//, '') === ASSET) return hex;
  }
  throw new Error(`sha256sum.txt for v${OLLAMA_VERSION} has no entry for ${ASSET}`);
}

async function main() {
  // Idempotent: skip entirely when this version+platform is already staged.
  if (!force && (await exists(VERSION_MARKER))) {
    const staged = (await fs.readFile(VERSION_MARKER, 'utf8')).trim();
    if (staged === STAGED_ID) {
      log(`Ollama already staged (${STAGED_ID}) — use --force to refresh.`);
      return;
    }
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });

  const wantSha = await expectedSha();

  // Reuse a cached archive only when its hash matches the pinned release;
  // a stale or partial cache fails the check and is re-downloaded.
  let haveValidArchive = false;
  if (!force && (await exists(ARCHIVE_PATH))) {
    if ((await sha256(ARCHIVE_PATH)) === wantSha) {
      log('using cached archive (checksum verified)');
      haveValidArchive = true;
    } else {
      log('cached archive checksum mismatch — re-downloading');
    }
  }

  if (!haveValidArchive) {
    await download(`${RELEASE_BASE}/${ASSET}`, ARCHIVE_PATH);
    const got = await sha256(ARCHIVE_PATH);
    if (got !== wantSha) {
      throw new Error(
        `checksum mismatch for ${ASSET}\n  expected ${wantSha}\n  got      ${got}`,
      );
    }
    log('download checksum verified');
  }

  // Clean extraction so a re-stage never leaves stale files behind.
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  log(`extracting runtime (${TARGET.extract})…`);
  extract(ARCHIVE_PATH, TARGET.extract, OUT_DIR);

  // Locate the binary wherever the archive put it and record its relative
  // path so Electron doesn't have to know per-platform layouts. We never move
  // it — Ollama resolves its libs (lib/ollama/...) relative to the binary's
  // real on-disk location.
  const binary = await findBinary(OUT_DIR, TARGET.binary);
  if (!binary) {
    const found = (await fs.readdir(OUT_DIR)).join(', ');
    throw new Error(
      `could not find ${TARGET.binary} anywhere under the extracted archive.\n` +
        `Root entries were: ${found}`,
    );
  }
  await fs.chmod(binary, 0o755); // no-op on Windows, harmless
  const binaryRel = path.relative(OUT_DIR, binary);
  // Marker is read by electron/ollama-process.ts + server/service-config.ts.
  // Forward slashes work on all OSes (Node path APIs accept them on Windows),
  // and keeping it portable means the same staged dir works if cross-copied.
  await fs.writeFile(
    path.join(OUT_DIR, '.ollama-binary'),
    binaryRel.split(path.sep).join('/') + '\n',
  );
  log(`binary at ${binaryRel}`);

  // Ship Ollama's license (MIT) alongside the runtime. Best-effort: a network
  // blip on this one file should not fail the build, but it must be loud.
  try {
    await fs.writeFile(path.join(OUT_DIR, 'LICENSE-ollama.txt'), await fetchText(LICENSE_URL));
  } catch (err) {
    log(`WARNING: could not fetch Ollama LICENSE — ${err.message}`);
  }

  await fs.writeFile(VERSION_MARKER, `${STAGED_ID}\n`);

  const mb = Math.round((await dirSize(OUT_DIR)) / (1024 * 1024));
  log(`staged Ollama ${STAGED_ID} (${mb} MB) → ${path.relative(REPO_ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
  console.error(`[fetch-ollama] ERROR: ${err.message}`);
  process.exit(1);
});
