#!/usr/bin/env node
/**
 * Vendors the Caddy web server into build-resources/caddy/ for the desktop build.
 *
 * In server mode (roadmap Phase 9) Caddy is the only LAN-facing process: it
 * terminates TLS with a self-signed cert (Caddy's `tls internal` local CA),
 * serves the built frontend, and reverse-proxies /api to the loopback backend.
 * This script downloads Caddy's official static binary for the host OS/arch,
 * verifies it against the checksum the release publishes, and stages it.
 * electron-builder copies build-resources/caddy/ into the app bundle as
 * Resources/caddy-runtime/ (see extraResources in electron-builder.yml); the
 * service layer launches Resources/caddy-runtime/privatescribe-webserver with
 * a rendered Caddyfile.
 *
 * Per-platform release assets (Caddy publishes static single-binary builds):
 *   - macOS:   caddy_<ver>_mac_<arch>.tar.gz       → tar xzf
 *   - Linux:   caddy_<ver>_linux_<arch>.tar.gz     → tar xzf
 *   - Windows: caddy_<ver>_windows_<arch>.zip      → tar -xf (bsdtar)
 *
 * Usage:
 *   node scripts/fetch-caddy.mjs           # stage the binary if not present
 *   node scripts/fetch-caddy.mjs --force   # re-download and re-stage
 *   CADDY_VERSION=2.x.y node scripts/fetch-caddy.mjs   # pin another version
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

// Pinned to a known-good Caddy release. Bump deliberately and re-test the
// packaged build — verify against https://github.com/caddyserver/caddy/releases.
const CADDY_VERSION = process.env.CADDY_VERSION || '2.8.4';

// Resolve the static server binary asset for the host OS/arch. Caddy's
// release assets: tar.gz for mac/linux, zip for windows; the archive holds a
// single `caddy`/`caddy.exe` binary at its root on every platform.
function resolveTarget() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  switch (process.platform) {
    case 'darwin':
      return { asset: `caddy_${CADDY_VERSION}_mac_${arch}.tar.gz`, binary: 'caddy' };
    case 'linux':
      return { asset: `caddy_${CADDY_VERSION}_linux_${arch}.tar.gz`, binary: 'caddy' };
    case 'win32':
      return { asset: `caddy_${CADDY_VERSION}_windows_${arch}.zip`, binary: 'caddy.exe' };
    default:
      throw new Error(`unsupported platform for Caddy: ${process.platform}`);
  }
}

const TARGET = resolveTarget();
const ASSET = TARGET.asset;
const CHECKSUMS = `caddy_${CADDY_VERSION}_checksums.txt`;
const RELEASE_BASE = `https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}`;
const LICENSE_URL = `https://raw.githubusercontent.com/caddyserver/caddy/v${CADDY_VERSION}/LICENSE`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(REPO_ROOT, 'build-resources', '.cache');
const TGZ_PATH = path.join(CACHE_DIR, ASSET);
const OUT_DIR = path.join(REPO_ROOT, 'build-resources', 'caddy');
// Records which version + target is staged so re-runs are a no-op until the
// pin (or the host platform) changes — re-staging on a different OS must
// re-extract.
const VERSION_MARKER = path.join(OUT_DIR, '.caddy-version');
const STAGED_ID = `${CADDY_VERSION} ${process.platform}-${process.arch}`;

const force = process.argv.includes('--force');

function log(msg) {
  console.log(`[fetch-caddy] ${msg}`);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Hash a file with the algorithm implied by the expected digest's length
// (64 hex = sha256, 128 hex = sha512) — Caddy's checksums.txt uses sha512,
// but detecting from length keeps this robust if a release switches.
async function hashFile(filePath, algo) {
  const hash = createHash(algo);
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function algoForDigest(hex) {
  if (hex.length === 64) return 'sha256';
  if (hex.length === 128) return 'sha512';
  throw new Error(`unrecognized checksum length ${hex.length} (${hex.slice(0, 12)}…)`);
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

// Pull the expected digest for ASSET out of the release's checksums file.
// Lines look like: "<hex>  caddy_<ver>_mac_arm64.tar.gz".
async function expectedDigest() {
  const text = await fetchText(`${RELEASE_BASE}/${CHECKSUMS}`);
  for (const line of text.split('\n')) {
    const [hex, name] = line.trim().split(/\s+/);
    if (name && name.replace(/^\.\//, '') === ASSET) return hex;
  }
  throw new Error(`${CHECKSUMS} has no entry for ${ASSET}`);
}

async function main() {
  // Idempotent: skip entirely when the pinned version is already staged.
  if (!force && (await exists(VERSION_MARKER))) {
    const staged = (await fs.readFile(VERSION_MARKER, 'utf8')).trim();
    if (staged === STAGED_ID) {
      log(`Caddy ${STAGED_ID} already staged — use --force to refresh.`);
      return;
    }
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });

  const wantHex = await expectedDigest();
  const algo = algoForDigest(wantHex);

  // Reuse a cached tarball only when its hash matches the pinned release.
  let haveValidTgz = false;
  if (!force && (await exists(TGZ_PATH))) {
    if ((await hashFile(TGZ_PATH, algo)) === wantHex) {
      log('using cached tarball (checksum verified)');
      haveValidTgz = true;
    } else {
      log('cached tarball checksum mismatch — re-downloading');
    }
  }

  if (!haveValidTgz) {
    await download(`${RELEASE_BASE}/${ASSET}`, TGZ_PATH);
    const got = await hashFile(TGZ_PATH, algo);
    if (got !== wantHex) {
      throw new Error(
        `checksum mismatch for ${ASSET}\n  expected ${wantHex}\n  got      ${got}`,
      );
    }
    log(`download checksum verified (${algo})`);
  }

  // Clean extraction so a re-stage never leaves stale files behind.
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  log('extracting binary…');
  // Windows must use System32's bsdtar (handles .zip); MSYS tar from a git
  // bash PATH chokes on Windows-style absolute paths ("C:\…").
  const tar = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
  execFileSync(tar, ['-xf', TGZ_PATH, '-C', OUT_DIR], { stdio: 'inherit' });

  const extracted = path.join(OUT_DIR, TARGET.binary);
  if (!(await exists(extracted))) {
    throw new Error(`expected caddy binary at ${extracted} after extraction`);
  }
  // Rename to a PrivateScribe-specific name so it's identifiable in the
  // process list as our web server, not a generic "caddy" (Caddy doesn't care
  // about its own filename). service-config.ts launches it under this name.
  const binary = path.join(
    OUT_DIR,
    process.platform === 'win32' ? 'privatescribe-webserver.exe' : 'privatescribe-webserver',
  );
  await fs.rename(extracted, binary);
  await fs.chmod(binary, 0o755);

  // Ship Caddy's license (Apache-2.0) alongside the binary. Best-effort.
  try {
    await fs.writeFile(path.join(OUT_DIR, 'LICENSE-caddy.txt'), await fetchText(LICENSE_URL));
  } catch (err) {
    log(`WARNING: could not fetch Caddy LICENSE — ${err.message}`);
  }

  await fs.writeFile(VERSION_MARKER, `${STAGED_ID}\n`);

  const size = `${((await fs.stat(binary)).size / 1024 / 1024).toFixed(1)} MB`;
  log(`staged Caddy ${STAGED_ID} (${size}) → ${path.relative(REPO_ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
  console.error(`[fetch-caddy] ERROR: ${err.message}`);
  process.exit(1);
});
