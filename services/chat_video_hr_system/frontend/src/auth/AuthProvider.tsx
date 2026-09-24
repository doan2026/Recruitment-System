import React, { createContext, useContext, useEffect, useState } from 'react';
import { authApi, User } from '../api/auth';
import { getAccessToken, setAccessToken } from '../api/client';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (email: string, pass: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  token: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Initialize session from httpOnly refresh cookie
  useEffect(() => {
    const initAuth = async () => {
      try {
        const newAccessToken = await authApi.refresh();
        if (newAccessToken) {
          setAccessToken(newAccessToken);
          setTokenState(newAccessToken);
          const profile = await authApi.getMe();
          setUser(profile);
        }
      } catch {
        setUser(null);
        setTokenState(null);
        setAccessToken(null);
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  const login = async (email: string, pass: string) => {
    const res = await authApi.login(email, pass);
    setAccessToken(res.access_token);
    setTokenState(res.access_token);
    setUser(res.user);
  };

  const register = async (email: string, pass: string, name: string) => {
    const res = await authApi.register(email, pass, name);
    setAccessToken(res.access_token);
    setTokenState(res.access_token);
    setUser(res.user);
  };

  const logout = async () => {
    await authApi.logout();
    setAccessToken(null);
    setTokenState(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        token: token || getAccessToken(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
