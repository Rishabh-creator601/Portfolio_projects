'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, get, post, setAccessToken, setSessionExpiredHandler } from './api';
import type { User, UserRole } from '@/types/user';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface SignupInput {
  displayName: string;
  email: string;
  password: string;
  jurisdiction?: string;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (input: SignupInput) => Promise<User>;
  resumeSession: () => Promise<User | null>;
  logout: (options?: { everywhere?: boolean }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string>;
  refreshUser: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// The access token lives for 15 minutes; refresh a minute early so an in-flight
// request never races the expiry.
const REFRESH_INTERVAL_MS = 14 * 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleSilentRefresh = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      try {
        const session = await post<LoginResponse>('/auth/refresh');
        setAccessToken(session.accessToken);
        if (session.user) setUser(session.user);
      } catch {
        clearSession();
      }
    }, REFRESH_INTERVAL_MS);
  }, [clearSession]);

  // On mount, try to resume the session from the httpOnly refresh cookie.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const session = await post<LoginResponse>('/auth/refresh');
        if (cancelled) return;
        setAccessToken(session.accessToken);
        setUser(session.user ?? (await get<User>('/auth/me')));
        scheduleSilentRefresh();
      } catch {
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearSession, scheduleSilentRefresh]);

  // When a refresh finally fails mid-session, drop the user back to sign-in.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      clearSession();
      router.replace('/login?expired=1');
    });
    return () => setSessionExpiredHandler(null);
  }, [clearSession, router]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await post<LoginResponse>('/auth/login', { email, password });
      setAccessToken(session.accessToken);
      setUser(session.user);
      scheduleSilentRefresh();
      return session.user;
    },
    [scheduleSilentRefresh]
  );

  const signup = useCallback(
    async ({ displayName, email, password, jurisdiction }: SignupInput) => {
      const session = await post<LoginResponse>('/auth/signup', {
        displayName,
        email,
        password,
        ...(jurisdiction ? { jurisdiction } : {}),
      });
      setAccessToken(session.accessToken);
      setUser(session.user);
      scheduleSilentRefresh();
      return session.user;
    },
    [scheduleSilentRefresh]
  );

  /**
   * Adopts the session the API just established out-of-band. The Google
   * callback lands with only the httpOnly refresh cookie set, so the app trades
   * it for an access token instead of reading anything out of the URL.
   */
  const resumeSession = useCallback(async () => {
    try {
      const session = await post<LoginResponse>('/auth/refresh');
      setAccessToken(session.accessToken);
      const nextUser = session.user ?? (await get<User>('/auth/me'));
      setUser(nextUser);
      scheduleSilentRefresh();
      return nextUser;
    } catch {
      clearSession();
      return null;
    }
  }, [clearSession, scheduleSilentRefresh]);

  const logout = useCallback(
    async ({ everywhere = false }: { everywhere?: boolean } = {}) => {
      try {
        await post(everywhere ? '/auth/logout-all' : '/auth/logout');
      } catch {
        // Signing out locally must succeed even if the API call fails.
      }
      clearSession();
      router.replace('/login');
    },
    [clearSession, router]
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const result = await post<{ message: string }>('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      // The server revokes every session on a password change.
      clearSession();
      return result.message;
    },
    [clearSession]
  );

  const refreshUser = useCallback(async () => {
    try {
      setUser(await get<User>('/auth/me'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) clearSession();
    }
  }, [clearSession]);

  const hasRole = useCallback((...roles: UserRole[]) => !!user && roles.includes(user.role), [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      signup,
      resumeSession,
      logout,
      changePassword,
      refreshUser,
      hasRole,
    }),
    [user, isLoading, login, signup, resumeSession, logout, changePassword, refreshUser, hasRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
