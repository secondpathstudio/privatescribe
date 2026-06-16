#!/usr/bin/env node
/**
 * Vendors the WinSW service wrapper into build-resources/winsw/ for the
 * Windows desktop build.
 *
 * In server mode the three PrivateScribe processes (backend, Ollama, Caddy)
 * run as auto-starting Windows Services. A plain console exe can't be a Windows
 * Service on its own, so WinSW wraps each one: service-control.ts copies this
 * winsw.exe to <id>.exe next to a generated <id>.xml (rendered by
 * service-config.ts) and runs `<id>.exe install`. electron-builder copies
 * build-resources/winsw/ into the app as Resources/winsw-runtime/ (see
 * win.extraResources in electron-builder.yml).
 *
 * Windows-only: a no-op on macOS/Linux (those builds don't bundle WinSW), so
 * it's safe to chain into `npm run dist` on any host. WinSW publishes no
 * checksums file, so the download is verified against a SHA-256 pinned below.
 * WinSW-x64.exe is the self-contained build (bundles its own .NET runtime), so
 * the wrapper works with no .NET Framework dependency on the target machine.
 *
 * Usage:
 *   node scripts/fetch-winsw.mjs           # stage the exe if not present
 *   node scripts/fetch-winsw.mjs --force   # re-download and re-stage
 *   WINSW_FORCE_PLATFORM=1 node scripts/fetch-winsw.mjs   # stage off-Windows (testing)
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

// Pinned to a known-good WinSW release + the SHA-256 of WinSW-x64.exe for that
// tag. Bump both together (download the asset, sha256 it) and re-test the
// packaged build — verify against https://github.com/winsw/winsw/releases.
const WINSW_VERSION = process.env.WINSW_VERSION || '2.12.0';
const ASSET = 'WinSW-x64.exe';
const SHA256 = '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da';

const RELEASE_BASE = `https://github.com/winsw/winsw/releases/download/v${WINSW_VERSION}`;
const LICENSE_URL = `https://raw.githubusercontent.com/winsw/winsw/v${WINSW_VERSION}/LICENSE.txt`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(REPO_ROOT, 'build-resources', '.cache');
const CACHED = path.join(CACHE_DIR, `winsw-${WINSW_VERSION}-x64.exe`);
const OUT_DIR = path.join(REPO_ROOT, 'build-resources', 'winsw');
// Staged under a neutral name; service-control.ts copies it to <id>.exe per
// service at install time (WinSW reads <id>.xml next to <id>.exe).
const BINARY = path.join(OUT_DIR, 'winsw.exe');
// Records which version is staged so re-runs are a no-op until the pin moves.
const VERSION_MARKER = path.join(OUT_DIR, '.winsw-version');

const force = process.argv.includes('--force');

function log(msg) {
  console.log(`[fetch-winsw] ${msg}`);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
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

async function main() {
  // WinSW is only needed by the Windows build; skip cleanly elsewhere so a
  // mac/linux `npm run dist` (which chains build:winsw) is a harmless no-op.
  if (process.platform !== 'win32' && !process.env.WINSW_FORCE_PLATFORM) {
    log(`skip — WinSW is Windows-only (host is ${process.platform}).`);
    return;
  }

  // Idempotent: skip entirely when the pinned version is already staged.
  if (!force && (await exists(VERSION_MARKER))) {
    const staged = (await fs.readFile(VERSION_MARKER, 'utf8')).trim();
    if (staged === WINSW_VERSION) {
      log(`WinSW ${WINSW_VERSION} already staged — use --force to refresh.`);
      return;
    }
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });

  // Reuse a cached exe only when its hash matches the pinned release.
  let cachedOk = false;
  if (!force && (await exists(CACHED))) {
    if ((await hashFile(CACHED)) === SHA256) {
      log('using cached exe (checksum verified)');
      cachedOk = true;
    } else {
      log('cached exe checksum mismatch — re-downloading');
    }
  }

  if (!cachedOk) {
    await download(`${RELEASE_BASE}/${ASSET}`, CACHED);
    const got = await hashFile(CACHED);
    if (got !== SHA256) {
      throw new Error(
        `checksum mismatch for ${ASSET}\n  expected ${SHA256}\n  got      ${got}`,
      );
    }
    log('download checksum verified (sha256)');
  }

  // Clean stage so a re-run never leaves stale files behind.
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.copyFile(CACHED, BINARY);

  // Ship WinSW's license (MIT) alongside the binary. Best-effort.
  try {
    await fs.writeFile(path.join(OUT_DIR, 'LICENSE-winsw.txt'), await fetchText(LICENSE_URL));
  } catch (err) {
    log(`WARNING: could not fetch WinSW LICENSE — ${err.message}`);
  }

  await fs.writeFile(VERSION_MARKER, `${WINSW_VERSION}\n`);

  const size = `${((await fs.stat(BINARY)).size / 1024 / 1024).toFixed(1)} MB`;
  log(`staged WinSW ${WINSW_VERSION} (${size}) → ${path.relative(REPO_ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
  console.error(`[fetch-winsw] ERROR: ${err.message}`);
  process.exit(1);
});
