import { createContext, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { API_BASE } from "@/lib/api";
import { clearAuth, getStoredToken, getStoredUser, saveAuth, saveUser, subscribeToken } from "@/lib/token-store";

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, refreshToken: string, user: User) => void;
  logout: () => void;
  updateUser: (patch: Partial<User>) => void;
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

  useEffect(() => {
    // The fetch interceptor (lib/auth-fetch) refreshes or clears the token
    // outside React; mirror those changes into state so components re-render
    // with the fresh token (or get bounced to login when the session ends).
    const unsub = subscribeToken((t) => setToken(t));
    const onExpired = () => {
      setToken(null);
      setUser(null);
      toast.error("Your session ended. Please sign in again.");
    };
    window.addEventListener("privatescribe:auth-expired", onExpired);
    return () => {
      unsub();
      window.removeEventListener("privatescribe:auth-expired", onExpired);
    };
  }, []);

  const login = (newToken: string, refreshToken: string, user: User) => {
    setToken(newToken);
    setUser(user);
    saveAuth(newToken, refreshToken, JSON.stringify(user));
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
    <AuthContext.Provider value={{ token, user, login, logout, updateUser }}>
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
