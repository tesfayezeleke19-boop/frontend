/**
 * Credit Contract repository — the trusted layer for the credit workflow.
 *
 * Backend authorization:
 *
 *   FINANCE  create / edit drafts / activate / cancel / cancel orders /
 *            finalize (FS No + one Sales Invoice) / view everything.
 *
 *   SALES    view active credit contracts / add orders to any active
 *            contract / correct orders they completed.
 *
 *   OTHERS   rejected by the backend.
 *
 * This repository uses the Credit Contracts API exclusively.
 * It never reads or writes standard contract storage.
 *
 * API:
 *   GET     /api/credit-contracts
 *   GET     /api/credit-contracts/{id}
 *   POST    /api/credit-contracts
 *   PUT     /api/credit-contracts/{id}
 *   POST    /api/credit-contracts/{id}/activate
 *   POST    /api/credit-contracts/{id}/cancel
 *
 *   GET     /api/credit-contracts/{id}/orders
 *   POST    /api/credit-contracts/{id}/orders
 *   PUT     /api/credit-contracts/{id}/orders/{orderId}
 *   POST    /api/credit-contracts/{id}/orders/{orderId}/cancel
 *
 *   GET     /api/credit-contracts/{id}/payment-information
 *   PUT     /api/credit-contracts/{id}/payment-information
 *   DELETE  /api/credit-contracts/{id}/payment-information
 *
 *   GET     /api/credit-contracts/{id}/withholding
 *   PUT     /api/credit-contracts/{id}/withholding
 *
 *   GET     /api/credit-contracts/{id}/financial-report
 *   POST    /api/credit-contracts/{id}/finalize
 *
 * The backend is authoritative for authorization and lifecycle rules.
 */

import { authRepository } from "../auth/authRepository";
import { normalizeNumber } from "../sales/calc";

import {
  CREDIT_CONTRACT_STATUS,
  CREDIT_ORDER_STATUS,
  buildCreditPaymentSummary,
  getCreditContractProgress,
  type CreditContract,
  type CreditContractInput,
  type CreditContractOrder,
  type CreditContractOrderInput,
  type CreditContractProgress,
  type CreditFinalizationInput,
  type CreditPaymentSummary,
} from "./types";

import type {
  ContractFinancialInput,
  ContractFinancialReport,
} from "../contracts/financials";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export class CreditContractPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditContractPermissionError";
  }
}

export interface CreditContractFinancials {
  progress: CreditContractProgress;
  payments: CreditPaymentSummary;
}

export interface CreditContractsRepository {
  getContracts(): Promise<CreditContract[]>;

  getContractById(id: string): Promise<CreditContract | null>;

  getOrders(contractId: string): Promise<CreditContractOrder[]>;

  getAllOrders(): Promise<CreditContractOrder[]>;

  getOrderById(id: string): Promise<CreditContractOrder | null>;

  getFinancials(
    contractId: string,
  ): Promise<CreditContractFinancials | null>;

  getFinancialReport(
    contractId: string,
  ): Promise<ContractFinancialReport | null>;

  saveFinancialInformation(
    contractId: string,
    input: ContractFinancialInput,
  ): Promise<CreditContract>;

  createContract(
    input: CreditContractInput,
  ): Promise<CreditContract>;

  updateContract(
    id: string,
    input: CreditContractInput,
  ): Promise<CreditContract>;

  activateContract(id: string): Promise<CreditContract>;

  cancelContract(
    id: string,
    reason: string,
  ): Promise<CreditContract>;

  finalizeContract(
    id: string,
    input: CreditFinalizationInput,
  ): Promise<{
    contract: CreditContract;
    invoiceId: string;
    invoiceNumber: string;
  }>;

  addOrder(
    contractId: string,
    input: CreditContractOrderInput,
  ): Promise<CreditContractOrder>;

  updateOrder(
    orderId: string,
    input: CreditContractOrderInput,
  ): Promise<CreditContractOrder>;

  cancelOrder(
    orderId: string,
    reason: string,
  ): Promise<CreditContractOrder>;

  subscribe(listener: () => void): () => void;
}

/* -------------------------------------------------------------------------- */
/* API configuration                                                          */
/* -------------------------------------------------------------------------- */

