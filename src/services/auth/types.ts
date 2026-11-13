
/**
 * Authentication domain types.
 */
export const USER_ROLES = {
  SALES: "SALES",
  FINANCE: "FINANCE",
  HR: "HR",
  ADMIN: "ADMIN",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  SALES: "Sales",
  FINANCE: "Finance",
  HR: "Human Resources",
  ADMIN: "Administration",
};

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  accountStatus?: "ACTIVE" | "DISABLED";
}

export interface AuthSession {
  user: AuthUser;
  isGuest: boolean;
  signedInAt: number;

  /** Token returned by the PHP authentication API. */
  token?: string;

  /** Expiration timestamp returned by the PHP authentication API. */
  expiresAt?: string;
}
