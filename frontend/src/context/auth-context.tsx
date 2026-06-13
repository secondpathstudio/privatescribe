import { createContext, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { API_BASE } from "@/lib/api";
import { clearAuth, getAccessToken, getStoredToken, getStoredUser, saveAuth, saveUser, subscribeToken } from "@/lib/token-store";

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, refreshToken: string, user: User) => void;
  logout: () => void;
  updateUser: (patch: Partial<User>) => void;
  // Step a kiosk (no-login) session up to a full one by re-entering the
  // password. Throws with a user-facing message on a bad password.
  elevate: (password: string) => Promise<void>;
}

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  // The organization this user belongs to (one org per install today).
  // Set by the admin at first-run; inherited by every user.
  organization?: { id: string; name: string } | null;
  lastLogin: string;
  forcePasswordChange?: boolean;
  // True when this admin needs to view + back up the encryption key.
  // Set on login/validateToken; cleared via /api/acknowledge-backup-key
  // (called from the admin Encryption section after password re-auth).
  // The key itself is NEVER carried by this flag — only the obligation.
  pendingBackupKeyAcknowledgment?: boolean;
  // Cached copy of the admin-toggleable "drop credentials on app close"
  // setting. Only consulted in the Electron shell — web sessions ignore it.
  logoutOnClose?: boolean;
  // Cached copy of the admin-toggleable "Document exports" setting. When
  // false the SingleNote page hides PDF/DOCX download buttons (and the
  // backend will 503 the export endpoints regardless).
  exportsEnabled?: boolean;
  // Cached copy of the admin-toggleable "Dictation Commands" setting. When
  // false, the per-note toggle in the new-note flow is hidden and the
  // backend ignores any apply_dictation_markers form field.
  dictationMarkersEnabled?: boolean;
  // Admin-configured idle timeout in minutes (0 = disabled). The IdleLogout
  // component signs the user out after this long with no user input.
  idleTimeoutMinutes?: number;
  // False until the user finishes first-run onboarding. Drives post-login
  // routing — a new non-admin user is sent to the /getting-started intro.
  hasOnboarded?: boolean;
  // True when this session was issued passwordlessly by no-login (kiosk) mode.
  // Admin areas gate behind the step-up password modal until the session is
  // elevated (see auth.elevate / RequireAdmin).
  kiosk?: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Synchronous bootstrap: if we're in Electron and the last session had
// logoutOnClose true, drop the stored tokens before anyone reads them.
// Runs at module load, before AuthProvider's useState initializers fire.
// (getStoredToken/getStoredUser already treat an ephemeral session as absent;
// this wipes it from disk too so it can't be restored.)
(function clearStoredAuthIfEphemeral() {
  if (typeof window === "undefined" || !window.electron) return;
  const stored = getStoredUser<{ logoutOnClose?: boolean }>();
  if (stored?.logoutOnClose) clearAuth();
})();

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [user, setUser] = useState<User | null>(getStoredUser<User>());

  const login = (newToken: string, refreshToken: string, user: User) => {
    setToken(newToken);
    setUser(user);
    saveAuth(newToken, refreshToken, JSON.stringify(user));
  };

  // Passwordless kiosk sign-in. Probes setup/status; when no-login mode is on
  // (and first-run setup is done), grabs a kiosk token and signs in. Returns
  // whether it actually signed in, so callers can fall back to the login form.
  const attemptAutoLogin = async (): Promise<boolean> => {
    try {
      const status = await fetch(`${API_BASE}/api/setup/status`).then((r) => r.json());
      if (!status?.no_login || status?.needs_setup) return false;
      const res = await fetch(`${API_BASE}/api/auth/auto-login`, { method: "POST" });
      if (!res.ok) return false;
      const data = await res.json();
      login(data.access_token, data.refresh_token, data.user);
      return true;
    } catch {
      return false;
    }
  };
  // Keep the latest closure reachable from the one-time effects below.
  const autoLoginRef = useRef(attemptAutoLogin);
  autoLoginRef.current = attemptAutoLogin;

  const bootstrappedRef = useRef(false);
  useEffect(() => {
    // One-time: with no stored token, try to auto-sign-in for no-login mode.
    // A stored kiosk/full token is reused as-is (RequireAuth re-validates it).
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    if (!getStoredToken()) void autoLoginRef.current();
  }, []);

  useEffect(() => {
    // The fetch interceptor (lib/auth-fetch) refreshes or clears the token
    // outside React; mirror those changes into state so components re-render
    // with the fresh token (or get bounced to login when the session ends).
    const unsub = subscribeToken((t) => setToken(t));
    const onExpired = () => {
      setToken(null);
      setUser(null);
      // In no-login mode a dead session just means silently re-establishing
      // the kiosk session, not bouncing the user to a login screen.
      void autoLoginRef.current().then((reauthed) => {
        if (!reauthed) toast.error("Your session ended. Please sign in again.");
      });
    };
    window.addEventListener("privatescribe:auth-expired", onExpired);
    return () => {
      unsub();
      window.removeEventListener("privatescribe:auth-expired", onExpired);
    };
  }, []);

  const elevate = async (password: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/api/auth/elevate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAccessToken() ?? ""}`,
      },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not verify password");
    login(data.access_token, data.refresh_token, data.user);
  };

  const updateUser = (patch: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      saveUser(JSON.stringify(next));
      return next;
    });
  };

  const logout = () => {
    // Best-effort server-side session revoke. keepalive lets the request
    // complete even if the page navigates away right after; local state is
    // cleared either way so the UI returns to signed-out immediately. Uses the
    // in-memory token (storage may be async/encrypted).
    if (token) {
      fetch(`${API_BASE}/api/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {});
    }
    setToken(null);
    setUser(null);
    clearAuth();
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout, updateUser, elevate }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