type ApiObject = Record<string, unknown>;

interface ApiErrorPayload {
  message?: string;
  error?: string;
  errors?: Record<string, string | string[]>;
}

interface ApiEnvelope<T> {
  success?: boolean;
  message?: string;
  data?: T;
  errors?: Record<string, string | string[]>;
}

function getApiBaseUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;

  const configuredUrl =
    env.VITE_API_URL ||
    env.VITE_API_BASE_URL ||
    "";

  const normalized = configuredUrl.replace(/\/+$/, "");

  if (!normalized) {
    return "/api/credit-contracts";
  }

  if (/\/api$/i.test(normalized)) {
    return `${normalized}/credit-contracts`;
  }

  return `${normalized}/api/credit-contracts`;
}

/**
 * Reads the access token from the existing authentication session.
 *
 * The backend expects:
 * Authorization: Bearer <token>
 *
 * The helper supports common session token property names so that the
 * repository does not depend on one specific session representation.
 */
function getAccessToken(): string {
  const session = authRepository.getSession() as unknown as
    | ApiObject
    | null;

  if (!session) {
    throw new CreditContractPermissionError(
      "Your session has expired. Please sign in again.",
    );
  }

  if (session.isGuest === true) {
    throw new CreditContractPermissionError(
      "Sign in with an authorized account to use credit contracts.",
    );
  }

  const user = isObject(session.user) ? session.user : {};
  const auth = isObject(session.auth) ? session.auth : {};
  const tokens = isObject(session.tokens) ? session.tokens : {};

  const candidates: unknown[] = [
    session.accessToken,
    session.token,
    session.authToken,
    session.access_token,
    session.sessionToken,

    user.accessToken,
    user.token,
    user.access_token,

    auth.accessToken,
    auth.token,
    auth.access_token,

    tokens.accessToken,
    tokens.token,
    tokens.access_token,
  ];

  const token = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );

  if (!token) {
    throw new CreditContractPermissionError(
      "Authentication token not found. Please sign out and sign in again.",
    );
  }

  return token.trim();
}

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

function isObject(value: unknown): value is ApiObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function asObject(value: unknown): ApiObject {
  return isObject(value) ? value : {};
}

function asString(
  value: unknown,
  fallback = "",
): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
}

function asOptionalString(
  value: unknown,
): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return asString(value);
}

function asNumber(
  value: unknown,
  fallback = 0,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(
  value: unknown,
  fallback = false,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === 0 || value === "0" || value === "false") {
    return false;
  }

  return fallback;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function unwrapData<T>(response: unknown): T {
  if (!isObject(response)) {
    return response as T;
  }

  if (Object.prototype.hasOwnProperty.call(response, "data")) {
    return response.data as T;
  }

  return response as T;
}

function extractErrorMessage(
  payload: unknown,
  fallback: string,
): string {
  if (!isObject(payload)) {
    return fallback;
  }

  const errorPayload = payload as ApiErrorPayload;

  if (typeof errorPayload.message === "string") {
    return errorPayload.message;
  }

  if (typeof errorPayload.error === "string") {
    return errorPayload.error;
  }

  if (isObject(errorPayload.errors)) {
    const messages = Object.values(errorPayload.errors)
      .flatMap((value) =>
        Array.isArray(value) ? value : [value],
      )
      .filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      );

    if (messages.length > 0) {
      return messages[0];
    }
  }

  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Date conversion                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Converts an epoch-millisecond UI date into the API date format.
 *
 * The backend accepts YYYY-MM-DD.
 * Local date components are used to avoid timezone date shifts.
 */
function toApiDate(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "string") {
    const dateOnly = value.match(/^(\d{4}-\d{2}-\d{2})/);

    if (dateOnly) {
      return dateOnly[1];
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return "";
    }

    return formatLocalDate(parsed);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return formatLocalDate(date);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * API dates are converted into epoch milliseconds for the existing UI types.
 *
 * Date-only values are parsed as local dates to avoid displaying the previous
 * day in timezones behind UTC.
 */
function fromApiDate(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return Date.now();
  }

  const text = value.trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (dateOnly) {
    const [, year, month, day] = dateOnly;

    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
    ).getTime();
  }

  const parsed = new Date(text);

  return Number.isNaN(parsed.getTime())
    ? Date.now()
    : parsed.getTime();
}

