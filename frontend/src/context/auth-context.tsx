import { createContext, useContext, useState } from "react";
import BackupKeyModal from "@/components/admin/BackupKeyModal";
import KeyExportBanner from "@/components/admin/KeyExportBanner";

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, refreshToken: string, user: User, backupKey?: string) => void;
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState<string | null>(localStorage.getItem("access_token"));
  const [user, setUser] = useState<User | null>(localStorage.getItem("user") ? JSON.parse(localStorage.getItem("user") as string) : null);
  // In-memory only — never persisted. Cleared on acknowledge or full reload.
  const [pendingBackupKey, setPendingBackupKey] = useState<string | null>(null);

  const login = (newToken: string, refreshToken: string, user: User, backupKey?: string) => {
    setToken(newToken);
    setUser(user);
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("access_token", newToken);
    localStorage.setItem("refresh_token", refreshToken);
    if (backupKey) setPendingBackupKey(backupKey);
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
    setToken(null);
    setUser(null);
    setPendingBackupKey(null);
    localStorage.removeItem("user");
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  };

  const acknowledgeBackupKey = async () => {
    try {
      await fetch("http://127.0.0.1:5000/api/acknowledge-backup-key", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } finally {
      // Clear locally even if the server call fails — server-side flag will
      // catch up on next acknowledge attempt; we don't want to trap the user
      // behind a modal because of a transient network error.
      setPendingBackupKey(null);
    }
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout, updateUser }}>
      <KeyExportBanner />
      {children}
      {pendingBackupKey && (
        <BackupKeyModal
          backupKey={pendingBackupKey}
          onAcknowledge={acknowledgeBackupKey}
          blocking
        />
      )}
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
