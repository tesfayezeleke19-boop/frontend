/**
 * Authentication repository — sign-in, sessions, sign-out,
 * and administrator user management through the CodeIgniter API.
 *
 * File: frontend/src/services/auth/authRepository.ts
 *
 * User-management data is fetched from the backend. localStorage is used
 * only to cache the current authentication session.
 */
import { DEV_USERS, type DevUser } from "./mockUsers";
import {
  USER_ROLES,
  type AuthSession,
  type AuthUser,
  type UserRole,
} from "./types";

const SESSION_KEY = "nexerp.auth.session.v1";

const DEFAULT_API_BASE_URL =
  "https://backend-production-ac8a256f.up.railway.app";

function getBaseUrl(): string {
  return (
    import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL
  ).replace(/\/+$/, "");
}

function apiUrl(path: string): string {
  return `${getBaseUrl()}/${path.replace(/^\/+/, "")}`;
}

export type AccountStatus = "ACTIVE" | "DISABLED";

export interface ManagedAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  accountStatus: AccountStatus;
  createdAt: number;
  createdBy?: string;
  updatedAt: number;
  updatedBy?: string;
}

export interface AuthAuditEntry {
  id: string;
  timestamp: number;
  actorId: string;
  actorEmail: string;
  action:
    | "USER_CREATED"
    | "USER_UPDATED"
    | "ROLE_CHANGED"
    | "ACCOUNT_DISABLED"
    | "ACCOUNT_REACTIVATED"
    | "PASSWORD_RESET_INITIATED"
    | "UNAUTHORIZED_ACTION_BLOCKED";
  targetUserId?: string;
  targetEmail?: string;
  outcome: "SUCCESS" | "BLOCKED" | "FAILED";
  details?: string;
}

export interface ManagedAccountRepository {
  listAccounts(caller: AuthSession | null): Promise<ManagedAccount[]>;

  createAccount(
    caller: AuthSession | null,
    input: {
      name: string;
      email: string;
      role: UserRole;
      department?: string;
      /**
       * Required by the current backend controller.
       * Update the Admin Users form to collect this value.
       */
      initialPassword?: string;
    },
  ): Promise<ManagedAccount>;

  updateAccount(
    caller: AuthSession | null,
    id: string,
    input: {
      name?: string;
      department?: string;
      role?: UserRole;
    },
  ): Promise<ManagedAccount>;

  setAccountStatus(
    caller: AuthSession | null,
    id: string,
    status: AccountStatus,
  ): Promise<ManagedAccount>;

  initiatePasswordReset(
    caller: AuthSession | null,
    id: string,
  ): Promise<{ initiated: boolean; requiresBackend: true }>;

  getAuditLog(caller: AuthSession | null): Promise<AuthAuditEntry[]>;

  revalidateSession(session: AuthSession): AuthSession | null;
}

export interface AuthRepository {
  signIn(email: string, password: string): Promise<AuthSession>;
  getSession(): AuthSession | null;
  signOut(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

type Listener = () => void;

type ApiRecord = Record<string, unknown>;

export class MockAuthRepository
  implements AuthRepository, ManagedAccountRepository
{
  private listeners = new Set<Listener>();

  /* -------------------------------------------------------------- */
  /* Shared API helpers                                               */
  /* -------------------------------------------------------------- */

  private async request<T>(
    path: string,
    caller: AuthSession | null,
    options: RequestInit = {},
  ): Promise<T> {
    this.requireAdminCaller(caller);

    const token = caller?.token;

    if (!token) {
      throw new PermissionDeniedError(
        "Your session has no authentication token. Please sign in again.",
      );
    }

    let response: Response;

    try {
      response = await fetch(apiUrl(path), {
        ...options,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...options.headers,
        },
      });
    } catch {
      throw new Error(
        "Cannot connect to the backend. Check that CodeIgniter is running and the API URL is correct.",
      );
    }

    const result: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const body = isRecord(result) ? result : {};
      const message =
        typeof body.message === "string"
          ? body.message
          : response.status === 401
            ? "Your session has expired or been revoked. Please sign in again."
            : response.status === 403
              ? "You are not authorized to perform this operation."
              : `The server returned HTTP ${response.status}.`;

      if (response.status === 401 || response.status === 403) {
        throw new PermissionDeniedError(message);
      }

      if (response.status === 400 || response.status === 422) {
        throw new ValidationError(message);
      }

      throw new Error(message);
    }

    return result as T;
  }

  private requireAdminCaller(caller: AuthSession | null): void {
    if (!caller || caller.isGuest) {
      throw new PermissionDeniedError("Authentication required.");
    }

    if (caller.user.role !== USER_ROLES.ADMIN) {
      throw new PermissionDeniedError("Admin role required.");
    }

    if (
      caller.expiresAt &&
      Date.parse(caller.expiresAt) <= Date.now()
    ) {
      writeSession(null);
      this.notify();

      throw new PermissionDeniedError(
        "Your session has expired. Please sign in again.",
      );
    }
  }

