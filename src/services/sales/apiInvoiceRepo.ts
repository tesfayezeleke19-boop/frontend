import { API_BASE_URL, HR_API_BASE_URL } from "@/lib/api/config";
import { getHrAuthToken } from "@/services/hr/apiClient";
import { notifySalesChanged } from "./storage";
import {
  ORDER_STATUS,
  type OrderStatus,
  type AggregateType,
} from "./types";
import {
  calculateOrderTotals,
  calculateSalesInvoiceTotals,
  computeNextInvoiceNumber,
  type FileEvidence,
  type InvoiceOrder,
  type SalesInvoice,
  type SalesInvoiceInput,
  type SalesInvoicesRepository,
} from "./invoice";

const API_BASE = (API_BASE_URL || HR_API_BASE_URL).replace(/\/+$/, "");
const ROOT = "/api/sales";

type JsonObject = Record<string, unknown>;

export interface SalesAggregateTypeOption {
  id: number;
  name: string;
  pricePerM3: number;
  description?: string | null;
}

/**
 * Fetch active aggregate types from the authenticated Sales API.
 * The names are stored in sales_invoice_lines.aggregate for compatibility
 * with the existing database schema.
 */
export async function getSalesAggregateTypes(): Promise<SalesAggregateTypeOption[]> {
  const result = await request<any>(`${ROOT}/aggregate-types`);
  const rows = Array.isArray(result?.data) ? result.data : [];

  return rows.map((row: any) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    pricePerM3: Number(row.pricePerM3 ?? row.price_per_m3 ?? 0),
    description: row.description == null ? null : String(row.description),
  })).filter((row: SalesAggregateTypeOption) => row.name.length > 0);
}

function accessToken(): string | null {
  const fromHrClient = getHrAuthToken();
  if (fromHrClient) return fromHrClient;
  if (typeof window === "undefined") return null;
  // These are authentication credentials only, never Sales records.
  for (const store of [window.sessionStorage, window.localStorage]) {
    for (const key of ["access_token", "accessToken", "auth_token", "token", "nexerp.auth.token"]) {
      const value = store.getItem(key);
      if (value && value.trim()) return value.trim();
    }
    for (const key of ["nexerp.auth.session.v1", "auth_session", "authSession"]) {
      const raw = store.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as JsonObject;
        const token = parsed.accessToken ?? parsed.access_token ?? parsed.token;
        if (typeof token === "string" && token.trim()) return token.trim();
      } catch { /* not a token-bearing session format */ }
    }
  }
  return null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!API_BASE) throw new Error("API base URL is missing. Set VITE_API_BASE_URL in the frontend .env file.");
  const token = accessToken();
  if (!token) throw new Error("A backend bearer token is missing. Sign in through the backend authentication API before using Sales.");
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error("Could not reach the Sales API. Check the backend URL and network connection.");
  }
  const raw = await response.text();
  let body: any = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = { message: raw }; }
  }
  if (!response.ok || body?.success === false) {
    const message = body?.messages?.error ?? body?.message ?? body?.errors ?? `Sales API request failed (${response.status}).`;
    throw new Error(Array.isArray(message) ? message.join(" ") : typeof message === "object" ? JSON.stringify(message) : String(message));
  }
  return body as T;
}

