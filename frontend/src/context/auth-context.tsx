import { createContext, useContext, useState, useEffect } from "react";

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, refreshToken: string, user: User) => void;
  logout: () => void;
}

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  lastLogin: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState<string | null>(localStorage.getItem("access_token"));
  const [user, setUser] = useState<User | null>(localStorage.getItem("user") ? JSON.parse(localStorage.getItem("user") as string) : null);

  // useEffect(() => {
  //   console.log('user changed', user);
  // }, [user])

  const login = (newToken: string, refreshToken: string, user: User) => {
    console.log('user logging in', user);
    setToken(newToken);
    setUser(user);
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("access_token", newToken);
    localStorage.setItem("refresh_token", refreshToken);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("user");
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
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
