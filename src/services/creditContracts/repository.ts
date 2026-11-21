
/**
 * Credit Contract repository — backend API implementation.
 *
 * Credit contracts and credit orders are persisted by the backend.
 * This repository does not use localStorage for credit-contract data.
 *
 * FINANCE:
 *   Create / edit drafts / activate / cancel / cancel orders /
 *   record financial information / complete credit contracts.
 *
 * SALES:
 *   View active contracts / add orders / correct own completed orders.
 *
 * IMPORTANT:
 *   Completing a credit contract does not create a new Sales Invoice.
 *   The backend completion endpoint must assign the FS No to the existing
 *   individual Sales Invoices associated with the contract's orders,
 *   save payment information, complete the contract, and freeze its orders
 *   in one database transaction.
 */

import { authRepository } from "../auth/authRepository";
import { USER_ROLES, type AuthUser } from "../auth/types";
import { ORDER_STATUS } from "../sales/types";
import { salesInvoicesRepository } from "../sales/invoiceRepo";
import { normalizeNumber } from "../sales/calc";
import { HR_API_BASE_URL, getHrAuthToken } from "../hr/apiClient";

import {
  notifyCreditContractsChanged,
  subscribeCreditContracts,
} from "./storage";

import {
  CREDIT_CONTRACT_STATUS,
  CREDIT_ORDER_STATUS,
  buildCreditPaymentSummary,
  creditContractAcceptsOrders,
  creditRoyaltySourceKey,
  getCreditContractTotals,
  validateCreditContractInput,
  validateCreditOrderInput,
  type CreditContract,
  type CreditContractInput,
  type CreditContractOrder,
  type CreditContractOrderInput,
  type CreditContractTotals,
  type CreditContractStatus,
  type CreditFinalizationInput,
  type CreditPaymentSummary,
} from "./types";

import type { ContractAttachment } from "../contracts/types";
import type { SalesInvoice } from "../sales/invoice";

import {
  WITHHOLDING_RATE,
  buildContractFinancialReport,
  type ContractFinancialInput,
  type ContractFinancialReport,
} from "../contracts/financials";

/* -------------------------------------------------------------------------- */
/* API configuration                                                          */
/* -------------------------------------------------------------------------- */

const API_BASE = (HR_API_BASE_URL || "").replace(/\/+$/, "");
const API_ROOT = "/api/credit-contracts";

export class CreditContractPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditContractPermissionError";
  }
}

interface Caller {
  id: string;
  name: string;
  email?: string;
  role: string;
}

export interface CreditContractCompletionInput {
  fsNo: string;
  paymentAmount: number;
  bank: string;
  paymentSender: string;
  paymentDate: string;
  paymentReferenceNumber: string;
  paymentEvidence: File | null;
  remark?: string;
  withholdingEnabled: boolean;
  withholdingEvidence: File | null;
}

export interface CreditContractCompletionResult {
  contract: CreditContract;
  invoiceId: string;
  invoiceNumber: string;
  invoiceIds: string[];
  invoiceNumbers: string[];
}

export interface CreditContractFinancials {
  totals: CreditContractTotals;
  payments: CreditPaymentSummary;
}

/* -------------------------------------------------------------------------- */
/* Authentication and permissions                                             */
/* -------------------------------------------------------------------------- */

function sessionCaller(action: string): Caller {
  const session = authRepository.getSession();

  if (!session || session.isGuest) {
    throw new CreditContractPermissionError(
      `Sign in with an authorized account to ${action}.`,
    );
  }

  const user: AuthUser = session.user;

  if (user.accountStatus === "DISABLED") {
    throw new CreditContractPermissionError(
      "This account is disabled. Contact an administrator.",
    );
  }

  return {
    id: user.id,
    name: user.name || user.email || "User",
    email: user.email,
    role: user.role,
  };
}

function requireFinance(action: string): Caller {
  const caller = sessionCaller(action);

  if (caller.role !== USER_ROLES.FINANCE) {
    throw new CreditContractPermissionError(
      `Only Finance can ${action}.`,
    );
  }

  return caller;
}

function requireSales(action: string): Caller {
  const caller = sessionCaller(action);

  if (caller.role !== USER_ROLES.SALES) {
    throw new CreditContractPermissionError(
      `Only Sales can ${action}.`,
    );
  }

  return caller;
}

function requireSalesOrFinance(action: string): Caller {
  const caller = sessionCaller(action);

  if (
    caller.role !== USER_ROLES.SALES &&
    caller.role !== USER_ROLES.FINANCE
  ) {
    throw new CreditContractPermissionError(
      `Only Sales or Finance can ${action}.`,
    );
  }

  return caller;
}

function actorLabel(caller: Caller): string {
  return caller.email || caller.name;
}