function asMillis(value: unknown): number {
  if (value === null || value === undefined || value === "") return Date.now();
  if (typeof value === "number") return value > 9_999_999_999 ? value : value * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Date.now();
}
function nullableMillis(value: unknown): number | undefined {
  return value === null || value === undefined || value === "" ? undefined : asMillis(value);
}
function evidence(value: any): FileEvidence | undefined {
  if (!value || typeof value !== "object" || !value.id) return undefined;
  return {
    id: String(value.id), fileName: String(value.fileName ?? "Attachment"),
    fileUrl: String(value.fileUrl ?? ""), mimeType: String(value.mimeType ?? "application/octet-stream"),
    fileSize: Number(value.fileSize ?? 0),
  };
}
function normalizeStatus(value: unknown): OrderStatus {
  const status = String(value ?? "DRAFT").toUpperCase();
  if (Object.values(ORDER_STATUS).includes(status as OrderStatus)) return status as OrderStatus;
  throw new Error(`The server returned an unknown invoice status: ${status}`);
}
function mapInvoice(raw: any): SalesInvoice {
  const rawOrders = Array.isArray(raw.orders) ? raw.orders : [];
  const orders: InvoiceOrder[] = rawOrders.map((line: any, index: number) => {
    const aggregate = String(line.aggregate ?? "00") as AggregateType;
    const quantity = Number(line.quantity ?? 0);
    const unitPrice = Number(line.unitPrice ?? 0);
    const totals = calculateOrderTotals({ quantity, unitPrice });
    return {
      id: String(line.id ?? `${raw.id}-line-${index + 1}`),
      orderNumber: Number(line.orderNumber ?? index + 1), aggregate,
      quantity, unit: String(line.unit ?? "m³"), unitPrice,
      lineTotalExclVat: Number(line.lineTotalExclVat ?? totals.lineTotalExclVat),
      royaltyOrderNumber: Number(line.royaltyOrderNumber ?? index + 1),
      royaltyInvoiceNumber: line.royaltyInvoiceNumber == null ? undefined : String(line.royaltyInvoiceNumber),
      royaltyAmount: Number(line.royaltyAmount ?? totals.royaltyAmount),
      contractOrderId: line.contractOrderId ?? undefined,
      orderDate: nullableMillis(line.orderDate),
    };
  });
  const fs = raw.financialSummary ?? {};
  const payment = raw.payment ?? {};
  const withholdingEnabled = Boolean(fs.withholdingEnabled);
  const calculated = calculateSalesInvoiceTotals({ orders, withholdingEnabled });
  return {
    id: String(raw.id), invoiceNumber: String(raw.invoiceNumber ?? ""),
    date: asMillis(raw.date), customer: { name: String(raw.customer?.name ?? ""), tin: String(raw.customer?.tin ?? "") },
    fsNo: String(raw.fsNo ?? ""), contractId: raw.contractId ?? undefined, orders,
    financialSummary: {
      subtotalExclVat: Number(fs.subtotalExclVat ?? calculated.subtotalExclVat),
      totalVat: Number(fs.totalVat ?? calculated.totalVat),
      totalPriceInclVat: Number(fs.totalPriceInclVat ?? calculated.totalPriceInclVat),
      withholdingEnabled, withholdingRate: Number(fs.withholdingRate ?? (withholdingEnabled ? 0.03 : 0)),
      withholdingAmount: Number(fs.withholdingAmount ?? calculated.withholdingAmount),
      netAmountAfterWithholding: Number(fs.netAmountAfterWithholding ?? calculated.netAmountAfterWithholding),
    },
    payment: {
      bank: String(payment.bank ?? ""), paymentSender: String(payment.paymentSender ?? ""),
      paymentReferenceNumber: String(payment.paymentReferenceNumber ?? ""),
      paymentEvidence: evidence(payment.paymentEvidence),
    },
    withholdingEvidence: evidence(raw.withholdingEvidence), remark: raw.remark == null ? undefined : String(raw.remark),
    status: normalizeStatus(raw.status), rejectionReason: raw.rejectionReason ?? undefined,
    createdAt: asMillis(raw.createdAt), updatedAt: asMillis(raw.updatedAt),
    submittedAt: nullableMillis(raw.submittedAt), submittedBy: raw.submittedBy ?? undefined,
    financeReviewedAt: nullableMillis(raw.financeReviewedAt), approvedAt: nullableMillis(raw.approvedAt),
    rejectedAt: nullableMillis(raw.rejectedAt), paymentConfirmedAt: nullableMillis(raw.paymentConfirmedAt),
    approvedBy: raw.approvedBy ?? undefined, paymentConfirmedBy: raw.paymentConfirmedBy ?? undefined,
    createdBy: raw.createdBy ?? undefined,
  };
}
function toPayload(input: Partial<SalesInvoiceInput>): JsonObject {
  const payload: JsonObject = {};
  if (input.customer) payload.customer = { name: input.customer.name, tin: input.customer.tin };
  if (input.fsNo !== undefined) payload.fsNo = input.fsNo;
  if (input.contractId !== undefined) payload.contractId = input.contractId || null;
  if (input.orders) payload.orders = input.orders.map((order, index) => ({
    aggregate: order.aggregate, quantity: Number(order.quantity), unit: "m³", unitPrice: Number(order.unitPrice),
    royaltyOrderNumber: index + 1, royaltyInvoiceNumber: order.royaltyInvoiceNumber?.trim() || null,
    contractOrderId: order.contractOrderId ?? null,
    orderDate: order.orderDate == null ? null : new Date(order.orderDate).toISOString().slice(0, 10),
  }));
  if (input.withholdingEnabled !== undefined) payload.withholdingEnabled = input.withholdingEnabled;
  if (input.payment) payload.payment = {
    bank: input.payment.bank, paymentSender: input.payment.paymentSender,
    paymentReferenceNumber: input.payment.paymentReferenceNumber,
    paymentEvidence: input.payment.paymentEvidence ?? null,
  };
  if (input.withholdingEnabled === false) {
    payload.withholdingEvidence = null;
  } else if (input.withholdingEvidence !== undefined) {
    payload.withholdingEvidence = input.withholdingEvidence ?? null;
  }
  if (input.remark !== undefined) payload.remark = input.remark ?? null;
  return payload;
}

