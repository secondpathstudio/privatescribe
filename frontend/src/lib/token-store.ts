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
  const s = secure();
  if (s) {
    void s.set({ [ACCESS]: accessToken, [REFRESH]: refreshToken, [USER]: userJson });
    return;
  }
  localStorage.setItem(ACCESS, accessToken);
  localStorage.setItem(REFRESH, refreshToken);
  localStorage.setItem(USER, userJson);
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
  const s = secure();
  if (s) {
    void s.clear();
    return;
  }
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
  localStorage.removeItem(USER);
}
