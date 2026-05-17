#!/usr/bin/env node
/**
 * Vendors the Ollama runtime into build-resources/ollama/ for the desktop build.
 *
 * PrivateScribe bundles Ollama so a fresh install needs no separate Ollama
 * setup. This script downloads Ollama's official headless macOS distribution
 * (ollama-darwin.tgz — the CLI/server runtime, with no menu-bar GUI app),
 * verifies it against the SHA256 the release publishes, and extracts it.
 * electron-builder then copies build-resources/ollama/ into the app bundle as
 * Resources/ollama-runtime/ (see extraResources in electron-builder.yml), and
 * Electron spawns Resources/ollama-runtime/ollama when no system Ollama is
 * already running.
 *
 * The runtime is staged verbatim — including the x86_64 slices and the Intel
 * CPU GGML backends — because that is the exact file set Ollama ships and
 * tests. Thinning to arm64-only (the app targets arm64) would save ~80MB but
 * is left as a deliberate follow-up: a broken trim only surfaces in a slow
 * notarized build, so it is not worth coupling to first delivery.
 *
 * Usage:
 *   node scripts/fetch-ollama.mjs           # stage the runtime if not present
 *   node scripts/fetch-ollama.mjs --force   # re-download and re-stage
 *   OLLAMA_VERSION=0.x.y node scripts/fetch-ollama.mjs   # pin another version
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

// Pinned to a known-good Ollama release. Bump deliberately and re-test the
// packaged build — verify against https://github.com/ollama/ollama/releases.
const OLLAMA_VERSION = process.env.OLLAMA_VERSION || '0.24.0';

// The headless macOS runtime (binary + GGML/MLX libraries), not the .app.
const ASSET = 'ollama-darwin.tgz';
const RELEASE_BASE = `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}`;
const LICENSE_URL = `https://raw.githubusercontent.com/ollama/ollama/v${OLLAMA_VERSION}/LICENSE`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(REPO_ROOT, 'build-resources', '.cache');
const TGZ_PATH = path.join(CACHE_DIR, ASSET);
const OUT_DIR = path.join(REPO_ROOT, 'build-resources', 'ollama');
// Records which version is staged so re-runs are a no-op until the pin moves.
const VERSION_MARKER = path.join(OUT_DIR, '.ollama-version');

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
  // Idempotent: skip entirely when the pinned version is already staged.
  if (!force && (await exists(VERSION_MARKER))) {
    const staged = (await fs.readFile(VERSION_MARKER, 'utf8')).trim();
    if (staged === OLLAMA_VERSION) {
      log(`Ollama ${OLLAMA_VERSION} already staged — use --force to refresh.`);
      return;
    }
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });

  const wantSha = await expectedSha();

  // Reuse a cached tarball only when its hash matches the pinned release;
  // a stale or partial cache fails the check and is re-downloaded.
  let haveValidTgz = false;
  if (!force && (await exists(TGZ_PATH))) {
    if ((await sha256(TGZ_PATH)) === wantSha) {
      log('using cached tarball (checksum verified)');
      haveValidTgz = true;
    } else {
      log('cached tarball checksum mismatch — re-downloading');
    }
  }

  if (!haveValidTgz) {
    await download(`${RELEASE_BASE}/${ASSET}`, TGZ_PATH);
    const got = await sha256(TGZ_PATH);
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
  log('extracting runtime…');
  execFileSync('tar', ['xzf', TGZ_PATH, '-C', OUT_DIR], { stdio: 'inherit' });

  // The tarball extracts flat — the server binary must land at the root.
  const binary = path.join(OUT_DIR, 'ollama');
  if (!(await exists(binary))) {
    throw new Error(`expected ollama binary at ${binary} after extraction`);
  }
  await fs.chmod(binary, 0o755);

  // Ship Ollama's license (MIT) alongside the runtime. Best-effort: a network
  // blip on this one file should not fail the build, but it must be loud.
  try {
    await fs.writeFile(path.join(OUT_DIR, 'LICENSE-ollama.txt'), await fetchText(LICENSE_URL));
  } catch (err) {
    log(`WARNING: could not fetch Ollama LICENSE — ${err.message}`);
  }

  await fs.writeFile(VERSION_MARKER, `${OLLAMA_VERSION}\n`);

  const size = execFileSync('du', ['-sh', OUT_DIR]).toString().trim().split('\t')[0];
  log(`staged Ollama ${OLLAMA_VERSION} (${size}) → ${path.relative(REPO_ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
  console.error(`[fetch-ollama] ERROR: ${err.message}`);
  process.exit(1);
});
