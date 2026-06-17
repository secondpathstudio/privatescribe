/**
 * Single source of truth for the pinned Ollama runtime version.
 *
 * Imported by the runtime fetcher (electron/ollama-download.ts) and read (by
 * regex) from scripts/fetch-ollama.mjs, so the build script and the runtime
 * download can't drift apart. Bump deliberately and re-test against
 * https://github.com/ollama/ollama/releases — the release must publish the
 * per-OS assets ollama-download.ts/fetch-ollama.mjs expect, plus sha256sum.txt.
 */
export const OLLAMA_VERSION = '0.24.0';
