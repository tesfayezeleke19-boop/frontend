
import { API_BASE_URL, HR_API_BASE_URL } from "@/lib/api/config";
import { getHrAuthToken } from "@/services/hr/apiClient";

const API_BASE = (API_BASE_URL || HR_API_BASE_URL).replace(/\/+$/, "");
const ROOT = "/api/finance/royalty-reports";

type JsonObject = Record<string, unknown>;

function accessToken(): string | null {
  const hrToken = getHrAuthToken();
  if (hrToken) return hrToken;
  if (typeof window === "undefined") return null;

  for (const store of [window.sessionStorage, window.localStorage]) {
    for (const key of [
      "access_token", "accessToken", "auth_token", "token",
      "nexerp.auth.token",
    ]) {
      const value = store.getItem(key);
      if (value?.trim()) return value.trim();
    }

    for (const key of [
      "nexerp.auth.session.v1", "auth_session", "authSession",
    ]) {
      const raw = store.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as JsonObject;
        const token = parsed.accessToken ?? parsed.access_token ?? parsed.token;
        if (typeof token === "string" && token.trim()) return token.trim();
      } catch {
        // Ignore unrelated session formats.
      }
    }
  }

  return null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!API_BASE) {
    throw new Error("API base URL is missing. Check the frontend environment configuration.");
  }

  const token = accessToken();
  if (!token) {
    throw new Error("A backend bearer token is missing. Sign in before using Finance.");
  }

  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error("Could not reach the Finance API. Check the backend URL and network connection.");
  }

  const raw = await response.text();
  let body: any = null;

  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { message: raw };
    }
  }

  if (!response.ok || body?.success === false) {
    const message =
      body?.messages?.error ??
      body?.message ??
      body?.errors ??
      `Finance API request failed (${response.status}).`;

    throw new Error(
      Array.isArray(message)
        ? message.join(" ")
        : typeof message === "object"
          ? JSON.stringify(message)
          : String(message),
    );
  }

  return body as T;
}

export interface FinanceRoyaltyReportRow {
  key: string;
  source: "INVOICE" | "CONTRACT_ORDER";
  date: number | null;
  royaltyInvoiceNumber?: string | null;
  aggregate: string;
  quantity: number;
  unitPrice: number;
  lineTotalExclVat: number;
  royalty: number;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  contractNumber?: string | null;
  contractOrderId?: string | null;
  contractOrderNumber?: string | null;
}

export interface FinanceRoyaltyBatch {
  id: string;
  batchNumber: number;
  orderIds: string[];
  recordCount: number;
  totalQuantity: number;
  totalSales: number;
  totalRoyalty: number;
  createdAt: number;
  exportedAt?: number;
  status: "PENDING" | "FINALIZED";
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const financeRoyaltyReportsApi = {
  async getRows(): Promise<FinanceRoyaltyReportRow[]> {
    const result = await request<ApiResponse<FinanceRoyaltyReportRow[]>>(ROOT);
    return Array.isArray(result.data) ? result.data : [];
  },

  async getBatches(): Promise<FinanceRoyaltyBatch[]> {
    const result = await request<ApiResponse<FinanceRoyaltyBatch[]>>(`${ROOT}/batches`);
    return Array.isArray(result.data) ? result.data : [];
  },

  /**
   * Load ONE completed batch with its exact historical records.
   *
   * The page must not reconstruct a batch from the LIVE report rows (which
   * change and exclude finalized records), so the backend has to return the
   * persisted snapshot for the requested batch id.
   */
  async getBatch(batchId: string): Promise<{
    batch: FinanceRoyaltyBatch | null;
    rows: FinanceRoyaltyReportRow[];
  }> {
    const result = await request<ApiResponse<unknown>>(
      `${ROOT}/batches/${encodeURIComponent(batchId)}`,
    );

    const data = result.data as
      | FinanceRoyaltyReportRow[]
      | {
          batch?: FinanceRoyaltyBatch;
          rows?: FinanceRoyaltyReportRow[];
          records?: FinanceRoyaltyReportRow[];
          items?: FinanceRoyaltyReportRow[];
        }
      | null;

    if (Array.isArray(data)) {
      return { batch: null, rows: data };
    }

    const rows = data?.rows ?? data?.records ?? data?.items ?? [];
    return { batch: data?.batch ?? null, rows: Array.isArray(rows) ? rows : [] };
  },

  async finalizeBatch(orderIds: string[]): Promise<FinanceRoyaltyBatch> {
    const result = await request<ApiResponse<FinanceRoyaltyBatch>>(`${ROOT}/batches`, {
      method: "POST",
      body: JSON.stringify({ orderIds }),
    });

    if (!result.data) {
      throw new Error("The server did not return the finalized royalty batch.");
    }

    return result.data;
  },
};
