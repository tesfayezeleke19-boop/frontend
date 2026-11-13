/**
 * Shared user-profile helpers — the ONE place the frontend decides how a
 * signed-in person's name, email, and initials are displayed.
 *
 * The user model (`AuthUser`) already carries a stable id, a display/full
 * name (`name`), an email, and a role. `name` is the full display name; the
 * future PHP/Django API may store first/last name separately and must return
 * it in `display_name` (see docs/api-contracts.md).
 *
 * Rules:
 *   - Never render raw undefined/null for a missing name or email.
 *   - Never invent a person's name.
 *   - Email is display data from the trusted session source; a client-supplied
 *     email is never proof of identity.
 */
import type { AuthUser, UserRole } from "./types";

export interface UserProfile {
  id: string;
  /** Full display name, resolved from the session (never invented). */
  fullName: string;
  /** Email from the trusted user source, or "" when the provider omits it. */
  email: string;
  role: UserRole;
  department: string;
  accountStatus?: AuthUser["accountStatus"];
}

export const UNNAMED_USER = "Unnamed user";
export const NO_EMAIL = "Not provided";

/** Full display name with a neutral fallback (email, then "Unnamed user"). */
export function displayNameOf(
  name?: string | null,
  email?: string | null,
): string {
  const trimmedName = name?.trim();
  if (trimmedName) return trimmedName;
  const trimmedEmail = email?.trim();
  if (trimmedEmail) return trimmedEmail;
  return UNNAMED_USER;
}

/** Safe email label — used for display only, never for authorization. */
export function displayEmail(email?: string | null): string {
  const trimmed = email?.trim();
  return trimmed || NO_EMAIL;
}

/**
 * Identity used in audit/status fields ("Recorded by", "Reviewed by"). The
 * email is preferred because it is stable and unique; the full name is the
 * fallback, then a caller-provided neutral label.
 */
export function actorLabel(
  user: Pick<AuthUser, "name" | "email"> | null | undefined,
  fallback = "User",
): string {
  return user?.email?.trim() || user?.name?.trim() || fallback;
}

/** Map the session user to the stable frontend profile representation. */
export function toUserProfile(
  user: AuthUser | null | undefined,
): UserProfile | null {
  if (!user) return null;
  return {
    id: user.id,
    fullName: displayNameOf(user.name, user.email),
    email: user.email?.trim() ?? "",
    role: user.role,
    department: user.department,
    accountStatus: user.accountStatus,
  };
}

/** One or two uppercase initials for avatars. */
export function initialsOf(
  user: Pick<AuthUser, "name" | "email"> | null | undefined,
): string {
  const label = displayNameOf(user?.name, user?.email);
  if (label === UNNAMED_USER) return "?";
  const parts = label
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2);
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join("");
  return initials || "?";
}
