import { createContext, useContext, useState } from "react";
import { API_BASE } from "@/lib/api";

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
(function clearStoredAuthIfEphemeral() {
  if (typeof window === "undefined" || !window.electron) return;
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return;
    const u = JSON.parse(raw);
    if (u && u.logoutOnClose) {
      localStorage.removeItem("user");
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
    }
  } catch {
    // Bad JSON — clear it. We'd rather force a fresh login than read garbage.
    localStorage.removeItem("user");
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  }
})();

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState<string | null>(localStorage.getItem("access_token"));
  const [user, setUser] = useState<User | null>(localStorage.getItem("user") ? JSON.parse(localStorage.getItem("user") as string) : null);

  const login = (newToken: string, refreshToken: string, user: User) => {
    setToken(newToken);
    setUser(user);
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("access_token", newToken);
    localStorage.setItem("refresh_token", refreshToken);
  };

  const updateUser = (patch: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem("user", JSON.stringify(next));
      return next;
    });
  };

  const logout = () => {
    // Best-effort server-side session revoke. keepalive lets the request
    // complete even if the page navigates away right after; local state is
    // cleared either way so the UI returns to signed-out immediately.
    const stored = localStorage.getItem("access_token");
    if (stored) {
      fetch(`${API_BASE}/api/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${stored}` },
        keepalive: true,
      }).catch(() => {});
    }
    setToken(null);
    setUser(null);
    localStorage.removeItem("user");
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
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
