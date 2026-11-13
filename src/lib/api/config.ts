/**
 * Central API configuration. This is the ONLY place the frontend reads the
 * backend base URL from — feature files must never hardcode URLs.
 *
 * Vite exposes only variables prefixed with VITE_ to the browser. Those are
 * PUBLIC values: never put database passwords, private API secrets, or admin
 * tokens in them.
 *
 * Required for the future REST backend:
 *   VITE_API_BASE_URL=https://api.example.com        (no trailing slash)
 * Optional:
 *   VITE_API_TIMEOUT_MS=20000
 *   VITE_API_WITH_CREDENTIALS=true                   (cookie/session auth)
 *
 * Until VITE_API_BASE_URL is set, `apiUrl()` throws ApiConfigurationError
 * instead of silently calling a mock or localhost server.
 */
import { ApiConfigurationError } from "./errors";

/**
 * Vite injects `import.meta.env` in the browser; Bun scripts run the same
 * modules directly and do not define it. The fallback keeps the service layer
 * importable from verification scripts without a build step.
 */
const env: Partial<ImportMetaEnv> =
  typeof import.meta.env === "object" && import.meta.env !== null
    ? import.meta.env
    : {};

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Public base URL of the production API ("" until configured). */
export const API_BASE_URL = normalizeBaseUrl(env.VITE_API_BASE_URL);

/** Abort a request after this many milliseconds. */
export const API_TIMEOUT_MS = parsePositiveInt(env.VITE_API_TIMEOUT_MS, 20_000);

/**
 * Send cookies with cross-origin requests. Enable only when the backend uses
 * session cookies and CORS is configured for credentialed requests.
 */
export const API_WITH_CREDENTIALS =
  (env.VITE_API_WITH_CREDENTIALS ?? "").toLowerCase() === "true";

/**
 * HR currently talks to a deployed PHP API. Its URL is kept configurable for
 * backward compatibility and read here rather than in a feature component.
 * The long-term target is `VITE_API_BASE_URL`.
 */
export const HR_API_BASE_URL =
  normalizeBaseUrl(env.VITE_HR_API_URL) ||
  normalizeBaseUrl(env.VITE_API_BASE_URL) ||
  "https://erpp.page.gd";

export function isApiConfigured(): boolean {
  return API_BASE_URL.length > 0;
}

/**
 * Resolve a relative endpoint against the configured base URL. Absolute URLs
 * are rejected so no feature can bypass the centralized configuration.
 */
export function apiUrl(path: string, baseUrl: string = API_BASE_URL): string {
  if (/^https?:\/\//i.test(path)) {
    throw new ApiConfigurationError(
      "Absolute API URLs are not allowed. Use a relative endpoint path.",
    );
  }
  if (!baseUrl) {
    throw new ApiConfigurationError(
      "VITE_API_BASE_URL is not configured. Set it before using the REST API client.",
    );
  }
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
