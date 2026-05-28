/**
 * Per-OS executable naming. The bundled binaries we spawn (the PyInstaller
 * backend, Ollama, Caddy) are staged under names that gain a `.exe` extension
 * on Windows but none on macOS/Linux, so every place that resolves one of those
 * paths goes through here rather than hardcoding the bare name.
 */

/** Executable file extension for the current OS ('.exe' on Windows, '' else). */
export const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : '';

/** Append the platform's executable suffix to a bundled binary's base name. */
export function exe(name: string): string {
  return name + EXE_SUFFIX;
}
