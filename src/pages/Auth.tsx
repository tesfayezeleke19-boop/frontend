
import { BrandLogo } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { useAuth } from "@/hooks/use-auth";
import { USER_ROLES } from "@/services/auth";
import type { UserRole } from "@/services/auth";
import { ArrowRight, Loader2, Mail, Lock } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

/** Home portal for a role — each portal maps to its own route. */
function portalForRole(role: UserRole | undefined): string {
  if (role === USER_ROLES.FINANCE) return "/finance";
  if (role === USER_ROLES.HR) return "/hr";
  if (role === USER_ROLES.ADMIN) return "/admin";
  return "/sales";
}

/**
 * Resolve where to send the user after sign-in.
 * Users are redirected only to their own role's portal.
 */
function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback: string | undefined,
  role: UserRole | undefined,
): string {
  const raw =
    returnTo?.startsWith("/") && !returnTo.startsWith("//")
      ? returnTo
      : fallback ?? portalForRole(role);

  if (!role) return raw;

  const portal = portalForRole(role);

  if (raw === portal || raw.startsWith(`${portal}/`)) {
    return raw;
  }

  return portal;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const {
    isLoading: authLoading,
    isAuthenticated,
    session,
    signIn,
  } = useAuth();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
    session?.user.role,
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect, { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    setIsLoading(true);
    setError(null);

    try {
      await signIn(email, password);
      // The effect above redirects after authentication is established.
    } catch (signInError) {
      console.error("Sign-in error:", signInError);

      setError(
        signInError instanceof Error
          ? signInError.message
          : "Unable to sign in. Please try again.",
      );

      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Brand header */}
      <header className="flex items-center justify-between px-6 py-5">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-3 text-left"
        >
          <div>
            <div className="font-heading text-base font-semibold leading-none tracking-tight text-foreground">
              HATI PLC
            </div>

            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
              Enterprise Resource Planning
            </div>
          </div>
        </button>

        <ThemeToggle />
      </header>

      
      {/* Sign-in form */}
      <div className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-[380px]">
          {/* Logo outside the login card */}
          <div className="mb-3 flex items-center justify-center">
            <BrandLogo size={200} />
          </div>

          <Card className="w-full border border-border bg-card shadow-none">
            <CardHeader className="items-center text-center">
              <CardTitle className="font-heading text-xl font-semibold text-foreground">
                Welcome
              </CardTitle>
            </CardHeader>

            <form onSubmit={handleSubmit}>
              <CardContent>
                <div className="space-y-3">
                  {/* Email */}
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />

                    <Input
                      name="email"
                      placeholder="name@company.com"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="h-10 border-input bg-popover pl-9 text-sm text-foreground placeholder:text-muted-foreground/70"
                      disabled={isLoading}
                      required
                    />
                  </div>

                  {/* Password */}
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />

                    <Input
                      name="password"
                      placeholder="Password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-10 border-input bg-popover pl-9 text-sm text-foreground placeholder:text-muted-foreground/70"
                      disabled={isLoading}
                      required
                    />
                  </div>
                </div>

                {/* Sign-in error */}
                {error && (
                  <p
                    role="alert"
                    className="mt-2 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}

                {/* Submit */}
                <Button
                  type="submit"
                  className="mt-4 w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={isLoading || authLoading}
                >
                  {isLoading || authLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      Sign In
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>
              </CardContent>
            </form>
          </Card>
        </div>
      </div>

    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense fallback={null}>
      <Auth {...props} />
    </Suspense>
  );
}
