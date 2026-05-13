import { contextBridge } from 'electron';

function readApiBase(): string {
  const arg = process.argv.find((a) => a.startsWith('--api-base='));
  return arg ? arg.slice('--api-base='.length) : 'http://127.0.0.1:5000';
}

contextBridge.exposeInMainWorld('electron', {
  apiBase: readApiBase(),
});
