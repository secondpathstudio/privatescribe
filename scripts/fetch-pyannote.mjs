#!/usr/bin/env node
/**
 * Vendors the pyannote speaker-diarization models into build-resources/pyannote/
 * for the desktop build.
 *
 * Speaker diarization uses pyannote's `speaker-diarization-3.1` pipeline, which
 * pulls two sub-models (`segmentation-3.0` and `wespeaker-voxceleb-resnet34-LM`).
 * All three are *gated* on HuggingFace — downloading them needs an HF_TOKEN and
 * an accepted licence — but all three are MIT-licensed, so the weight files
 * themselves can be redistributed. This script downloads them once at build
 * time and stages them as plain files; the packaged app then loads diarization
 * with no token and no network (see backend/app/services/diarization.py).
 *
 * electron-builder copies build-resources/pyannote/ into the app bundle as
 * Resources/pyannote-models/ (see extraResources in electron-builder.yml), and
 * the Electron shell points the backend at it via PYANNOTE_MODELS_DIR.
 *
 * The actual download uses huggingface_hub, so this script shells out to the
 * backend venv's Python (the same interpreter `npm run build:backend` uses).
 *
 * Usage:
 *   node scripts/fetch-pyannote.mjs           # stage the models if not present
 *   node scripts/fetch-pyannote.mjs --force   # re-download and re-stage
 *   HF_TOKEN=hf_... node scripts/fetch-pyannote.mjs   # token via env instead of .env
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// The pipeline repo and its two sub-models, each pinned to a known-good
// revision. Bump deliberately and re-test diarization in a packaged build.
const MODELS = [
  {
    repo: 'pyannote/speaker-diarization-3.1',
    subdir: 'speaker-diarization-3.1',
    revision: '84fd25912480287da0247647c3d2b4853cb3ee5d',
  },
  {
    repo: 'pyannote/segmentation-3.0',
    subdir: 'segmentation-3.0',
    revision: 'e66f3d3b9eb0873085418a7b813d3b369bf160bb',
  },
  {
    repo: 'pyannote/wespeaker-voxceleb-resnet34-LM',
    subdir: 'wespeaker-voxceleb-resnet34-LM',
    revision: '837717ddb9ff5507820346191109dc79c958d614',
  },
];

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(REPO_ROOT, 'build-resources', 'pyannote');
const PYTHON = path.join(REPO_ROOT, 'backend', 'venv', 'bin', 'python');
const ENV_FILE = path.join(REPO_ROOT, 'backend', '.env');
// Records which revisions are staged so re-runs are a no-op until a pin moves.
const VERSION_MARKER = path.join(OUT_DIR, '.pyannote-revision');

const force = process.argv.includes('--force');

function log(msg) {
  console.log(`[fetch-pyannote] ${msg}`);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// The concatenated revision pins — the marker's content, used for idempotency.
function stagedSignature() {
  return MODELS.map((m) => `${m.repo}@${m.revision}`).join('\n') + '\n';
}

// HF_TOKEN from the environment, else parsed out of backend/.env. The pyannote
// repos are gated, so a token is required to download them (only at build
// time — the staged files need none).
async function resolveToken() {
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN;
  if (await exists(ENV_FILE)) {
    const match = (await fs.readFile(ENV_FILE, 'utf8')).match(/hf_[A-Za-z0-9]+/);
    if (match) return match[0];
  }
  throw new Error(
    'no HF_TOKEN found — set it in the environment or in backend/.env. ' +
      'A token is needed only to download the gated pyannote repos at build time; ' +
      'accept the licences at https://hf.co/pyannote/speaker-diarization-3.1 first.',
  );
}

// Drives huggingface_hub.snapshot_download for each pinned repo. Runs in the
// backend venv's Python so huggingface_hub is on hand.
const PY_DOWNLOAD = `
import json, shutil, sys
from pathlib import Path
from huggingface_hub import snapshot_download

models = json.loads(sys.argv[1])
out = Path(sys.argv[2])
token = sys.argv[3] or None
for m in models:
    dest = out / m["subdir"]
    snapshot_download(
        m["repo"],
        revision=m["revision"],
        local_dir=str(dest),
        token=token,
        allow_patterns=["*.yaml", "*.bin", "LICENSE", "*.md"],
        ignore_patterns=[".github/*"],
    )
    # huggingface_hub leaves per-file download metadata under .cache/ — build
    # bookkeeping that should not ship in the app bundle.
    shutil.rmtree(dest / ".cache", ignore_errors=True)
    print("[fetch-pyannote] staged " + m["subdir"], flush=True)
`;

async function main() {
  // Idempotent: skip entirely when the pinned revisions are already staged.
  if (!force && (await exists(VERSION_MARKER))) {
    const staged = await fs.readFile(VERSION_MARKER, 'utf8');
    if (staged === stagedSignature()) {
      log('pyannote models already staged — use --force to refresh.');
      return;
    }
  }

  if (!(await exists(PYTHON))) {
    throw new Error(
      `backend venv Python not found at ${path.relative(REPO_ROOT, PYTHON)} — ` +
        'create it first (see backend setup in CLAUDE.md / README).',
    );
  }

  const token = await resolveToken();

  // Clean re-stage so a refresh never leaves stale files behind.
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  log(`downloading ${MODELS.length} pyannote model repos…`);
  execFileSync(PYTHON, ['-c', PY_DOWNLOAD, JSON.stringify(MODELS), OUT_DIR, token], {
    stdio: 'inherit',
  });

  // Sanity-check the files diarization.py expects before declaring success.
  const required = [
    'speaker-diarization-3.1/config.yaml',
    'segmentation-3.0/pytorch_model.bin',
    'wespeaker-voxceleb-resnet34-LM/pytorch_model.bin',
  ];
  for (const rel of required) {
    if (!(await exists(path.join(OUT_DIR, rel)))) {
      throw new Error(`expected ${rel} after download, but it is missing`);
    }
  }

  await fs.writeFile(VERSION_MARKER, stagedSignature());

  const size = execFileSync('du', ['-sh', OUT_DIR]).toString().trim().split('\t')[0];
  log(`staged pyannote models (${size}) → ${path.relative(REPO_ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
  console.error(`[fetch-pyannote] ERROR: ${err.message}`);
  process.exit(1);
});