export async function uploadInvoiceAttachment(file: File): Promise<FileEvidence> {
  const form = new FormData();
  form.append("file", file);
  const result = await request<any>(`${ROOT}/attachments/upload`, { method: "POST", body: form });
  const item = result?.attachment;
  if (!item?.id) throw new Error("The server did not return attachment metadata.");
  return evidence(item)!;
}

/**
 * Fetch an invoice attachment using the same Bearer authentication
 * as the other Sales API requests.
 *
 * Returns a temporary browser Blob URL for displaying the file.
 */
export async function fetchInvoiceAttachmentBlob(
  fileUrl: string
): Promise<string> {
  if (!API_BASE) {
    throw new Error("API base URL is missing.");
  }

  // Prevent requests to arbitrary URLs from attachment metadata.
  if (!fileUrl.startsWith("/api/sales/invoices/attachments/")) {
    throw new Error("Invalid invoice attachment URL.");
  }

  const token = accessToken();

  if (!token) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE}${fileUrl}`, {
      method: "GET",
      headers: {
        Accept: "image/jpeg, image/png, image/webp, application/pdf",
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new Error("Could not connect to the attachment service.");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("You are not authorized to view this attachment.");
    }

    if (response.status === 404) {
      throw new Error("The attachment file could not be found.");
    }

    throw new Error(`Unable to load attachment (${response.status}).`);
  }

  const blob = await response.blob();

  if (!blob.type.startsWith("image/")) {
    throw new Error("This attachment is not a supported image.");
  }

  return URL.createObjectURL(blob);
}

async function runWorkflow(id: string, action: string, body?: JsonObject): Promise<SalesInvoice> {
  const result = await request<any>(`${ROOT}/invoices/${encodeURIComponent(id)}/${action}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
  notifySalesChanged();
  if (!result?.data) throw new Error("The server returned no updated invoice.");
  return mapInvoice(result.data);
}

export const apiSalesInvoicesRepository: SalesInvoicesRepository = {
  async getInvoices() {
    const result = await request<any>(`${ROOT}/invoices`);
    return (Array.isArray(result?.data) ? result.data : []).map(mapInvoice);
  },
  async getInvoiceById(id) {
    const result = await request<any>(`${ROOT}/invoices/${encodeURIComponent(id)}`);
    return result?.data ? mapInvoice(result.data) : null;
  },
  async getInvoicesByStatus(status) { return (await this.getInvoices()).filter((i) => i.status === status); },
  async getFinanceApprovedInvoices() { return this.getInvoicesByStatus(ORDER_STATUS.FINANCE_APPROVED); },
  async getPaymentConfirmedInvoices() { return this.getInvoicesByStatus(ORDER_STATUS.PAYMENT_CONFIRMED); },
  async computeNextInvoiceNumber() { return computeNextInvoiceNumber(await this.getInvoices()); },
  async createInvoice(input) {
    const result = await request<any>(`${ROOT}/invoices`, { method: "POST", body: JSON.stringify(toPayload(input)) });
    notifySalesChanged();
    if (!result?.data) throw new Error("The server created no invoice response.");
    return mapInvoice(result.data);
  },
  async saveDraft(id, input) {
    const result = await request<any>(`${ROOT}/invoices/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(toPayload(input)) });
    notifySalesChanged();
    if (!result?.data) throw new Error("The server returned no updated invoice.");
    return mapInvoice(result.data);
  },
  async submitInvoice(id) { return runWorkflow(id, "submit"); },
  async approveInvoice(id) { return runWorkflow(id, "approve"); },
  async rejectInvoice(id, reason) { return runWorkflow(id, "reject", { reason }); },
  async confirmInvoicePayment(id) { return runWorkflow(id, "confirm-payment"); },
  subscribe(listener) { return subscribeSales(listener); },
};

import { subscribeSales } from "./storage";
