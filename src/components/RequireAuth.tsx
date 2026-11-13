import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { authRepository } from "@/services/auth";
import { USER_ROLES, USER_ROLE_LABELS } from "@/services/auth";
import { displayNameOf } from "@/services/auth/profile";
import type { UserRole } from "@/services/auth";
import { Loader2, LogOut, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

interface RequireAuthProps {
  /** The role allowed on this route group (e.g. SALES or FINANCE). */
  role: UserRole;
  /**
   * Allow demo guests (development/demo access only). Guests never get
   * privileged Finance actions, so Finance routes never pass allowGuest.
   */
  allowGuest?: boolean;
  children: ReactNode;
}

const PORTAL_LABELS: Record<UserRole, string> = {
  [USER_ROLES.SALES]: "Sales Portal",
  [USER_ROLES.FINANCE]: "Finance Portal",
  [USER_ROLES.HR]: "HR Portal",
  [USER_ROLES.ADMIN]: "Admin Portal",
};

const PORTAL_PATHS: Record<UserRole, string> = {
  [USER_ROLES.SALES]: "/sales",
  [USER_ROLES.FINANCE]: "/finance",
  [USER_ROLES.HR]: "/hr",
  [USER_ROLES.ADMIN]: "/admin",
};

/**
 * Protects a portal's routes.
 *
 * - No session          → redirect to /auth with the intended destination.
 * - Wrong role          → blocked with an "Access restricted" screen and a
 *                         link to the user's own portal (or sign out).
 * - Demo guest          → only allowed on Sales when allowGuest is set;
 *                         never on Finance.
 */
export function RequireAuth({ role, allowGuest = false, children }: RequireAuthProps) {
  const { isLoading, session: cachedSession, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Revalidate the cached session against the current account status on
  // every protected-route render: a session belonging to an account an
  // Admin has since disabled is rejected here, even though the browser
  // still holds the old session. (With the real backend, token/session
  // revocation will make this immediate.)
  const session = cachedSession ? authRepository.revalidateSession(cachedSession) : null;

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </main>
    );
  }

  if (!session) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  // Admin can only access /admin — each portal is role-locked.
  const roleAllowed = session.user.role === role;
  const guestAllowed =
    allowGuest && session.isGuest && role === USER_ROLES.SALES;

  if (!roleAllowed && !guestAllowed) {
    const portalLabel = PORTAL_LABELS[role];
    const otherPortalPath = PORTAL_PATHS[session.user.role];
    return (
      <main className="bg-grid flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-destructive-border bg-destructive-soft">
            <ShieldAlert className="size-6 text-destructive" />
          </div>
          <h1 className="mt-5 font-heading text-2xl font-semibold text-foreground">
            Access restricted
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The {portalLabel} requires a{" "}
            <span className="font-medium text-foreground">
              {USER_ROLE_LABELS[role]}
            </span>{" "}
            account. You are signed in as{" "}
            <span className="font-medium text-foreground">
              {displayNameOf(session.user.name, session.user.email)}
            </span>{" "}
            ({session.user.role}
            {session.isGuest ? ", demo guest" : ""}).
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button
              onClick={() => navigate(otherPortalPath)}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Go to {PORTAL_LABELS[session.user.role]}
            </Button>
            <Button
              onClick={async () => {
                await signOut();
                navigate("/auth");
              }}
              variant="outline"
              className="gap-2 border-input text-foreground hover:bg-accent"
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return children;
}
