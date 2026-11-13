
import { authRepository } from "@/services/auth";
import type { AuthSession, AuthUser } from "@/services/auth";
import { useCallback, useEffect, useState } from "react";

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(() =>
    authRepository.getSession(),
  );

  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    return authRepository.subscribe(() => {
      setSession(authRepository.getSession());
    });
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);

      try {
        const next = await authRepository.signIn(email, password);
        setSession(next);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    await authRepository.signOut();
    setSession(null);
  }, []);

  return {
    isLoading,
    isAuthenticated: session !== null,
    user: session?.user ?? null,
    session,
    signIn,
    signOut,
  };
}

export type { AuthSession, AuthUser };