  private unwrapList(
    result: unknown,
    possibleKeys: string[],
  ): ApiRecord[] {
    if (Array.isArray(result)) {
      return result.filter(isRecord);
    }

    if (!isRecord(result)) {
      throw new Error("The server returned an invalid API response.");
    }

    for (const key of possibleKeys) {
      const value = result[key];

      if (Array.isArray(value)) {
        return value.filter(isRecord);
      }
    }

    throw new Error(
      "The server response did not contain the expected list.",
    );
  }

  /* -------------------------------------------------------------- */
  /* Sign-in and sessions                                             */
  /* -------------------------------------------------------------- */

  async signIn(email: string, password: string): Promise<AuthSession> {
    let response: Response;

    try {
      response = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });
    } catch {
      throw new Error(
        "Cannot connect to the authentication server. Check that the backend is running.",
      );
    }

    const result: unknown = await response.json().catch(() => null);
    const body = isRecord(result) ? result : {};

    if (
      !response.ok ||
      body.success !== true ||
      !body.token ||
      !isRecord(body.user)
    ) {
      throw new Error(
        typeof body.message === "string"
          ? body.message
          : "Invalid email or password.",
      );
    }

    const apiUser = body.user;
    const validRoles: UserRole[] = [
      USER_ROLES.ADMIN,
      USER_ROLES.SALES,
      USER_ROLES.FINANCE,
      USER_ROLES.HR,
    ];

    if (!validRoles.includes(apiUser.role as UserRole)) {
      throw new Error("The server returned an unsupported user role.");
    }

    const session: AuthSession = {
      user: {
        id: String(apiUser.id),
        name: String(apiUser.display_name),
        email: String(apiUser.email),
        role: apiUser.role as UserRole,
        department: String(apiUser.department ?? ""),
        accountStatus: "ACTIVE",
      },
      isGuest: false,
      signedInAt: Date.now(),
      token: String(body.token),
      expiresAt: body.expires_at
        ? String(body.expires_at)
        : undefined,
    };

    writeSession(session);
    this.notify();

    return session;
  }

  getSession(): AuthSession | null {
    return readSession();
  }

  async signOut(): Promise<void> {
    // Clear the browser session immediately.
    // Server-side session revocation can be added to the backend logout route.
    writeSession(null);
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  /* -------------------------------------------------------------- */
  /* List accounts                                                    */
  /* -------------------------------------------------------------- */

  async listAccounts(
    caller: AuthSession | null,
  ): Promise<ManagedAccount[]> {
    const result = await this.request<unknown>(
      "/api/admin/users",
      caller,
      { method: "GET" },
    );

    return this.unwrapList(result, ["users", "accounts", "data"])
      .map(mapAccount)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /* -------------------------------------------------------------- */
  /* Create account                                                   */
  /* -------------------------------------------------------------- */

  async createAccount(
    caller: AuthSession | null,
    input: {
      name: string;
      email: string;
      role: UserRole;
      department?: string;
      initialPassword?: string;
    },
  ): Promise<ManagedAccount> {
    this.requireAdminCaller(caller);

    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();

    if (!name) {
      throw new ValidationError("Name is required.");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ValidationError("A valid email address is required.");
    }

    if (!SUPPORTED_CREATE_ROLES.includes(input.role)) {
      throw new PermissionDeniedError(
        "This role cannot be assigned with current permissions.",
      );
    }

    if (!input.initialPassword) {
      throw new ValidationError(
        "An initial password is required. Add an initial-password field to the Create User form.",
      );
    }

    if (input.initialPassword.length < 12) {
      throw new ValidationError(
        "The initial password must contain at least 12 characters.",
      );
    }

    const result = await this.request<unknown>(
      "/api/admin/users",
      caller,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          role: input.role,
          department: input.department?.trim() || roleDepartment(input.role),
          initialPassword: input.initialPassword,
        }),
      },
    );

    const record = extractRecord(result, ["user", "account", "data"]);
    const account = mapAccount(record);

    this.notify();

    return account;
  }

  /* -------------------------------------------------------------- */
  /* Update account                                                   */
  /* -------------------------------------------------------------- */

  async updateAccount(
    caller: AuthSession | null,
    id: string,
    input: {
      name?: string;
      department?: string;
      role?: UserRole;
    },
  ): Promise<ManagedAccount> {
    this.requireAdminCaller(caller);

    if (!id.trim()) {
      throw new ValidationError("A user ID is required.");
    }

    if (
      input.role !== undefined &&
      !SUPPORTED_CREATE_ROLES.includes(input.role)
    ) {
      throw new PermissionDeniedError(
        "This role cannot be assigned with current permissions.",
      );
    }

    const payload: ApiRecord = {};

    if (input.name !== undefined) {
      const name = input.name.trim();

      if (!name) {
        throw new ValidationError("Name is required.");
      }

      payload.name = name;
    }

    if (input.department !== undefined) {
      payload.department = input.department.trim();
    }

    if (input.role !== undefined) {
      payload.role = input.role;
    }

    const result = await this.request<unknown>(
      `/api/admin/users/${encodeURIComponent(id)}`,
      caller,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );

    const account = mapAccount(
      extractRecord(result, ["user", "account", "data"]),
    );

    this.notify();

    return account;
  }

  /* -------------------------------------------------------------- */
  /* Disable / reactivate account                                     */
  /* -------------------------------------------------------------- */

  async setAccountStatus(
    caller: AuthSession | null,
    id: string,
    status: AccountStatus,
  ): Promise<ManagedAccount> {
    this.requireAdminCaller(caller);

    if (!id.trim()) {
      throw new ValidationError("A user ID is required.");
    }

    if (caller?.user.id === id) {
      throw new ValidationError(
        "You cannot change your own account status.",
      );
    }

    if (status !== "ACTIVE" && status !== "DISABLED") {
      throw new ValidationError("Invalid account status.");
    }

    const result = await this.request<unknown>(
      `/api/admin/users/${encodeURIComponent(id)}/status`,
      caller,
      {
        method: "PATCH",
        body: JSON.stringify({ status }),
      },
    );

    const account = mapAccount(
      extractRecord(result, ["user", "account", "data"]),
    );

    this.notify();

    return account;
  }

  /* -------------------------------------------------------------- */
  /* Password reset                                                   */
  /* -------------------------------------------------------------- */

  async initiatePasswordReset(
    caller: AuthSession | null,
    id: string,
  ): Promise<{ initiated: boolean; requiresBackend: true }> {
    this.requireAdminCaller(caller);

    if (!id.trim()) {
      throw new ValidationError("A user ID is required.");
    }

    const result = await this.request<unknown>(
      `/api/admin/users/${encodeURIComponent(id)}/password-reset`,
      caller,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );

    const body = isRecord(result) ? result : {};

    if (body.success === false || body.initiated === false) {
      return {
        initiated: false,
        requiresBackend: true,
      };
    }

    // A successful response means the endpoint accepted the operation.
    // It does not, by itself, prove that an email was delivered.
    return {
      initiated: true,
      requiresBackend: true,
    };
  }

  /* -------------------------------------------------------------- */
  /* Audit log                                                        */
  /* -------------------------------------------------------------- */

  async getAuditLog(
    caller: AuthSession | null,
  ): Promise<AuthAuditEntry[]> {
    const result = await this.request<unknown>(
      "/api/admin/users/audit",
      caller,
      { method: "GET" },
    );

    return this.unwrapList(result, ["audit", "logs", "data"])
      .map(mapAuditEntry)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /* -------------------------------------------------------------- */
  /* Cached session revalidation                                     */
  /* -------------------------------------------------------------- */

  revalidateSession(session: AuthSession): AuthSession | null {
    if (!session) return null;

    if (session.isGuest) {
      return session;
    }

    if (
      session.expiresAt &&
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      writeSession(null);
      this.notify();
      return null;
    }

    /*
     * This method is synchronous to preserve the existing interface.
     * It cannot verify a token against PostgreSQL by itself.
     *
     * The protected API endpoints validate the bearer token against
     * user_sessions and users. A 401 response from those endpoints means
     * the frontend should send the user back to sign-in.
     */
    return session;
  }
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/* ------------------------------------------------------------------ */
/* Roles and departments                                               */
/* ------------------------------------------------------------------ */

export const SUPPORTED_CREATE_ROLES: UserRole[] = [
  USER_ROLES.SALES,
  USER_ROLES.FINANCE,
  USER_ROLES.HR,
  USER_ROLES.ADMIN,
];

export function roleDepartment(role: UserRole): string {
  if (role === USER_ROLES.FINANCE) return "Finance";
  if (role === USER_ROLES.HR) return "Human Resources";
  if (role === USER_ROLES.ADMIN) return "Administration";
  return "Sales";
}

/* ------------------------------------------------------------------ */
/* API response mapping                                                */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is ApiRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function extractRecord(
  result: unknown,
  possibleKeys: string[],
): ApiRecord {
  if (!isRecord(result)) {
    throw new Error("The server returned an invalid API response.");
  }

  for (const key of possibleKeys) {
    const value = result[key];

    if (isRecord(value)) {
      return value;
    }
  }

  // Some endpoints return the account itself at the top level.
  if ("id" in result) {
    return result;
  }

  throw new Error(
    "The server response did not contain the expected user record.",
  );
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number") {
    return value < 10_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return Date.now();
}

function mapAccount(record: ApiRecord): ManagedAccount {
  const role = String(record.role ?? "").toUpperCase() as UserRole;

  const validRoles: UserRole[] = [
    USER_ROLES.ADMIN,
    USER_ROLES.SALES,
    USER_ROLES.FINANCE,
    USER_ROLES.HR,
  ];

  if (!validRoles.includes(role)) {
    throw new Error(
      `The server returned an unsupported user role: ${String(record.role)}.`,
    );
  }

  const rawStatus = String(
    record.accountStatus ??
      record.account_status ??
      record.status ??
      "ACTIVE",
  ).toUpperCase();

  const accountStatus: AccountStatus =
    rawStatus === "DISABLED" || rawStatus === "INACTIVE"
      ? "DISABLED"
      : "ACTIVE";

  return {
    id: String(record.id ?? record.user_id ?? ""),
    name: String(
      record.name ?? record.display_name ?? record.full_name ?? "",
    ),
    email: String(record.email ?? ""),
    role,
    department: String(record.department ?? ""),
    accountStatus,
    createdAt: parseTimestamp(
      record.createdAt ?? record.created_at,
    ),
    createdBy:
      typeof (record.createdBy ?? record.created_by) === "string"
        ? String(record.createdBy ?? record.created_by)
        : undefined,
    updatedAt: parseTimestamp(
      record.updatedAt ?? record.updated_at ?? record.created_at,
    ),
    updatedBy:
      typeof (record.updatedBy ?? record.updated_by) === "string"
        ? String(record.updatedBy ?? record.updated_by)
        : undefined,
  };
}

function mapAuditEntry(record: ApiRecord): AuthAuditEntry {
  const rawAction = String(record.action ?? "").toUpperCase();
  const detailsValue = record.details;

  const details =
    typeof detailsValue === "string"
      ? detailsValue
      : detailsValue !== undefined && detailsValue !== null
        ? JSON.stringify(detailsValue)
        : undefined;

  const actionMap: Record<string, AuthAuditEntry["action"]> = {
    USER_CREATED: "USER_CREATED",
    USER_UPDATED: "USER_UPDATED",
    ROLE_CHANGED: "ROLE_CHANGED",
    ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
    ACCOUNT_REACTIVATED: "ACCOUNT_REACTIVATED",
    PASSWORD_RESET_INITIATED: "PASSWORD_RESET_INITIATED",
    UNAUTHORIZED_ACTION_BLOCKED: "UNAUTHORIZED_ACTION_BLOCKED",
    CREATE_USER: "USER_CREATED",
    UPDATE_USER: "USER_UPDATED",
    CHANGE_ROLE: "ROLE_CHANGED",
    DISABLE_USER: "ACCOUNT_DISABLED",
    REACTIVATE_USER: "ACCOUNT_REACTIVATED",
    PASSWORD_RESET: "PASSWORD_RESET_INITIATED",
  };

  const action =
    actionMap[rawAction] ?? "USER_UPDATED";

  const rawOutcome = String(record.outcome ?? "SUCCESS").toUpperCase();

  const outcome: AuthAuditEntry["outcome"] =
    rawOutcome === "BLOCKED"
      ? "BLOCKED"
      : rawOutcome === "FAILED"
        ? "FAILED"
        : "SUCCESS";

  const targetId =
    record.targetUserId ??
    record.target_id ??
    record.targetId;

  const targetEmail =
    record.targetEmail ??
    record.target_email ??
    (isRecord(detailsValue) ? detailsValue.email : undefined);

  return {
    id: String(record.id ?? ""),
    timestamp: parseTimestamp(
      record.timestamp ?? record.created_at ?? record.createdAt,
    ),
    actorId: String(
      record.actorId ?? record.actor_user_id ?? "",
    ),
    actorEmail: String(
      record.actorEmail ?? record.actor_email ?? "",
    ),
    action,
    targetUserId:
      targetId === undefined || targetId === null
        ? undefined
        : String(targetId),
    targetEmail:
      targetEmail === undefined || targetEmail === null
        ? undefined
        : String(targetEmail),
    outcome,
    details,
  };
}

/* ------------------------------------------------------------------ */
/* Session storage                                                     */
/* ------------------------------------------------------------------ */

function readSession(): AuthSession | null {
  try {
    if (typeof localStorage === "undefined") return null;

    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    const session = JSON.parse(raw) as AuthSession;

    if (
      session.expiresAt &&
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

function writeSession(session: AuthSession | null): void {
  try {
    if (typeof localStorage === "undefined") return;

    if (session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Storage can be unavailable in restricted browser environments.
  }
}

/** The single auth repository instance used by the application. */
export const authRepository: MockAuthRepository =
  new MockAuthRepository();

export type { AuthSession, AuthUser, UserRole };
export { USER_ROLES };
export type { DevUser };
