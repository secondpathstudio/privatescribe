import { createContext, useContext, useState } from "react";
import KeyExportBanner from "@/components/admin/KeyExportBanner";

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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
    setToken(null);
    setUser(null);
    localStorage.removeItem("user");
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout, updateUser }}>
      <KeyExportBanner />
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
