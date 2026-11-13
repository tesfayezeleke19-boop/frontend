/**
 * Typed API errors for the future PHP / Django REST backend.
 *
 * The UI should never receive a raw fetch failure or parse HTTP status codes
 * itself. The API client turns every failure into one of these errors, and
 * semantic helpers (`isUnauthorizedError`, `apiErrorMessage`) let pages show
 * consistent messages and handle session expiry centrally.
 */

export type ApiErrorKind =
  | "config"
  | "network"
  | "timeout"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limit"
  | "client"
  | "server"
  | "parse"
  | "not_implemented";

export interface ApiErrorOptions {
  kind: ApiErrorKind;
  message: string;
  status?: number;
  /** Backend error code, e.g. "EXPENSE_ALREADY_APPROVED". */
  code?: string;
  /** Structured field errors from a validation response. */
  fieldErrors?: Record<string, string>;
  /** Raw parsed response body, for diagnostics only — never rendered raw. */
  details?: unknown;
  requestId?: string;
  retryable?: boolean;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly fieldErrors?: Record<string, string>;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly retryable: boolean;

  constructor(options: ApiErrorOptions) {
    super(options.message);
    this.name = "ApiError";
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
    this.requestId = options.requestId;
    this.retryable =
      options.retryable ??
      ["network", "timeout", "rate_limit", "server"].includes(options.kind);
  }
}

/** 422 — request understood but field/business validation failed. */
export class ApiValidationError extends ApiError {
  constructor(options: Omit<ApiErrorOptions, "kind">) {
    super({ ...options, kind: "validation", status: options.status ?? 422 });
    this.name = "ApiValidationError";
  }
}

/** Thrown when the API base URL has not been configured yet. */
export class ApiConfigurationError extends ApiError {
  constructor(message: string) {
    super({ kind: "config", message, retryable: false });
    this.name = "ApiConfigurationError";
  }
}

/**
 * Thrown by documented-but-not-yet-implemented integration points. Never
 * used to pretend an endpoint exists — see docs/backend-integration.md.
 */
export class ApiNotImplementedError extends ApiError {
  constructor(message: string) {
    super({ kind: "not_implemented", message, retryable: false });
    this.name = "ApiNotImplementedError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isUnauthorizedError(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Normalize common Laravel / Django REST validation payload shapes. */
function parseFieldErrors(body: unknown): Record<string, string> | undefined {
  if (!isRecord(body)) return undefined;
  const source =
    isRecord(body.errors) ? body.errors : isRecord(body.field_errors) ? body.field_errors : null;
  if (!source) return undefined;
  const fieldErrors: Record<string, string> = {};
  for (const [field, value] of Object.entries(source)) {
    if (typeof value === "string") fieldErrors[field] = value;
    else if (Array.isArray(value) && typeof value[0] === "string") {
      fieldErrors[field] = value[0];
    }
  }
  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
}

function readMessage(body: unknown): string | undefined {
  if (typeof body === "string") return body.trim() || undefined;
  if (!isRecord(body)) return undefined;
  return (
    readString(body.message) ??
    readString(body.error) ??
    readString(body.detail) ??
    readString(body.title)
  );
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "client";
}

/** Build a typed error from a non-2xx HTTP response. */
export function apiErrorFromResponse(
  status: number,
  body: unknown,
  requestId?: string,
): ApiError {
  const kind = kindForStatus(status);
  const fieldErrors = kind === "validation" ? parseFieldErrors(body) : undefined;
  const code =
    isRecord(body) && typeof body.code === "string" ? body.code : undefined;
  const message =
    readMessage(body) ??
    (kind === "unauthorized"
      ? "Your session has expired. Please sign in again."
      : kind === "forbidden"
        ? "You do not have permission to perform this action."
        : kind === "not_found"
          ? "The requested record could not be found."
          : kind === "conflict"
            ? "This record was changed by someone else. Reload and try again."
            : kind === "rate_limit"
              ? "Too many requests. Please wait a moment and try again."
              : kind === "server"
                ? "The server could not complete the request. Please try again."
                : `Request failed (HTTP ${status}).`);

  if (kind === "validation") {
    return new ApiValidationError({ message, status, code, fieldErrors, details: body, requestId });
  }
  return new ApiError({ kind, message, status, code, details: body, requestId });
}

/**
 * User-facing message for any thrown value. Keeps unexpected errors generic
 * instead of leaking stack traces or raw backend payloads into the UI.
 */
export function apiErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (isApiError(error)) {
    if (error.kind === "config") return "API access is not configured yet.";
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
