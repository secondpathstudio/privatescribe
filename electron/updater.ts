/**
 * Auto-update wiring for the packaged desktop app.
 *
 * Uses electron-updater against the GitHub Releases provider configured under
 * `publish` in electron-builder.yml. On a packaged build this checks once at
 * startup, downloads any newer release in the background, and installs it on
 * the next quit (autoInstallOnAppQuit — the default). Updates never apply
 * mid-session, so an in-progress recording or unsaved note is never disturbed.
 *
 * Not used in dev: there's no app-update.yml outside a packaged build, so the
 * caller in main.ts guards on !isDev.
 */
import { autoUpdater } from 'electron-updater';

export function initAutoUpdater(): void {
  // autoUpdater is an EventEmitter — an unhandled 'error' event would crash
  // the main process. A failed update check must never take the app down:
  // log it and leave the user on the version they already have.
  autoUpdater.on('error', (err) => {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error('[updater] update check/download failed:', detail);
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] update available: ${info.version} — downloading in background`);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] already on the latest version');
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] ${info.version} downloaded — will install on next quit`);
  });

  // Check now, download in the background, and show a native notification
  // when the update is ready. The .catch is belt-and-suspenders alongside the
  // 'error' handler above so a rejected promise is never left unhandled.
  autoUpdater
    .checkForUpdatesAndNotify()
    .catch((err) => console.error('[updater] checkForUpdatesAndNotify rejected:', err));
}
