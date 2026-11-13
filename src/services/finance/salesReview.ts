
import { API_BASE_URL, HR_API_BASE_URL } from "@/lib/api/config";
import { getHrAuthToken } from "@/services/hr/apiClient";

const API_BASE = (API_BASE_URL || HR_API_BASE_URL).replace(/\/+$/, "");
const ROOT = "/api/sales/finance/sales-review";

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  messages?: { error?: string };
};

function accessToken(): string | null {
  const token = getHrAuthToken();
  if (token) return token;

  if (typeof window === "undefined") return null;

  for (const store of [window.sessionStorage, window.localStorage]) {
    for (const key of [
      "access_token",
      "accessToken",
      "auth_token",
      "token",
      "nexerp.auth.token",
    ]) {
      const value = store.getItem(key);
      if (value?.trim()) return value.trim();
    }

    for (const key of [
      "nexerp.auth.session.v1",
      "auth_session",
      "authSession",
    ]) {
      const raw = store.getItem(key);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        const value =
          parsed.accessToken ?? parsed.access_token ?? parsed.token;

        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      } catch {
        // Ignore unrecognized authentication session formats.
      }
    }
  }

  return null;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!API_BASE) {
    throw new Error("API base URL is missing.");
  }

  const token = accessToken();
  if (!token) {
    throw new Error("Please sign in before using Finance.");
  }

  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);

  if (options.body) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error("Could not reach the Finance API.");
  }

  const raw = await response.text();
  let result: ApiResponse<T> | null = null;

  try {
    result = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("The server returned an invalid response.");
  }

  if (!response.ok || result?.success === false) {
    throw new Error(
      result?.messages?.error ??
        result?.message ??
        `Finance API request failed (${response.status}).`,
    );
  }

  if (!result) {
    throw new Error("The server returned an empty response.");
  }

  return result.data as T;
}

export const financeSalesReviewService = {
  getPendingInvoices() {
    return request<Record<string, unknown>[]>(ROOT);
  },

  approveInvoice(id: string) {
    return request<Record<string, unknown>>(
      `${ROOT}/${encodeURIComponent(id)}/approve`,
      { method: "POST" },
    );
  },

  rejectInvoice(id: string, reason: string) {
    return request<Record<string, unknown>>(
      `${ROOT}/${encodeURIComponent(id)}/reject`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    );
  },
};
