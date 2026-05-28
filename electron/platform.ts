/**
 * Per-OS naming and layout for the bundled binaries we spawn (the PyInstaller
 * backend, Ollama, Caddy). Two concerns live here:
 *
 *   1. Executable suffix — `.exe` on Windows, none on macOS/Linux (exe()).
 *   2. Resolving the Ollama binary inside its staged runtime dir, which is
 *      flat on macOS but nested on Linux (bin/ollama) and varies on Windows.
 *      scripts/fetch-ollama.mjs records the binary's relative location in a
 *      `.ollama-binary` marker file; we read that here so callers don't need
 *      to know per-platform layouts.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Executable file extension for the current OS ('.exe' on Windows, '' else). */
export const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : '';

/** Append the platform's executable suffix to a bundled binary's base name. */
export function exe(name: string): string {
  return name + EXE_SUFFIX;
}

/**
 * Absolute path to the bundled `ollama` binary inside its staged runtime dir.
 *
 * scripts/fetch-ollama.mjs writes `.ollama-binary` (a single-line marker with
 * the relative path) when it stages the runtime; we read that so this code
 * doesn't need to know per-platform archive layouts. Falls back to
 * `<runtimeDir>/ollama[.exe]` so an older staged dir without the marker still
 * works on macOS (where the binary is at root).
 */
export function resolveOllamaBinary(runtimeDir: string): string {
  const marker = path.join(runtimeDir, '.ollama-binary');
  try {
    const rel = fs.readFileSync(marker, 'utf8').trim();
    if (rel) return path.join(runtimeDir, rel);
  } catch {
    // marker missing (older stage / fresh dev tree) — fall through
  }
  return path.join(runtimeDir, exe('ollama'));
}