function optionalApiDate(
  value: unknown,
): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return fromApiDate(value);
}

/* -------------------------------------------------------------------------- */
/* API request                                                                */
/* -------------------------------------------------------------------------- */

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken();
  const baseUrl = getApiBaseUrl();

  const normalizedPath = path.replace(/^\/+/, "");
  const url = `${baseUrl}/${normalizedPath}`;

  const headers = new Headers(options.headers);

  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");

  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: "omit",
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Unable to connect to the server: ${error.message}`
        : "Unable to connect to the server.",
    );
  }

  const responseText = await response.text();

  let payload: unknown = null;

  if (responseText.trim()) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = responseText;
    }
  }

  if (!response.ok) {
    const message = extractErrorMessage(
      payload,
      `Request failed with status ${response.status}.`,
    );

    if (response.status === 401 || response.status === 403) {
      throw new CreditContractPermissionError(message);
    }

    throw new Error(message);
  }

  if (isObject(payload)) {
    const envelope = payload as ApiEnvelope<T>;

    if (envelope.success === false) {
      throw new Error(
        extractErrorMessage(
          payload,
          "The server rejected the request.",
        ),
      );
    }

    if (Object.prototype.hasOwnProperty.call(payload, "data")) {
      return envelope.data as T;
    }
  }

  return payload as T;
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

/* -------------------------------------------------------------------------- */
/* Contract mapping                                                           */
/* -------------------------------------------------------------------------- */

function mapContract(rawValue: unknown): CreditContract {
  const raw = asObject(rawValue);
  const customer = asObject(raw.customer);

  const status = asString(
    raw.status,
    CREDIT_CONTRACT_STATUS.DRAFT,
  ) as CreditContract["status"];

  const attachments = asArray(raw.attachments);

  return {
    id: asString(raw.id),

    contractNumber: asString(raw.contractNumber),

    customer: {
      name: asString(customer.name),
      tin: asString(customer.tin),
    },

    contractValue: normalizeNumber(
      asNumber(raw.contractValue),
    ),

    fsNo: asString(raw.fsNo),

    contractDate: fromApiDate(raw.contractDate),

    attachments: attachments as CreditContract["attachments"],

    remark: asOptionalString(raw.remark),

    status,

    createdBy: asOptionalString(raw.createdBy),

    activatedBy: asOptionalString(raw.activatedBy),

    activatedAt: optionalApiDate(raw.activatedAt),

    finalizedBy: asOptionalString(raw.finalizedBy),

    finalizedAt: optionalApiDate(raw.finalizedAt),

    finalizationReason: asOptionalString(
      raw.finalizationReason,
    ),

    cancelledBy: asOptionalString(raw.cancelledBy),

    cancelledAt: optionalApiDate(raw.cancelledAt),

    cancellationReason: asOptionalString(
      raw.cancellationReason,
    ),

    closedBelowValue:
      raw.closedBelowValue === null ||
      raw.closedBelowValue === undefined
        ? undefined
        : asBoolean(raw.closedBelowValue),

    salesInvoiceId: asOptionalString(raw.salesInvoiceId),

    salesInvoiceNumber: asOptionalString(
      raw.salesInvoiceNumber,
    ),

    createdAt: fromApiDate(raw.createdAt),

    updatedAt: fromApiDate(raw.updatedAt),

    version: asNumber(raw.version, 1),

    // The current API contract mapper does not expose statusHistory.
    statusHistory: [],
  } as CreditContract;
}

/* -------------------------------------------------------------------------- */
/* Order mapping                                                              */
/* -------------------------------------------------------------------------- */

function mapOrder(rawValue: unknown): CreditContractOrder {
  const raw = asObject(rawValue);

  const id = asString(raw.id);

  const completedByUserId = asString(
    raw.completedByUserId,
    asString(raw.completedByName),
  );

  const completedByName = asString(
    raw.completedByName,
    completedByUserId,
  );

  const createdAt = fromApiDate(raw.createdAt);

  const cancelledAt = optionalApiDate(raw.cancelledAt);

  return {
    id,

    creditContractId: asString(raw.creditContractId),

    orderNumber: asNumber(raw.orderNumber),

    aggregate: asString(
      raw.aggregate,
    ) as CreditContractOrder["aggregate"],

    quantity: normalizeNumber(
      asNumber(raw.quantity),
    ),

    unit: asString(raw.unit, "m³"),

    unitPrice: normalizeNumber(
      asNumber(raw.unitPrice),
    ),

    lineTotalExclVat: normalizeNumber(
      asNumber(raw.lineTotalExclVat),
    ),

    lineTotalInclVat: normalizeNumber(
      asNumber(raw.lineTotalInclVat),
    ),

    royaltyInvoiceNumber: asOptionalString(
      raw.royaltyInvoiceNumber,
    ),

    orderDate: fromApiDate(raw.orderDate),

    status: asString(
      raw.status,
      CREDIT_ORDER_STATUS.COMPLETED,
    ) as CreditContractOrder["status"],

    completedByUserId,

    completedByName,

    completedByEmail: asOptionalString(
      raw.completedByEmail,
    ),

    // The backend mapper does not expose completedAt separately.
    completedAt: optionalApiDate(raw.completedAt) ?? createdAt,

    // The backend mapper does not expose the original creator separately.
    createdByUserId: asString(
      raw.createdByUserId,
      completedByUserId,
    ),

    createdByName: asString(
      raw.createdByName,
      completedByName,
    ),

    createdAt,

    updatedAt: fromApiDate(raw.updatedAt),

    lastEditedByUserId: asOptionalString(
      raw.lastEditedByUserId,
    ),

    lastEditedByName: asOptionalString(
      raw.lastEditedByName,
    ),

    lastEditedByEmail: asOptionalString(
      raw.lastEditedByEmail,
    ),

    editedAt: optionalApiDate(raw.editedAt),

    cancelledAt,

    cancelledBy: asOptionalString(raw.cancelledBy),

    cancelReason: asOptionalString(
      raw.cancellationReason ?? raw.cancelReason,
    ),

    // This is the source key convention used by the backend.
    royaltySourceKey: `credit-contract-order:${id}`,
  } as CreditContractOrder;
}

/* -------------------------------------------------------------------------- */
/* Financial information mapping                                              */
/* -------------------------------------------------------------------------- */

function mapPaymentInformation(
  rawValue: unknown,
): ContractFinancialReport["payment"] {
  if (!rawValue || !isObject(rawValue)) {
    return undefined;
  }

  const raw = rawValue;

  return {
    bank: asString(raw.bank),

    paymentSender: asString(raw.paymentSender),

    paymentAmount: normalizeNumber(
      asNumber(raw.paymentAmount),
    ),

    paymentDate: optionalApiDate(raw.paymentDate),

    paymentReferenceNumber: asString(
      raw.paymentReferenceNumber,
    ),

    paymentEvidence: raw.paymentEvidence
      ? (raw.paymentEvidence as NonNullable<
          NonNullable<ContractFinancialReport["payment"]>
        >["paymentEvidence"])
      : undefined,

    remark: asOptionalString(raw.remark),

    recordedBy: asOptionalString(raw.recordedBy),

    recordedAt: optionalApiDate(raw.recordedAt),

    updatedAt: optionalApiDate(raw.updatedAt),
  } as ContractFinancialReport["payment"];
}

function mapWithholdingInformation(
  rawValue: unknown,
): ContractFinancialReport["withholding"] {
  if (!rawValue || !isObject(rawValue)) {
    return undefined;
  }

  const raw = rawValue;

  return {
    enabled: asBoolean(raw.enabled),

    rate: asNumber(raw.rate),

    evidence: raw.evidence
      ? (raw.evidence as NonNullable<
          ContractFinancialReport["withholding"]
        >["evidence"])
      : undefined,

    recordedBy: asOptionalString(raw.recordedBy),

    recordedAt: optionalApiDate(raw.recordedAt),

    updatedAt: optionalApiDate(raw.updatedAt),
  } as ContractFinancialReport["withholding"];
}

function mapPaymentStatus(value: unknown): ContractFinancialReport["paymentStatus"] {
  const status = asString(value);

  const allowed: ContractFinancialReport["paymentStatus"][] = [
    "NO_PAYMENT_INFORMATION",
    "RECORDED_NOT_CONFIRMED",
    "AWAITING_INVOICE_APPROVAL",
    "AWAITING_PAYMENT_CONFIRMATION",
    "PAID",
    "INVOICE_UNAVAILABLE",
  ];

  return allowed.includes(
    status as ContractFinancialReport["paymentStatus"],
  )
    ? (status as ContractFinancialReport["paymentStatus"])
    : "NO_PAYMENT_INFORMATION";
}

function mapWithholdingStatus(
  value: unknown,
): ContractFinancialReport["withholdingStatus"] {
  const status = asString(value);

  if (status === "APPLIED" || status === "PENDING_INVOICE") {
    return status;
  }

  return "NOT_APPLIED";
}

/* -------------------------------------------------------------------------- */
/* Financial report mapping                                                   */
/* -------------------------------------------------------------------------- */

function mapFinancialReport(
  rawValue: unknown,
): ContractFinancialReport {
  const raw = asObject(rawValue);

  const invoiceRaw = isObject(raw.invoice)
    ? raw.invoice
    : null;

  const paymentRaw = isObject(raw.payment)
    ? raw.payment
    : null;

  const withholdingRaw = isObject(raw.withholding)
    ? raw.withholding
    : null;

  const invoiceStatus = invoiceRaw
    ? asString(invoiceRaw.status)
    : undefined;

  const invoiceApproved =
    invoiceStatus === "FINANCE_APPROVED" ||
    invoiceStatus === "PAYMENT_CONFIRMED";

  const paymentConfirmed =
    invoiceRaw !== null &&
    asBoolean(invoiceRaw.paymentConfirmed);

  const withholdingEnabled = asBoolean(
    raw.withholdingEnabled,
  );

  const invoice = invoiceRaw
    ? {
        id: asString(invoiceRaw.id),
        invoiceNumber: asString(invoiceRaw.invoiceNumber),
        status: invoiceStatus as NonNullable<
          ContractFinancialReport["invoice"]
        >["status"],
        approved: invoiceApproved,
        paymentConfirmed,
      }
    : undefined;

  const fulfilledValue = normalizeNumber(
    asNumber(raw.fulfilledValue),
  );

  const contractValue = normalizeNumber(
    asNumber(raw.contractValue),
  );

  const closedBelowValue =
    raw.closedBelowValue !== null &&
    raw.closedBelowValue !== undefined
      ? asBoolean(raw.closedBelowValue)
      : fulfilledValue < contractValue;

  const report = {
    contractNumber: asString(raw.contractNumber),

    customerName: asString(raw.customerName),

    customerTin: asString(raw.customerTin),

    contractDate: fromApiDate(raw.contractDate),

    completionDate: optionalApiDate(
      raw.completionDate,
    ),

    fsNo: asString(raw.fsNo),

    remark: asOptionalString(raw.remark),

    contractValue,

    fulfilledValue,

    remainingContractValue: normalizeNumber(
      asNumber(raw.remainingContractValue),
    ),

    overFulfilled: asBoolean(raw.overFulfilled),

    fulfillmentPercent: asNumber(
      raw.fulfillmentPercent,
    ),

    rawFulfillmentPercent: asNumber(
      raw.rawFulfillmentPercent,
    ),

    closedBelowValue,

    closingReason: asOptionalString(
      raw.closingReason ?? raw.finalizationReason,
    ),

    grossAmountDue: normalizeNumber(
      asNumber(raw.grossAmountDue),
    ),

    // The API uses the invoice amount when an invoice exists.
    grossAmountDueBasis: invoice
      ? "INVOICE"
      : "COMPLETED_ORDERS",

    totalVat: normalizeNumber(
      asNumber(raw.totalVat),
    ),

    subtotalExclVat: normalizeNumber(
      asNumber(raw.subtotalExclVat),
    ),

    withholdingEnabled,

    withholdingRate: asNumber(
      raw.withholdingRate,
    ),

    withholdingAmount: normalizeNumber(
      asNumber(raw.withholdingAmount),
    ),

    netAmount: normalizeNumber(
      asNumber(raw.netAmount),
    ),

    amountPaid: normalizeNumber(
      asNumber(raw.amountPaid),
    ),

    outstandingBalance: normalizeNumber(
      asNumber(raw.outstandingBalance),
    ),

    paymentStatus: mapPaymentStatus(
      raw.paymentStatus,
    ),

    withholdingStatus: mapWithholdingStatus(
      raw.withholdingStatus,
    ),

    payment: mapPaymentInformation(paymentRaw),

    withholding: mapWithholdingInformation(
      withholdingRaw,
    ),

    // The current backend financial-report endpoint does not return
    // payment history.
    paymentHistory: [],

    invoice,

    invoiceError: asOptionalString(raw.invoiceError),

    paymentConfirmedAt: optionalApiDate(
      raw.paymentConfirmedAt,
    ),

    paymentConfirmedBy: asOptionalString(
      raw.paymentConfirmedBy,
    ),
  } as ContractFinancialReport;

  return report;
}

/* -------------------------------------------------------------------------- */
/* API request payload mapping                                                */
/* -------------------------------------------------------------------------- */

function mapContractInput(
  input: CreditContractInput,
): ApiObject {
  return {
    customerName: input.customerName.trim(),

    tin: input.tin.trim(),

    contractValue: normalizeNumber(
      input.contractValue,
    ),

    fsNo: input.fsNo?.trim() ?? "",

    contractDate: toApiDate(input.contractDate),

    attachments: input.attachments ?? [],

    remark: input.remark?.trim() ?? "",
  };
}

function mapOrderInput(
  input: CreditContractOrderInput,
): ApiObject {
  return {
    aggregate: input.aggregate,

    quantity: normalizeNumber(input.quantity),

    unit: "m³",

    unitPrice: normalizeNumber(input.unitPrice),

    royaltyInvoiceNumber:
      input.royaltyInvoiceNumber.trim(),

    orderDate: toApiDate(input.orderDate),
  };
}

/* -------------------------------------------------------------------------- */
/* API-backed repository                                                      */
/* -------------------------------------------------------------------------- */

export class ApiCreditContractsRepository
  implements CreditContractsRepository
{
  private listeners = new Set<() => void>();

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error(
          "Credit contract subscriber error:",
          error,
        );
      }
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Contracts                                                              */
  /* ---------------------------------------------------------------------- */

  async getContracts(): Promise<CreditContract[]> {
    const response = await apiRequest<unknown>("", {
      method: "GET",
    });

    const rows = asArray(unwrapData<unknown>(response));

    return rows
      .map(mapContract)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async getContractById(
    id: string,
  ): Promise<CreditContract | null> {
    if (!id) return null;

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(id)}`,
      {
        method: "GET",
      },
    );

    const data = unwrapData<unknown>(response);

    if (!data) {
      return null;
    }

    return mapContract(data);
  }

  async createContract(
    input: CreditContractInput,
  ): Promise<CreditContract> {
    const response = await apiRequest<unknown>("", {
      method: "POST",
      body: jsonBody(mapContractInput(input)),
    });

    const contract = mapContract(
      unwrapData<unknown>(response),
    );

    this.notify();

    return contract;
  }

  async updateContract(
    id: string,
    input: CreditContractInput,
  ): Promise<CreditContract> {
    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: jsonBody(mapContractInput(input)),
      },
    );

    const contract = mapContract(
      unwrapData<unknown>(response),
    );

    this.notify();

    return contract;
  }

  async activateContract(
    id: string,
  ): Promise<CreditContract> {
    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(id)}/activate`,
      {
        method: "POST",
      },
    );

    const contract = mapContract(
      unwrapData<unknown>(response),
    );

    this.notify();

    return contract;
  }

  async cancelContract(
    id: string,
    reason: string,
  ): Promise<CreditContract> {
    const reasonText = reason?.trim();

    if (!reasonText) {
      throw new Error("A cancellation reason is required.");
    }

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(id)}/cancel`,
      {
        method: "POST",
        body: jsonBody({
          reason: reasonText,
        }),
      },
    );

    const contract = mapContract(
      unwrapData<unknown>(response),
    );

    this.notify();

    return contract;
  }

  /* ---------------------------------------------------------------------- */
  /* Orders                                                                 */
  /* ---------------------------------------------------------------------- */

  async getOrders(
    contractId: string,
  ): Promise<CreditContractOrder[]> {
    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(contractId)}/orders`,
      {
        method: "GET",
      },
    );

    const rows = asArray(unwrapData<unknown>(response));

    return rows
      .map(mapOrder)
      .sort((a, b) => a.orderNumber - b.orderNumber);
  }

  async getAllOrders(): Promise<CreditContractOrder[]> {
    const contracts = await this.getContracts();

    const orderGroups = await Promise.all(
      contracts.map((contract) =>
        this.getOrders(contract.id),
      ),
    );

    return orderGroups
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async getOrderById(
    id: string,
  ): Promise<CreditContractOrder | null> {
    if (!id) return null;

    const orders = await this.getAllOrders();

    return orders.find((order) => order.id === id) ?? null;
  }

  async addOrder(
    contractId: string,
    input: CreditContractOrderInput,
  ): Promise<CreditContractOrder> {
    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(contractId)}/orders`,
      {
        method: "POST",
        body: jsonBody(mapOrderInput(input)),
      },
    );

    const order = mapOrder(
      unwrapData<unknown>(response),
    );

    this.notify();

    return order;
  }

  async updateOrder(
    orderId: string,
    input: CreditContractOrderInput,
  ): Promise<CreditContractOrder> {
    // The API route requires both contractId and orderId.
    const existingOrder = await this.getOrderById(orderId);

    if (!existingOrder) {
      throw new Error("Credit contract order not found.");
    }

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(existingOrder.creditContractId)}` +
        `/orders/${encodeURIComponent(orderId)}`,
      {
        method: "PUT",
        body: jsonBody(mapOrderInput(input)),
      },
    );

    const order = mapOrder(
      unwrapData<unknown>(response),
    );

    this.notify();

    return order;
  }

  async cancelOrder(
    orderId: string,
    reason: string,
  ): Promise<CreditContractOrder> {
    const reasonText = reason?.trim();

    if (!reasonText) {
      throw new Error("A cancellation reason is required.");
    }

    // The API route requires both contractId and orderId.
    const existingOrder = await this.getOrderById(orderId);

    if (!existingOrder) {
      throw new Error("Credit contract order not found.");
    }

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(existingOrder.creditContractId)}` +
        `/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        method: "POST",
        body: jsonBody({
          reason: reasonText,
        }),
      },
    );

    const order = mapOrder(
      unwrapData<unknown>(response),
    );

    this.notify();

    return order;
  }

  /* ---------------------------------------------------------------------- */
  /* Financial report                                                       */
  /* ---------------------------------------------------------------------- */

  async getFinancialReport(
    contractId: string,
  ): Promise<ContractFinancialReport | null> {
    if (!contractId) return null;

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(contractId)}/financial-report`,
      {
        method: "GET",
      },
    );

    const data = unwrapData<unknown>(response);

    if (!data) {
      return null;
    }

    return mapFinancialReport(data);
  }

  async getFinancials(
    contractId: string,
  ): Promise<CreditContractFinancials | null> {
    const [contract, orders, report] = await Promise.all([
      this.getContractById(contractId),
      this.getOrders(contractId),
      this.getFinancialReport(contractId),
    ]);

    if (!contract) {
      return null;
    }

    const completedOrders = orders.filter(
      (order) =>
        order.status === CREDIT_ORDER_STATUS.COMPLETED,
    );

    const progress = getCreditContractProgress(
      contract,
      completedOrders,
    );

    if (!report) {
      return {
        progress,
        payments: buildCreditPaymentSummary({
          amountDue: 0,
        }),
      };
    }

    const invoice = report.invoice;

    const payments = buildCreditPaymentSummary({
      invoiceNumber: invoice?.invoiceNumber,

      invoiceStatus: invoice?.status as
        | Parameters<typeof buildCreditPaymentSummary>[0]["invoiceStatus"]
        | undefined,

      invoiceApproved: invoice?.approved ?? false,

      amountDue: normalizeNumber(report.netAmount),

      paymentConfirmed: invoice?.paymentConfirmed ?? false,

      paymentConfirmedAt: report.paymentConfirmedAt,
    });

    return {
      progress,
      payments,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Payment and withholding                                                */
  /* ---------------------------------------------------------------------- */

  async saveFinancialInformation(
    contractId: string,
    input: ContractFinancialInput,
  ): Promise<CreditContract> {
    const basePath = `/${encodeURIComponent(contractId)}`;

    /*
     * The backend has separate endpoints for payment information and
     * withholding information.
     *
     * These requests are intentionally sequential. They are not one
     * database transaction, so a successful first request is not rolled
     * back if the second request fails.
     */

    if (input.payment === null) {
      await apiRequest<unknown>(
        `${basePath}/payment-information`,
        {
          method: "DELETE",
        },
      );
    } else if (input.payment) {
      const payment = input.payment;

      const paymentPayload = {
        bank: payment.bank.trim(),

        paymentSender: payment.paymentSender.trim(),

        paymentAmount: normalizeNumber(
          payment.paymentAmount,
        ),

        paymentDate: payment.paymentDate
          ? toApiDate(payment.paymentDate)
          : null,

        paymentReferenceNumber:
          payment.paymentReferenceNumber.trim(),

        paymentEvidence: payment.paymentEvidence ?? null,

        remark: payment.remark?.trim() ?? "",
      };

      await apiRequest<unknown>(
        `${basePath}/payment-information`,
        {
          method: "PUT",
          body: jsonBody(paymentPayload),
        },
      );
    }

    const withholdingPayload = {
      enabled: input.withholding.enabled,

      evidence: input.withholding.enabled
        ? input.withholding.evidence ?? null
        : input.withholding.evidence ?? null,
    };

    await apiRequest<unknown>(
      `${basePath}/withholding`,
      {
        method: "PUT",
        body: jsonBody(withholdingPayload),
      },
    );

    const updatedContract = await this.getContractById(
      contractId,
    );

    if (!updatedContract) {
      throw new Error(
        "Financial information was saved, but the credit contract could not be reloaded.",
      );
    }

    this.notify();

    return updatedContract;
  }

  /* ---------------------------------------------------------------------- */
  /* Finalization                                                           */
  /* ---------------------------------------------------------------------- */

  async finalizeContract(
    id: string,
    input: CreditFinalizationInput,
  ): Promise<{
    contract: CreditContract;
    invoiceId: string;
    invoiceNumber: string;
  }> {
    const fsNo = input.fsNo?.trim();

    if (!fsNo) {
      throw new Error("FS No is required to finalize the contract.");
    }

    /*
     * Finalization is handled entirely by the backend.
     *
     * The backend:
     *   1. Validates completed orders.
     *   2. Checks the FS No.
     *   3. Creates one consolidated Sales Invoice.
     *   4. Links the invoice to the credit contract.
     *
     * Do not call salesInvoicesRepository.createInvoice() here.
     */

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(id)}/finalize`,
      {
        method: "POST",
        body: jsonBody({
          fsNo,
          reason: input.reason?.trim() ?? "",
        }),
      },
    );

    const result = asObject(
      unwrapData<unknown>(response),
    );

    const invoiceId = asString(result.invoiceId);
    const invoiceNumber = asString(result.invoiceNumber);

    if (!invoiceId || !invoiceNumber) {
      throw new Error(
        "The contract was finalized, but the API did not return the Sales Invoice information.",
      );
    }

    const contract = await this.getContractById(id);

    if (!contract) {
      throw new Error(
        "The contract was finalized, but it could not be reloaded.",
      );
    }

    this.notify();

    return {
      contract,
      invoiceId,
      invoiceNumber,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Single repository instance                                                 */
/* -------------------------------------------------------------------------- */

/**
 * All credit-contract pages and hooks should use this API-backed instance.
 *
 * LocalCreditContractsRepository is intentionally no longer the active
 * repository. The backend is the source of truth.
 */
export const creditContractsRepository: CreditContractsRepository =
  new ApiCreditContractsRepository();

/* -------------------------------------------------------------------------- */
/* Completed orders helper                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Completed, non-cancelled orders — the royalty-eligible set.
 */
export function completedCreditOrders(
  orders: CreditContractOrder[],
): CreditContractOrder[] {
  return orders.filter(
    (order) => order.status === CREDIT_ORDER_STATUS.COMPLETED,
  );
}