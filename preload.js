"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
function readApiBase() {
    const arg = process.argv.find((a) => a.startsWith('--api-base='));
    return arg ? arg.slice('--api-base='.length) : 'http://127.0.0.1:5000';
}
function readMode() {
    const arg = process.argv.find((a) => a.startsWith('--mode='));
    return arg ? arg.slice('--mode='.length) : 'standalone';
}
electron_1.contextBridge.exposeInMainWorld('electron', {
    apiBase: readApiBase(),
    // Deployment role: 'standalone' | 'server' | 'client'. Lets the renderer
    // tailor first-run (e.g. the org-less super-admin setup in server mode).
    mode: readMode(),
    // Ollama controls used by the onboarding wizard and OllamaGate. The bundled
    // runtime is only ever started through startBundled() — never automatically.
    ollama: {
        /** Start the bundled runtime; resolves once it answers (or fails). */
        startBundled: () => electron_1.ipcRenderer.invoke('ollama:start-bundled'),
        /** Remember the user's engine choice without starting anything. */
        setMode: (mode) => electron_1.ipcRenderer.invoke('ollama:set-mode', mode),
        /** The remembered engine choice, or null if onboarding hasn't chosen. */
        getMode: () => electron_1.ipcRenderer.invoke('ollama:get-mode'),
    },
    // Server-mode controls used by the "Become a server" wizard (Phase 9). These
    // drive the launchd service install/lifecycle (electron/server/*). Present
    // in every build; only invoked from the server-setup flow.
    server: {
        /** Whether the server daemons are already installed. */
        isInstalled: () => electron_1.ipcRenderer.invoke('server:is-installed'),
        /** Install + start the server daemons (prompts for admin). `lanPort` is
         *  the HTTPS port clients connect to. Resolves once launchctl has loaded. */
        install: (opts) => electron_1.ipcRenderer.invoke('server:install', opts),
        /** Stop + remove the server daemons (prompts for admin). */
        uninstall: () => electron_1.ipcRenderer.invoke('server:uninstall'),
        /** Restart the server daemons (prompts for admin) — e.g. after an update. */
        restart: () => electron_1.ipcRenderer.invoke('server:restart'),
        /** Relaunch the app into server mode (after install) so it targets the
         *  daemon for first-run admin creation onward. Does not resolve — the app
         *  exits and relaunches. */
        finishSetup: () => electron_1.ipcRenderer.invoke('server:finish-setup'),
        /** The pairing info clients need: the LAN URL + port. */
        info: () => electron_1.ipcRenderer.invoke('server:info'),
    },
});
//# sourceMappingURL=preload.js.map