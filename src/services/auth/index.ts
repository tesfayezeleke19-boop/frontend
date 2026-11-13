/**
 * Auth service layer — the only way the UI signs in, signs out, and reads
 * the session. Swapping the temporary mock implementation for the PHP auth
 * API later means replacing `authRepository`, not the pages.
 */
export { authRepository, type AuthRepository } from "./authRepository";
export {
  SUPPORTED_CREATE_ROLES,
  PermissionDeniedError,
  ValidationError,
  roleDepartment,
  type ManagedAccount,
  type ManagedAccountRepository,
  type AuthAuditEntry,
  type AccountStatus,
} from "./authRepository";
export { DEV_PASSWORD, DEV_USERS, type DevUser } from "./mockUsers";
export {
  USER_ROLES,
  USER_ROLE_LABELS,
  type AuthSession,
  type AuthUser,
  type UserRole,
} from "./types";
export {
  NO_EMAIL,
  UNNAMED_USER,
  actorLabel,
  displayEmail,
  displayNameOf,
  initialsOf,
  toUserProfile,
  type UserProfile,
} from "./profile";
