/**
 * Framework-agnostic REST client for the future PHP / Django API.
 *
 * Features the backend integration needs:
 *   - one configurable base URL (never hardcoded per feature)
 *   - JSON request/response handling with safe empty-response support
 *   - typed errors for 401/403/404/409/422/429/5xx, timeouts, and network
 *   - centralized bearer-token injection and 401 handling
 *   - optional cookie credentials for session-based auth
 *   - multipart upload and blob download helpers
 *
 * Feature modules call this client through their own service layer; the
 * contracts and credit-contract repositories remain on the documented
 * local persistence layer until their PHP endpoints exist.
 */
import { API_BASE_URL, API_TIMEOUT_MS, API_WITH_CREDENTIALS, apiUrl } from "./config";
import {
  ApiConfigurationError,
  ApiError,
  apiErrorFromResponse,
  isApiError,
} from "./errors";
import type { ApiEnvelope } from "./types";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

export type QueryParams = Record<string, QueryValue>;

export interface ApiRequestOptions {
  method?: HttpMethod;
  /** Serialized as JSON unless it is FormData/Blob/string. */
  body?: unknown;
  query?: QueryParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type ApiTokenProvider = () => string | null | Promise<string | null>;

export interface ApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  withCredentials?: boolean;
  fetchImpl?: typeof fetch;
  getAccessToken?: ApiTokenProvider;
  onUnauthorized?: (error: ApiError) => void;
  /** Override the default `{ data: ... }` envelope unwrapping. */
  unwrap?: boolean;
}

/* ------------------------------------------------------------------ */
/* Central auth handling                                               */
/* ------------------------------------------------------------------ */

interface ApiAuthHandlers {
  getAccessToken?: ApiTokenProvider;
  onUnauthorized?: (error: ApiError) => void;
}

const authHandlers: ApiAuthHandlers = {};

/**
 * Register the authentication integration ONCE (auth service/provider).
 * Feature modules must not read tokens or handle 401s themselves.
 */
export function configureApiAuth(handlers: ApiAuthHandlers): void {
  if (handlers.getAccessToken) authHandlers.getAccessToken = handlers.getAccessToken;
  if (handlers.onUnauthorized) authHandlers.onUnauthorized = handlers.onUnauthorized;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function buildQueryString(query?: QueryParams): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    if (raw === undefined || raw === null || raw === "") continue;
    if (Array.isArray(raw)) {
      for (const item of raw) params.append(key, String(item));
      continue;
    }
    params.append(key, String(raw));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text().catch(() => "");
  if (!text.trim()) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError({
        kind: "parse",
        message: "The server returned an invalid JSON response.",
        status: response.status,
      });
    }
  }
  // Some PHP endpoints omit the JSON content type; accept valid JSON text.
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function isEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    !Array.isArray(value)
  );
}

/** Unwrap `{ data: ... }`, tolerating endpoints that return a bare payload. */
export function unwrapApiData<T>(payload: unknown): T {
  return isEnvelope<T>(payload) ? payload.data : (payload as T);
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export class ApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly withCredentials: boolean;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/+$/, "") ?? API_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;
    this.withCredentials = options.withCredentials ?? API_WITH_CREDENTIALS;
    this.fetchImpl = options.fetchImpl;
    if (options.getAccessToken) configureApiAuth({ getAccessToken: options.getAccessToken });
    if (options.onUnauthorized) configureApiAuth({ onUnauthorized: options.onUnauthorized });
  }

  private async fetchResponse(
    path: string,
    options: ApiRequestOptions = {},
  ): Promise<{ response: Response; durationMs: number }> {
    const startedAt = Date.now();
    const doFetch = this.fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== "function") {
      throw new ApiConfigurationError("No fetch implementation is available.");
    }

    const url = `${apiUrl(path, this.baseUrl)}${buildQueryString(options.query)}`;
    const headers = new Headers({ Accept: "application/json" });
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      headers.set(key, value);
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      if (isFormData(options.body) || isBlob(options.body)) {
        body = options.body;
      } else if (typeof options.body === "string") {
        body = options.body;
      } else {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(options.body);
      }
    }

    const token = await authHandlers.getAccessToken?.();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    const externalSignal = options.signal;
    const abortFromExternal = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }

    try {
      const response = await doFetch(url, {
        method: options.method ?? "GET",
        headers,
        body,
        signal: controller.signal,
        credentials: this.withCredentials ? "include" : "same-origin",
      });
      return { response, durationMs: Date.now() - startedAt };
    } catch (error) {
      if (timedOut) {
        throw new ApiError({
          kind: "timeout",
          message: "The request timed out. Check your connection and try again.",
          retryable: true,
        });
      }
      if (externalSignal?.aborted || isAbortError(error)) {
        throw new ApiError({
          kind: "network",
          message: "The request was cancelled.",
          retryable: true,
        });
      }
      throw new ApiError({
        kind: "network",
        message: "Unable to reach the server. Check your connection and try again.",
        details: error,
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }

  /** Low-level request returning the parsed response body (no unwrapping). */
  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    let response: Response;
    try {
      ({ response } = await this.fetchResponse(path, options));
    } catch (error) {
      if (isApiError(error)) throw error;
      throw new ApiError({
        kind: "network",
        message: "Unable to reach the server. Please try again.",
        details: error,
        retryable: true,
      });
    }

    const requestId =
      response.headers.get("x-request-id") ?? response.headers.get("x-correlation-id") ?? undefined;
    const payload = await readResponseBody(response);

    if (!response.ok) {
      const error = apiErrorFromResponse(response.status, payload, requestId);
      if (response.status === 401) authHandlers.onUnauthorized?.(error);
      throw error;
    }

    return payload as T;
  }

  /** Request + `{ data: ... }` unwrapping (the documented contract). */
  async data<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    return unwrapApiData<T>(await this.request<unknown>(path, options));
  }

  get<T>(path: string, options: Omit<ApiRequestOptions, "method" | "body"> = {}) {
    return this.data<T>(path, { ...options, method: "GET" });
  }

  post<T>(path: string, body?: unknown, options: ApiRequestOptions = {}) {
    return this.data<T>(path, { ...options, method: "POST", body });
  }

  put<T>(path: string, body?: unknown, options: ApiRequestOptions = {}) {
    return this.data<T>(path, { ...options, method: "PUT", body });
  }

  patch<T>(path: string, body?: unknown, options: ApiRequestOptions = {}) {
    return this.data<T>(path, { ...options, method: "PATCH", body });
  }

  async delete<T = void>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    return this.data<T>(path, { ...options, method: "DELETE" });
  }

  /** Multipart upload — do not set Content-Type manually (boundary is automatic). */
  upload<T>(path: string, formData: FormData, options: ApiRequestOptions = {}) {
    return this.data<T>(path, { ...options, method: "POST", body: formData });
  }

  /** Download a protected file as a Blob (caller creates/revokes the URL). */
  async download(path: string, options: ApiRequestOptions = {}): Promise<Blob> {
    const { response } = await this.fetchResponse(path, options);
    if (!response.ok) {
      const payload = await readResponseBody(response);
      throw apiErrorFromResponse(response.status, payload);
    }
    return response.blob();
  }
}

/** App-wide client instance. Configure VITE_API_BASE_URL before calling it. */
export const apiClient = new ApiClient();