/* -------------------------------------------------------------------------- */
/* API request helpers                                                        */
/* -------------------------------------------------------------------------- */

function getAccessToken(): string {
  const token = getHrAuthToken();

  if (!token) {
    throw new CreditContractPermissionError(
      "Your session has expired. Please sign in again.",
    );
  }

  return token;
}

function getErrorMessage(
  payload: unknown,
  fallback: string,
): string {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const data = payload as Record<string, unknown>;

    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }

    if (typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }

    if (data.errors && typeof data.errors === "object") {
      const errors = data.errors as Record<string, unknown>;

      for (const value of Object.values(errors)) {
        if (typeof value === "string" && value.trim()) {
          return value;
        }

        if (Array.isArray(value) && typeof value[0] === "string") {
          return value[0];
        }
      }
    }
  }

  return fallback;
}

function unwrapData<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload
  ) {
    return (payload as { data: T }).data;
  }

  return payload as T;
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!API_BASE) {
    throw new Error("The backend API URL is not configured.");
  }

  const token = getAccessToken();
  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);

  const isFormData =
    typeof FormData !== "undefined" &&
    options.body instanceof FormData;

  if (!isFormData && options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(
    `${API_BASE}${API_ROOT}${path}`,
    {
      ...options,
      headers,
    },
  );

  const responseText = await response.text();

  let payload: unknown = null;

  if (responseText.trim()) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      if (response.ok) {
        throw new Error(
          "The backend returned an invalid response.",
        );
      }

      payload = responseText;
    }
  }

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        payload,
        `Credit contract request failed (${response.status}).`,
      ),
    );
  }

  if (
    payload &&
    typeof payload === "object" &&
    "success" in payload &&
    (payload as { success?: boolean }).success === false
  ) {
    throw new Error(
      getErrorMessage(
        payload,
        "The credit contract request could not be completed.",
      ),
    );
  }

  return unwrapData<T>(payload);
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

function firstError(
  errors: Record<string, string>,
  fallback: string,
): string {
  return Object.values(errors)[0] ?? fallback;
}

/* -------------------------------------------------------------------------- */
/* Response normalization                                                      */
/* -------------------------------------------------------------------------- */

type ApiRecord = Record<string, unknown>;

function asApiRecord(raw: unknown): ApiRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  return raw as ApiRecord;
}


function normalizeContract(raw: unknown): CreditContract {
  const value = asApiRecord(raw);

  const rawCustomer = asApiRecord(value.customer);

  const customer = {
    ...rawCustomer,
    name: String(
      rawCustomer.name ??
        value.customerName ??
        value.customer_name ??
        "",
    ),
    tin: String(
      rawCustomer.tin ??
        value.tin ??
        "",
    ),
  };

  const contractId = String(value.id ?? "");

  let rawAttachments: unknown[] = [];

  if (Array.isArray(value.attachments)) {
    rawAttachments = value.attachments;
  } else if (typeof value.attachments === "string") {
    try {
      const parsed = JSON.parse(value.attachments);
      rawAttachments = Array.isArray(parsed) ? parsed : [];
    } catch {
      rawAttachments = [];
    }
  }

  const attachments = rawAttachments
    .map((item): ContractAttachment | null => {
      // Backend currently stores attachment UUIDs as strings.
      if (typeof item === "string") {
        const attachmentId = item.trim();

        if (!attachmentId || attachmentId === "undefined") {
          return null;
        }

        return {
          id: attachmentId,
          fileName: "Contract Attachment",
          mimeType: "",
          fileSize: 0,
          fileUrl:
            `/api/credit-contracts/${encodeURIComponent(contractId)}` +
            `/attachments/${encodeURIComponent(attachmentId)}`,
        };
      }

      // Also support attachment objects returned by the backend.
      const attachment = asApiRecord(item);

      const attachmentId = String(
        attachment.id ??
          attachment.attachmentId ??
          attachment.attachment_id ??
          "",
      );

      if (!attachmentId || attachmentId === "undefined") {
        return null;
      }

      return {
        id: attachmentId,
        fileName: String(
          attachment.fileName ??
            attachment.file_name ??
            "Contract Attachment",
        ),
        mimeType: String(
          attachment.mimeType ??
            attachment.mime_type ??
            "application/octet-stream",
        ),
        fileSize: Number(
          attachment.fileSize ??
            attachment.file_size ??
            0,
        ),
        fileUrl: String(
          attachment.fileUrl ??
            attachment.file_url ??
            (
              `/api/credit-contracts/${encodeURIComponent(contractId)}` +
              `/attachments/${encodeURIComponent(attachmentId)}`
            ),
        ),
      };
    })
    .filter(
      (attachment): attachment is ContractAttachment =>
        attachment !== null,
    );

  const statusHistory = Array.isArray(
    value.statusHistory ?? value.status_history,
  )
    ? value.statusHistory ?? value.status_history
    : [];

  return {
    ...value,
    id: contractId,
    contractNumber: String(
      value.contractNumber ??
        value.contract_number ??
        "",
    ),
    customer: customer as CreditContract["customer"],
    fsNo: String(value.fsNo ?? value.fs_no ?? ""),
    contractDate: String(
      value.contractDate ??
        value.contract_date ??
        "",
    ),
    attachments:
      attachments as CreditContract["attachments"],
    status: String(
      value.status ?? CREDIT_CONTRACT_STATUS.DRAFT,
    ) as CreditContractStatus,
    createdAt: Number(
      value.createdAt ??
        value.created_at ??
        0,
    ),
    updatedAt: Number(
      value.updatedAt ??
        value.updated_at ??
        0,
    ),
    statusHistory:
      statusHistory as CreditContract["statusHistory"],
  } as unknown as CreditContract;
}


