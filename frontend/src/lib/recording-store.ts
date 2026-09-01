/**
 * Crash-durable recording buffer (encrypted IndexedDB).
 *
 * A consult recording used to exist only in renderer memory until Stop — a
 * crash, reload, or force-quit lost the whole thing. This module persists
 * every MediaRecorder timeslice chunk as it's produced, so at most the last
 * ~2 seconds are ever at risk, and offers orphaned sessions back for
 * recovery on the next visit to the create-note page.
 *
 * Privacy: chunks are AES-256-GCM encrypted BEFORE they touch IndexedDB —
 * plaintext patient audio is never written to the profile directory. The key
 * is per-user, derived server-side from the SQLCipher master (HKDF, see
 * GET /api/user/recording-key) and held only in memory here; the store keeps
 * ciphertext plus the key's fingerprint. After a master-key rotation the
 * fingerprint no longer matches and affected sessions are reported as
 * unrecoverable rather than decrypting to garbage. If the key can't be
 * fetched or WebCrypto is unavailable (insecure context), persistence is
 * silently skipped and recording behaves exactly as before — encryption is
 * mandatory, plaintext fallback is not an option.
 *
 * Lifecycle: begin → chunk writes while recording → 'pending-save' on stop →
 * deleted only once the note row actually exists (save success) or the user
 * discards. Sessions older than 7 days are purged as a safety valve.
 *
 * Everything is best-effort: no failure in here may ever break the live
 * recording path, so every public entry point swallows its errors.
 */
import { API_BASE } from "./api";
import { getAccessToken } from "./token-store";

const DB_NAME = "privatescribe-recordings";
const DB_VERSION = 1;
const SESSIONS = "sessions";
const CHUNKS = "chunks";
const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** MediaRecorder timeslice used by Microphone — one chunk ≈ this many ms. */
export const CHUNK_MS = 2000;

type SessionRow = {
  id: string;
  startedAt: number;
  updatedAt: number;
  mimeType: string;
  status: "recording" | "pending-save";
  keyFp: string;
  chunkCount: number;
};

type ChunkRow = {
  sessionId: string;
  seq: number;
  iv: ArrayBuffer;
  data: ArrayBuffer;
};

export type RecoverableRecording = {
  id: string;
  startedAt: number;
  chunkCount: number;
  approxSeconds: number;
};

/** Thrown by assembleRecording when the server's current key no longer
 *  matches the one the session was encrypted under (master-key rotation). */
export class RecordingKeyMismatch extends Error {
  constructor() {
    super("recording key has changed since this session was buffered");
    this.name = "RecordingKeyMismatch";
  }
}

