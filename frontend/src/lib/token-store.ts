/**
 * Auth-token persistence (Phase 10, GAP-16).
 *
 * The desktop client encrypts tokens at rest via the OS keychain (Electron
 * safeStorage, exposed as `window.electron.secure`); browser/PWA clients fall
 * back to plaintext `localStorage`. Reads are synchronous on both paths — the
 * desktop snapshot is injected by preload at launch — so the auth context can
 * restore a session in its `useState` initializer without an async gap. Writes
 * are fire-and-forget: in-memory React state is the live source of truth, and
 * the encrypted blob just needs to be current by the next launch.
 *
 * All token access in the app goes through here; nothing else touches the
 * underlying store.
 */
const ACCESS = "access_token";
const REFRESH = "refresh_token";
const USER = "user";

function secure(): NonNullable<Window["electron"]>["secure"] | null {
  if (typeof window === "undefined") return null;
  return window.electron?.secure ?? null;
}

/** Raw stored user JSON string (no ephemeral filtering). */
function rawUser(): string | null {
  const s = secure();
  if (s) return s.snapshot?.[USER] ?? null;
  return localStorage.getItem(USER);
}

/**
 * "Drop credentials on close" honored only in the desktop shell (web sessions
 * ignore it, matching prior behavior). When the last session had it set, this
 * launch starts signed out — the stored token is treated as absent.
 */
function shouldDropEphemeral(): boolean {
  if (typeof window === "undefined" || !window.electron) return false;
  const raw = rawUser();
  if (!raw) return false;
  try {
    return !!JSON.parse(raw)?.logoutOnClose;
  } catch {
    return false;
  }
}

export function getStoredToken(): string | null {
  if (shouldDropEphemeral()) return null;
  const s = secure();
  if (s) return s.snapshot?.[ACCESS] ?? null;
  return localStorage.getItem(ACCESS);
}

export function getStoredUser<T = unknown>(): T | null {
  if (shouldDropEphemeral()) return null;
  const raw = rawUser();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Persist the full token set + user (on login). `userJson` is pre-serialized. */
export function saveAuth(accessToken: string, refreshToken: string, userJson: string): void {
  currentAccess = accessToken;
  currentRefresh = refreshToken;
  const s = secure();
  if (s) {
    void s.set({ [ACCESS]: accessToken, [REFRESH]: refreshToken, [USER]: userJson });
  } else {
    localStorage.setItem(ACCESS, accessToken);
    localStorage.setItem(REFRESH, refreshToken);
    localStorage.setItem(USER, userJson);
  }
  notifyToken(accessToken);
}

/** Persist just the user object (on profile/settings updates). */
export function saveUser(userJson: string): void {
  const s = secure();
  if (s) {
    void s.set({ [USER]: userJson });
    return;
  }
  localStorage.setItem(USER, userJson);
}

/** Forget everything (logout, ephemeral close, corrupt state). */
export function clearAuth(): void {
  currentAccess = null;
  currentRefresh = null;
  const s = secure();
  if (s) {
    void s.clear();
  } else {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
    localStorage.removeItem(USER);
  }
  notifyToken(null);
}

// --- In-memory token layer (live source of truth during a session) ----------
// The encrypted snapshot is only the launch-time value; after a refresh writes
// a new access token, reads must come from memory, not the stale snapshot. The
// auth-fetch interceptor and the auth context both read/write through here.

function getStoredRefresh(): string | null {
  if (shouldDropEphemeral()) return null;
  const s = secure();
  if (s) return s.snapshot?.[REFRESH] ?? null;
  return localStorage.getItem(REFRESH);
}

let currentAccess: string | null = getStoredToken();
let currentRefresh: string | null = getStoredRefresh();

type TokenSub = (token: string | null) => void;
const tokenSubs = new Set<TokenSub>();

function notifyToken(token: string | null): void {
  tokenSubs.forEach((cb) => { try { cb(token); } catch { /* a bad subscriber can't break others */ } });
}

/** Subscribe to access-token changes (login, silent refresh, logout). Returns
 *  an unsubscribe fn. Used by the auth context to keep its React state in sync
 *  when the fetch interceptor refreshes the token outside React. */
export function subscribeToken(cb: TokenSub): () => void {
  tokenSubs.add(cb);
  return () => { tokenSubs.delete(cb); };
}

/** The live access token (post-refresh-aware), for the fetch interceptor. */
export function getAccessToken(): string | null {
  return currentAccess;
}

/** The refresh token, for the fetch interceptor's /refresh call. */
export function getRefreshToken(): string | null {
  return currentRefresh;
}

/** Replace just the access token after a silent refresh; notifies subscribers. */
export function setAccessToken(token: string): void {
  currentAccess = token;
  const s = secure();
  if (s) void s.set({ [ACCESS]: token });
  else localStorage.setItem(ACCESS, token);
  notifyToken(token);
}