function normalizeOrder(raw: unknown): CreditContractOrder {
  const value = asApiRecord(raw);

  const id = String(value.id ?? "");

  return {
    ...value,
    id,
    creditContractId: String(
      value.creditContractId ??
        value.credit_contract_id ??
        "",
    ),
    orderNumber: Number(
      value.orderNumber ??
        value.order_number ??
        0,
    ),
    aggregate:
      value.aggregate as CreditContractOrder["aggregate"],
    quantity: normalizeNumber(value.quantity),
    unit: String(value.unit ?? "m³"),
    unitPrice: normalizeNumber(
      value.unitPrice ?? value.unit_price,
    ),
    lineTotalExclVat: normalizeNumber(
      value.lineTotalExclVat ??
        value.line_total_excl_vat,
    ),
    lineTotalInclVat: normalizeNumber(
      value.lineTotalInclVat ??
        value.line_total_incl_vat,
    ),
    royaltyInvoiceNumber: String(
      value.royaltyInvoiceNumber ??
        value.royalty_invoice_number ??
        "",
    ),
    orderDate: String(
      value.orderDate ??
        value.order_date ??
        "",
    ),
    status: String(
      value.status ?? CREDIT_ORDER_STATUS.COMPLETED,
    ) as CreditContractOrder["status"],
    royaltySourceKey: String(
      value.royaltySourceKey ??
        value.royalty_source_key ??
        creditRoyaltySourceKey(id),
    ),
  } as unknown as CreditContractOrder;
}

function normalizeContracts(raw: unknown): CreditContract[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeContract);
}

function normalizeOrders(raw: unknown): CreditContractOrder[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeOrder);
}

/* -------------------------------------------------------------------------- */
/* Attachment normalization                                                    */
/* -------------------------------------------------------------------------- */