// --- IndexedDB plumbing ------------------------------------------------------

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SESSIONS)) {
          db.createObjectStore(SESSIONS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(CHUNKS)) {
          db.createObjectStore(CHUNKS, { keyPath: ["sessionId", "seq"] });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** Promisified single-store readwrite op. */
function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function chunkRange(sessionId: string): IDBKeyRange {
  // seq is always a number, so [id, -Infinity]..[id, Infinity] spans exactly
  // this session's chunks in the composite-key store.
  return IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);
}

async function deleteSessionRows(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await tx(db, CHUNKS, "readwrite", (s) => s.delete(chunkRange(id)));
  await tx(db, SESSIONS, "readwrite", (s) => s.delete(id));
}

// --- Key handling ------------------------------------------------------------

async function fetchKey(): Promise<{ key: CryptoKey; fp: string } | null> {
  try {
    const token = getAccessToken();
    if (!token || typeof crypto === "undefined" || !crypto.subtle) return null;
    const res = await fetch(`${API_BASE}/api/user/recording-key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (typeof body.key !== "string" || typeof body.fingerprint !== "string") return null;
    const raw = Uint8Array.from(atob(body.key), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    return { key, fp: body.fingerprint };
  } catch {
    return null;
  }
}

// --- Active-session state ----------------------------------------------------
// Module-level (like session-hold) so it survives Microphone remounts and the
// note forms can complete/delete the session after their save succeeds.

type ActiveSession = {
  id: string;
  key: CryptoKey | null; // null = persistence disabled, deletion still works
  seq: number;
};

let active: ActiveSession | null = null;
let initPromise: Promise<void> = Promise.resolve();
// Chunk writes are chained so seq order matches arrival order even though
// encryption is async.
let writeChain: Promise<void> = Promise.resolve();

/**
 * Start buffering a new recording. Fire-and-forget from the recorder's
 * startRecording — storeRecordingChunk internally waits for this to settle.
 * Any prior active session is left in place on disk (it's unsaved audio and
 * will show up in recovery), just no longer tracked as active.
 */
export function beginRecordingSession(): void {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  active = { id, key: null, seq: 0 };
  const mine = active;
  initPromise = (async () => {
    try {
      const db = await openDb();
      const fetched = await fetchKey();
      if (!db || !fetched) return; // stay memory-only, never plaintext
      const row: SessionRow = {
        id,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        mimeType: "audio/webm",
        status: "recording",
        keyFp: fetched.fp,
        chunkCount: 0,
      };
      await tx(db, SESSIONS, "readwrite", (s) => s.put(row));
      if (active === mine) mine.key = fetched.key;
    } catch {
      // Persistence unavailable; recording continues unbuffered.
    }
  })();
}

/** Encrypt and persist one MediaRecorder chunk. Fire-and-forget. */
export function storeRecordingChunk(blob: Blob): void {
  const mine = active;
  if (!mine) return;
  writeChain = writeChain
    .then(async () => {
      await initPromise;
      if (!mine.key || active !== mine) return;
      const seq = mine.seq++;
      const db = await openDb();
      if (!db) return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = await blob.arrayBuffer();
      const data = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        mine.key,
        plaintext,
      );
      const row: ChunkRow = { sessionId: mine.id, seq, iv: iv.buffer, data };
      await tx(db, CHUNKS, "readwrite", (s) => s.put(row));
      const session = await tx<SessionRow | undefined>(db, SESSIONS, "readonly", (s) =>
        s.get(mine.id) as IDBRequest<SessionRow | undefined>,
      );
      if (session) {
        session.chunkCount = seq + 1;
        session.updatedAt = Date.now();
        await tx(db, SESSIONS, "readwrite", (s) => s.put(session));
      }
    })
    .catch(() => {
      // A failed write (quota, closed DB) sacrifices durability for that
      // chunk only; never the recording itself.
    });
}

/** Mark the active session as stopped-but-unsaved (recovery-eligible). */
export function markRecordingPendingSave(): void {
  const mine = active;
  if (!mine) return;
  writeChain = writeChain
    .then(async () => {
      await initPromise;
      if (!mine.key) return;
      const db = await openDb();
      if (!db) return;
      const session = await tx<SessionRow | undefined>(db, SESSIONS, "readonly", (s) =>
        s.get(mine.id) as IDBRequest<SessionRow | undefined>,
      );
      if (session) {
        session.status = "pending-save";
        session.updatedAt = Date.now();
        await tx(db, SESSIONS, "readwrite", (s) => s.put(session));
      }
    })
    .catch(() => undefined);
}

/**
 * The recording made it into a saved note — drop its buffered chunks.
 * Called by the note forms after a successful save. No-op when the note came
 * from a file upload (no active session).
 */
export async function completeActiveRecordingSession(): Promise<void> {
  const mine = active;
  if (!mine) return;
  active = null;
  try {
    await writeChain;
    await deleteSessionRows(mine.id);
  } catch {
    // Leftover rows resurface in recovery; the 7-day purge is the backstop.
  }
}

/**
 * Track a recovered session as the active one, so a successful save of the
 * recovered audio cleans it up through completeActiveRecordingSession like a
 * live recording would. Write-disabled (key stays null).
 */
export function adoptRecordingSession(id: string): void {
  active = { id, key: null, seq: 0 };
}

/** Orphaned sessions worth offering for recovery. Also purges expired ones. */
export async function listRecoverableRecordings(): Promise<RecoverableRecording[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    const rows = await tx<SessionRow[]>(db, SESSIONS, "readonly", (s) =>
      s.getAll() as IDBRequest<SessionRow[]>,
    );
    const now = Date.now();
    const out: RecoverableRecording[] = [];
    for (const row of rows) {
      if (row.id === active?.id) continue;
      if (now - row.startedAt > MAX_SESSION_AGE_MS || row.chunkCount === 0) {
        void deleteSessionRows(row.id);
        continue;
      }
      out.push({
        id: row.id,
        startedAt: row.startedAt,
        chunkCount: row.chunkCount,
        approxSeconds: Math.round((row.chunkCount * CHUNK_MS) / 1000),
      });
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

/**
 * Decrypt and reassemble a buffered session into a playable/transcribable
 * webm Blob. Throws RecordingKeyMismatch when the server key has rotated
 * since the session was buffered; other failures throw plain Errors.
 */
export async function assembleRecording(id: string): Promise<Blob> {
  const db = await openDb();
  if (!db) throw new Error("recording store unavailable");
  const session = await tx<SessionRow | undefined>(db, SESSIONS, "readonly", (s) =>
    s.get(id) as IDBRequest<SessionRow | undefined>,
  );
  if (!session) throw new Error("recording session not found");
  const fetched = await fetchKey();
  if (!fetched) throw new Error("could not fetch the recording key");
  if (fetched.fp !== session.keyFp) throw new RecordingKeyMismatch();

  const chunks = await tx<ChunkRow[]>(db, CHUNKS, "readonly", (s) =>
    s.getAll(chunkRange(id)) as IDBRequest<ChunkRow[]>,
  );
  chunks.sort((a, b) => a.seq - b.seq);
  const parts: ArrayBuffer[] = [];
  for (const c of chunks) {
    parts.push(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(c.iv) },
        fetched.key,
        c.data,
      ),
    );
  }
  return new Blob(parts, { type: session.mimeType || "audio/webm" });
}

/** Permanently delete a buffered session (user chose Discard). */
export async function discardRecording(id: string): Promise<void> {
  try {
    await deleteSessionRows(id);
  } catch {
    // Best-effort; the 7-day purge is the backstop.
  }
}