function normalizeAttachment(
  raw: unknown,
  contractId: string,
): ContractAttachment {
  const value = asApiRecord(raw);

  const id = String(
    value.id ??
      value.attachmentId ??
      value.attachment_id ??
      "",
  );

  const fileName = String(
    value.fileName ??
      value.file_name ??
      "",
  );

  const mimeType = String(
    value.mimeType ??
      value.mime_type ??
      "",
  );

  const fileSize = normalizeNumber(
    value.fileSize ??
      value.file_size ??
      0,
  );

  const suppliedUrl = String(
    value.fileUrl ??
      value.file_url ??
      "",
  );

  return {
    id,
    fileName,
    mimeType,
    fileSize,
    fileUrl:
      suppliedUrl ||
      (id
        ? `${API_ROOT}/${encodeURIComponent(contractId)}/attachments/${encodeURIComponent(id)}`
        : ""),
  } as ContractAttachment;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

function validateCompletionInput(
  input: CreditContractCompletionInput,
  minimumPaymentAmount: number,
): void {
  if (!input.fsNo?.trim()) {
    throw new Error("FS No is required.");
  }

  if (!input.bank?.trim()) {
    throw new Error("Bank is required.");
  }

  if (!input.paymentSender?.trim()) {
    throw new Error("Payment sender is required.");
  }

  if (!input.paymentDate?.trim()) {
    throw new Error("Payment date is required.");
  }

  if (!input.paymentReferenceNumber?.trim()) {
    throw new Error("Payment reference number is required.");
  }

  if (!input.paymentEvidence) {
    throw new Error("Payment evidence is required.");
  }

  const amount = normalizeNumber(input.paymentAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter a valid payment amount.");
  }

  if (amount < minimumPaymentAmount) {
    throw new Error(
      `Payment amount cannot be less than ${minimumPaymentAmount.toLocaleString()}.`,
    );
  }

  if (
    input.withholdingEnabled &&
    !input.withholdingEvidence
  ) {
    throw new Error(
      "Withholding evidence is required when withholding is enabled.",
    );
  }
}

function toCompletionFormData(
  input: CreditContractCompletionInput,
  caller: Caller,
): FormData {
  const formData = new FormData();

  formData.append("fsNo", input.fsNo.trim());
  formData.append(
    "paymentAmount",
    String(normalizeNumber(input.paymentAmount)),
  );
  formData.append("bank", input.bank.trim());
  formData.append("paymentSender", input.paymentSender.trim());
  formData.append("paymentDate", input.paymentDate);
  formData.append(
    "paymentReferenceNumber",
    input.paymentReferenceNumber.trim(),
  );
  formData.append(
    "withholdingEnabled",
    String(input.withholdingEnabled),
  );
  formData.append("remark", input.remark?.trim() ?? "");
  formData.append("completedBy", actorLabel(caller));

  if (input.paymentEvidence) {
    formData.append(
      "paymentEvidence",
      input.paymentEvidence,
      input.paymentEvidence.name,
    );
  }

  if (input.withholdingEnabled && input.withholdingEvidence) {
    formData.append(
      "withholdingEvidence",
      input.withholdingEvidence,
      input.withholdingEvidence.name,
    );
  }

  return formData;
}

/* -------------------------------------------------------------------------- */
/* Repository contract                                                         */
/* -------------------------------------------------------------------------- */

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

  createContract(input: CreditContractInput): Promise<CreditContract>;

  updateContract(
    id: string,
    input: CreditContractInput,
  ): Promise<CreditContract>;

  uploadAttachment(
    contractId: string,
    file: File,
  ): Promise<ContractAttachment>;

  activateContract(id: string): Promise<CreditContract>;

  cancelContract(
    id: string,
    reason: string,
  ): Promise<CreditContract>;

  finalizeContract(
    id: string,
    input: CreditContractCompletionInput | CreditFinalizationInput,
  ): Promise<CreditContractCompletionResult>;

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
/* API repository                                                              */
/* -------------------------------------------------------------------------- */

export class ApiCreditContractsRepository
  implements CreditContractsRepository
{
  /* ------------------------------------------------------------------------ */
  /* Reads                                                                    */
  /* ------------------------------------------------------------------------ */

  async getContracts(): Promise<CreditContract[]> {
    const response = await apiRequest<unknown>("", {
      method: "GET",
    });

    return normalizeContracts(response).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  async getContractById(
    id: string,
  ): Promise<CreditContract | null> {
    try {
      const response = await apiRequest<unknown>(
        `/${encodeURIComponent(id)}`,
        { method: "GET" },
      );

      return normalizeContract(response);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes("not found")
      ) {
        return null;
      }

      throw error;
    }
  }

  async getOrders(
    contractId: string,
  ): Promise<CreditContractOrder[]> {
    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(contractId)}/orders`,
      { method: "GET" },
    );

    return normalizeOrders(response).sort(
      (a, b) => a.orderNumber - b.orderNumber,
    );
  }

  /**
   * Retrieve all orders using the existing contract-specific orders route.
   */
  async getAllOrders(): Promise<CreditContractOrder[]> {
    const contracts = await this.getContracts();

    const ordersByContract = await Promise.all(
      contracts.map((contract) => this.getOrders(contract.id)),
    );

    return ordersByContract
      .flat()
      .sort((a, b) => a.orderNumber - b.orderNumber);
  }

  async getOrderById(
    id: string,
  ): Promise<CreditContractOrder | null> {
    const orders = await this.getAllOrders();

    return orders.find((order) => order.id === id) ?? null;
  }

  /* ------------------------------------------------------------------------ */
  /* Credit contract attachments                                              */
  /* ------------------------------------------------------------------------ */

  /**
   * Upload a paper contract attachment to the credit-contract-specific
   * attachment endpoint.
   *
   * This does not use the Sales Invoice attachment endpoint.
   *
   * Backend endpoint:
   * POST /api/credit-contracts/{contractId}/attachments
   *
   * FormData field:
   * file
   */
  async uploadAttachment(
    contractId: string,
    file: File,
  ): Promise<ContractAttachment> {
    requireFinance("upload credit contract attachments");

    if (!contractId.trim()) {
      throw new Error("Credit contract ID is required.");
    }

    if (!(file instanceof File)) {
      throw new Error("Select a valid attachment file.");
    }

    const formData = new FormData();

    formData.append("file", file, file.name);

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(contractId)}/attachments`,
      {
        method: "POST",
        body: formData,
      },
    );

    const attachment = normalizeAttachment(
      response,
      contractId,
    );

    if (!attachment.id) {
      throw new Error(
        "The backend uploaded the file but did not return an attachment ID.",
      );
    }

    notifyCreditContractsChanged();

    return attachment;
  }

  /* ------------------------------------------------------------------------ */
  /* Financial information                                                    */
  /* ------------------------------------------------------------------------ */

  async getFinancials(
    contractId: string,
  ): Promise<CreditContractFinancials | null> {
    const contract = await this.getContractById(contractId);

    if (!contract) return null;

    const [orders, invoices] = await Promise.all([
      this.getOrders(contractId),
      salesInvoicesRepository.getInvoices(),
    ]);

    const totals = getCreditContractTotals(orders);

    const linkedInvoices = getInvoicesForCreditContract(
      contractId,
      orders,
      invoices,
    );

    const amountDue = linkedInvoices.reduce(
      (sum, invoice) => sum + invoiceAmountDue(invoice),
      0,
    );

    const allApproved =
      linkedInvoices.length > 0 &&
      linkedInvoices.every(invoiceIsApproved);

    const allPaymentConfirmed =
      linkedInvoices.length > 0 &&
      linkedInvoices.every(
        (invoice) =>
          invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED,
      );

    const payments = buildCreditPaymentSummary({
      invoiceNumber: linkedInvoices
        .map((invoice) => invoice.invoiceNumber)
        .filter(Boolean)
        .join(", "),
      invoiceStatus: allPaymentConfirmed
        ? ORDER_STATUS.PAYMENT_CONFIRMED
        : allApproved
          ? ORDER_STATUS.FINANCE_APPROVED
          : linkedInvoices[0]?.status,
      invoiceApproved: allApproved,
      amountDue,
      paymentConfirmed: allPaymentConfirmed,
      paymentConfirmedAt:
        linkedInvoices.length > 0
          ? linkedInvoices
              .map((invoice) => invoice.paymentConfirmedAt)
              .filter(Boolean)
              .sort()
              .slice(-1)[0]
          : undefined,
    });

    return {
      totals,
      payments,
    };
  }

  async getFinancialReport(
  contractId: string,
): Promise<ContractFinancialReport | null> {
  const contract = await this.getContractById(contractId);

  if (!contract) return null;

  const [
    orders,
    invoices,
    financialResponse,
  ] = await Promise.all([
    this.getOrders(contractId),
    salesInvoicesRepository.getInvoices(),
    apiRequest<unknown>(
      `/${encodeURIComponent(contractId)}/financial-report`,
      { method: "GET" },
    ),
  ]);

  const financialData = asApiRecord(financialResponse);

  const completed = orders.filter(
    (order) => order.status === CREDIT_ORDER_STATUS.COMPLETED,
  );

  const totals = getCreditContractTotals(completed);

  const linkedInvoices = getInvoicesForCreditContract(
    contractId,
    orders,
    invoices,
  );

  const invoice = linkedInvoices[0] ?? null;

  /**
   * Convert backend date values into the timestamp format
   * expected by the frontend financial report.
   */
  const normalizeFinancialDate = (
    value: unknown,
  ): number | undefined => {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }

    if (typeof value === "number") {
      return value;
    }

    const timestamp = Date.parse(String(value));

    return Number.isNaN(timestamp) ? undefined : timestamp;
  };

  /**
   * Normalize evidence returned by attachmentDetails().
   * Preserve the backend-provided file URL.
   */
  const normalizeFinancialEvidence = (
    raw: unknown,
  ): NonNullable<
    NonNullable<ContractFinancialReport["payment"]>["paymentEvidence"]
  > | undefined => {
    if (!raw || typeof raw !== "object") {
      return undefined;
    }

    const evidence = asApiRecord(raw);

    return {
      ...evidence,
      id: String(
        evidence.id ??
          evidence.attachmentId ??
          evidence.attachment_id ??
          "",
      ),
      fileName: String(
        evidence.fileName ??
          evidence.file_name ??
          "",
      ),
      mimeType: String(
        evidence.mimeType ??
          evidence.mime_type ??
          "",
      ),
      fileSize: normalizeNumber(
        evidence.fileSize ??
          evidence.file_size ??
          0,
      ),
      fileUrl: String(
        evidence.fileUrl ??
          evidence.file_url ??
          "",
      ),
    } as NonNullable<
      NonNullable<ContractFinancialReport["payment"]>["paymentEvidence"]
    >;
  };

  const rawPayment = asApiRecord(financialData.payment);
  const rawWithholding = asApiRecord(financialData.withholding);

  const payment = financialData.payment
    ? {
        bank: String(rawPayment.bank ?? ""),
        paymentSender: String(
          rawPayment.paymentSender ??
            rawPayment.payment_sender ??
            "",
        ),
        paymentAmount: normalizeNumber(
          rawPayment.paymentAmount ??
            rawPayment.payment_amount ??
            0,
        ),
        paymentDate: normalizeFinancialDate(
          rawPayment.paymentDate ??
            rawPayment.payment_date,
        ),
        paymentReferenceNumber: String(
          rawPayment.paymentReferenceNumber ??
            rawPayment.payment_reference_number ??
            "",
        ),
        paymentEvidence: normalizeFinancialEvidence(
          rawPayment.paymentEvidence ??
            rawPayment.evidence,
        ),
        remark: String(rawPayment.remark ?? ""),
        recordedBy: String(
          rawPayment.recordedBy ??
            rawPayment.recorded_by ??
            "",
        ),
        recordedAt: normalizeFinancialDate(
          rawPayment.recordedAt ??
            rawPayment.recorded_at,
        ),
        updatedAt: normalizeFinancialDate(
          rawPayment.updatedAt ??
            rawPayment.updated_at,
        ),
      }
    : undefined;

  const withholding = financialData.withholding
    ? {
        enabled: Boolean(rawWithholding.enabled),
        rate: normalizeNumber(
          rawWithholding.rate ?? WITHHOLDING_RATE,
        ),
        evidence: normalizeFinancialEvidence(
          rawWithholding.evidence,
        ),
        recordedBy: String(
          rawWithholding.recordedBy ??
            rawWithholding.recorded_by ??
            "",
        ),
        recordedAt: normalizeFinancialDate(
          rawWithholding.recordedAt ??
            rawWithholding.recorded_at,
        ),
        updatedAt: normalizeFinancialDate(
          rawWithholding.updatedAt ??
            rawWithholding.updated_at,
        ),
      }
    : undefined;

  const report = buildContractFinancialReport({
    contract: {
      ...contract,
      contractValue: 0,
      finalizedAt: contract.finalizedAt,
      payment,
      withholding,
    },
    completedOrders: completed.map((order) => ({
      quantity: order.quantity,
      unitPrice: order.unitPrice,
    })),
    fulfilledValue: totals.fulfilledValue,
    remainingValue: 0,
    invoice,
    invoiceError:
      contract.status === CREDIT_CONTRACT_STATUS.INVOICED &&
      linkedInvoices.length === 0
        ? "This completed credit contract has no linked Sales Invoices."
        : undefined,
  });

  return {
    ...report,
    payment,
    withholding,
  };
}

  async saveFinancialInformation(
    contractId: string,
    input: ContractFinancialInput,
  ): Promise<CreditContract> {
    requireFinance(
      "record credit contract payment and withholding information",
    );

    const formData = new FormData();

    if (input.payment === null) {
      formData.append("clearPayment", "true");
    } else if (input.payment) {
      const paymentEvidence = input.payment.paymentEvidence;

      formData.append(
        "payment",
        JSON.stringify({
          ...input.payment,
          paymentEvidence:
            typeof File !== "undefined" &&
            paymentEvidence instanceof File
              ? undefined
              : paymentEvidence,
        }),
      );

      if (
        typeof File !== "undefined" &&
        paymentEvidence instanceof File
      ) {
        formData.append(
          "paymentEvidence",
          paymentEvidence,
          paymentEvidence.name,
        );
      }
    }

    if (input.withholding) {
      formData.append(
        "withholding",
        JSON.stringify({
          enabled: input.withholding.enabled,
          rate: input.withholding.enabled ? WITHHOLDING_RATE : 0,
        }),
      );

      const withholdingEvidence = input.withholding.evidence;

      if (
        typeof File !== "undefined" &&
        withholdingEvidence instanceof File
      ) {
        formData.append(
          "withholdingEvidence",
          withholdingEvidence,
          withholdingEvidence.name,
        );
      }
    }

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(contractId)}/financial-information`,
      {
        method: "POST",
        body: formData,
      },
    );

    const updated = normalizeContract(response);
    notifyCreditContractsChanged();

    return updated;
  }

  /* ------------------------------------------------------------------------ */
  /* Finance — contract lifecycle                                             */
  /* ------------------------------------------------------------------------ */

  async createContract(
    input: CreditContractInput,
  ): Promise<CreditContract> {
    const caller = requireFinance("create credit contracts");

    const validation = validateCreditContractInput(input);

    if (!validation.valid) {
      throw new Error(
        firstError(validation.errors, "Contract is incomplete."),
      );
    }

    const response = await apiRequest<unknown>("", {
      method: "POST",
      body: jsonBody({
        customerName: input.customerName.trim(),
        tin: input.tin.trim(),
        contractDate: input.contractDate,
        attachments: input.attachments ?? [],
        remark: input.remark?.trim() || undefined,
        createdBy: actorLabel(caller),
      }),
    });

    const contract = normalizeContract(response);
    notifyCreditContractsChanged();

    return contract;
  }

  async updateContract(
    id: string,
    input: CreditContractInput,
  ): Promise<CreditContract> {
    requireFinance("edit credit contracts");

    const validation = validateCreditContractInput(input);

    if (!validation.valid) {
      throw new Error(
        firstError(validation.errors, "Contract is incomplete."),
      );
    }

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: jsonBody({
          customerName: input.customerName.trim(),
          tin: input.tin.trim(),
          contractDate: input.contractDate,
          attachments: input.attachments,
          remark: input.remark?.trim() || undefined,
        }),
      },
    );

    const contract = normalizeContract(response);
    notifyCreditContractsChanged();

    return contract;
  }

  async activateContract(id: string): Promise<CreditContract> {
    const caller = requireFinance("activate credit contracts");

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(id)}/activate`,
      {
        method: "POST",
        body: jsonBody({
          activatedBy: actorLabel(caller),
        }),
      },
    );

    const contract = normalizeContract(response);
    notifyCreditContractsChanged();

    return contract;
  }

  async cancelContract(
    id: string,
    reason: string,
  ): Promise<CreditContract> {
    const caller = requireFinance("cancel credit contracts");
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
          cancelledBy: actorLabel(caller),
        }),
      },
    );

    const contract = normalizeContract(response);
    notifyCreditContractsChanged();

    return contract;
  }

  /* ------------------------------------------------------------------------ */
  /* Finance — complete credit contract                                       */
  /* ------------------------------------------------------------------------ */

  async finalizeContract(
    id: string,
    input: CreditContractCompletionInput | CreditFinalizationInput,
  ): Promise<CreditContractCompletionResult> {
    const caller = requireFinance("complete credit contracts");

    if (!("paymentAmount" in input)) {
      throw new Error(
        "Credit contract completion requires the payment amount, bank, sender, payment date, reference, and payment evidence.",
      );
    }

    const contract = await this.getContractById(id);

    if (!contract) {
      throw new Error("Credit contract not found.");
    }

    if (contract.status === CREDIT_CONTRACT_STATUS.CANCELLED) {
      throw new Error(
        "A cancelled credit contract cannot be completed.",
      );
    }

    if (contract.status === CREDIT_CONTRACT_STATUS.DRAFT) {
      throw new Error(
        "Activate the credit contract before completing it.",
      );
    }

    if (contract.status === CREDIT_CONTRACT_STATUS.INVOICED) {
      throw new Error(
        "This credit contract has already been completed.",
      );
    }

    const orders = await this.getOrders(id);

    const completedOrders = orders.filter(
      (order) => order.status === CREDIT_ORDER_STATUS.COMPLETED,
    );

    if (completedOrders.length === 0) {
      throw new Error(
        "This credit contract has no completed orders.",
      );
    }

    const totals = getCreditContractTotals(completedOrders);
    const minimumPaymentAmount = totals.fulfilledValue;

    validateCompletionInput(input, minimumPaymentAmount);

    /*
     * The backend must perform this operation atomically:
     *
     * 1. Lock the credit contract and its orders.
     * 2. Confirm it is still active and accepting completion.
     * 3. Confirm all completed orders have their existing individual
     *    Sales Invoices.
     * 4. Assign the supplied FS No to those existing invoices.
     * 5. Save payment and withholding information.
     * 6. Mark the credit contract completed.
     * 7. Prevent any further order creation or modification.
     *
     * This endpoint must NOT create a new consolidated Sales Invoice.
     */
    const response = await apiRequest<{
      contract: unknown;
      invoices?: Array<{
        id: string;
        invoiceNumber: string;
      }>;
      invoiceIds?: string[];
      invoiceNumbers?: string[];
    }>(
      `/${encodeURIComponent(id)}/complete`,
      {
        method: "POST",
        body: toCompletionFormData(input, caller),
      },
    );

    const completedContract = normalizeContract(
      response.contract,
    );

    const invoiceIds =
      response.invoiceIds ??
      response.invoices?.map((invoice) => invoice.id) ??
      [];

    const invoiceNumbers =
      response.invoiceNumbers ??
      response.invoices?.map((invoice) => invoice.invoiceNumber) ??
      [];

    notifyCreditContractsChanged();

    return {
      contract: completedContract,
      invoiceId: invoiceIds[0] ?? "",
      invoiceNumber: invoiceNumbers[0] ?? "",
      invoiceIds,
      invoiceNumbers,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Sales — credit contract orders                                           */
  /* ------------------------------------------------------------------------ */

  async addOrder(
    contractId: string,
    input: CreditContractOrderInput,
  ): Promise<CreditContractOrder> {
    const caller = requireSales("add credit contract orders");

    const contract = await this.getContractById(contractId);

    if (!contract) {
      throw new Error("Credit contract not found.");
    }

    if (!creditContractAcceptsOrders(contract.status)) {
      throw new Error(
        "This credit contract is not accepting orders. It may be a draft, cancelled, or already completed.",
      );
    }

    const validation = validateCreditOrderInput(input);

    if (!validation.valid) {
      throw new Error(
        firstError(validation.errors, "Order is incomplete."),
      );
    }

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(contractId)}/orders`,
      {
        method: "POST",
        body: jsonBody({
          aggregate: input.aggregate,
          quantity: normalizeNumber(input.quantity),
          unit: "m³",
          unitPrice: normalizeNumber(input.unitPrice),
          royaltyInvoiceNumber: input.royaltyInvoiceNumber.trim(),
          orderDate: input.orderDate,
          completedByUserId: caller.id,
          completedByName: caller.name,
          completedByEmail: caller.email,
        }),
      },
    );

    const order = normalizeOrder(response);
    notifyCreditContractsChanged();

    return order;
  }

  async updateOrder(
    orderId: string,
    input: CreditContractOrderInput,
  ): Promise<CreditContractOrder> {
    const caller = requireSalesOrFinance(
      "correct credit contract orders",
    );

    const validation = validateCreditOrderInput(input);

    if (!validation.valid) {
      throw new Error(
        firstError(validation.errors, "Order is incomplete."),
      );
    }

    const existingOrder = await this.getOrderById(orderId);

    if (!existingOrder) {
      throw new Error("Credit contract order not found.");
    }

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(existingOrder.creditContractId)}/orders/${encodeURIComponent(orderId)}`,
      {
        method: "PUT",
        body: jsonBody({
          aggregate: input.aggregate,
          quantity: normalizeNumber(input.quantity),
          unitPrice: normalizeNumber(input.unitPrice),
          royaltyInvoiceNumber: input.royaltyInvoiceNumber.trim(),
          orderDate: input.orderDate,
          editedByUserId: caller.id,
          editedByName: caller.name,
          editedByEmail: caller.email,
        }),
      },
    );

    const order = normalizeOrder(response);
    notifyCreditContractsChanged();

    return order;
  }

  async cancelOrder(
    orderId: string,
    reason: string,
  ): Promise<CreditContractOrder> {
    const caller = requireFinance("cancel credit contract orders");
    const reasonText = reason?.trim();

    if (!reasonText) {
      throw new Error("A cancellation reason is required.");
    }

    const existingOrder = await this.getOrderById(orderId);

    if (!existingOrder) {
      throw new Error("Credit contract order not found.");
    }

    const response = await apiRequest<unknown>(
      `/${encodeURIComponent(existingOrder.creditContractId)}/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        method: "POST",
        body: jsonBody({
          reason: reasonText,
          cancelledBy: actorLabel(caller),
        }),
      },
    );

    const order = normalizeOrder(response);
    notifyCreditContractsChanged();

    return order;
  }

  subscribe(listener: () => void): () => void {
    return subscribeCreditContracts(listener);
  }
}

/* -------------------------------------------------------------------------- */
/* Derived financial helpers                                                  */
/* -------------------------------------------------------------------------- */

function invoiceAmountDue(invoice: SalesInvoice): number {
  const summary = invoice.financialSummary;

  return normalizeNumber(
    summary.withholdingEnabled
      ? summary.netAmountAfterWithholding
      : summary.totalPriceInclVat,
  );
}

function invoiceIsApproved(invoice: SalesInvoice): boolean {
  return (
    invoice.status === ORDER_STATUS.FINANCE_APPROVED ||
    invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED
  );
}

/**
 * Find the existing Sales Invoices associated with a credit contract.
 *
 * The preferred relationship is the credit order's salesInvoiceId.
 * The second relationship is contractOrderId on an invoice order line.
 *
 * This function intentionally does not create or modify invoices.
 */
function getInvoicesForCreditContract(
  contractId: string,
  orders: CreditContractOrder[],
  invoices: SalesInvoice[],
): SalesInvoice[] {
  const orderIds = new Set(orders.map((order) => order.id));

  return invoices.filter((invoice) => {
    if (invoice.contractId === contractId) {
      return true;
    }

    if (
      orders.some(
        (order) =>
          "salesInvoiceId" in order &&
          order.salesInvoiceId === invoice.id,
      )
    ) {
      return true;
    }

    return (
      invoice.orders?.some((line) => {
        const contractOrderId = (
          line as typeof line & {
            contractOrderId?: string;
          }
        ).contractOrderId;

        return Boolean(
          contractOrderId && orderIds.has(contractOrderId),
        );
      }) ?? false
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Application export                                                         */
/* -------------------------------------------------------------------------- */

export const creditContractsRepository: CreditContractsRepository =
  new ApiCreditContractsRepository();

/** Completed, non-cancelled orders — the royalty-eligible set. */
export function completedCreditOrders(
  orders: CreditContractOrder[],
): CreditContractOrder[] {
  return orders.filter(
    (order) => order.status === CREDIT_ORDER_STATUS.COMPLETED,
  );
}
