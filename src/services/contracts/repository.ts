
/**
 * Contracts repository — backend-persisted data layer.
 *
 * All contract and order data is read from and persisted through
 * the CodeIgniter Contracts API.
 *
 * Contract lifecycle:
 * DRAFT -> ACTIVE -> COMPLETED
 *
 * New contract orders are PENDING until Finance approves them.
 * Pending orders reserve contract value but do not count as fulfillment.
 *
 * No localStorage persistence is used.
 */

import { API_BASE_URL, HR_API_BASE_URL } from "@/lib/api/config";
import { authRepository } from "../auth/authRepository";
import { USER_ROLES, type AuthUser } from "../auth/types";
import { ORDER_STATUS } from "../sales/types";
import { salesInvoicesRepository } from "../sales/invoiceRepo";
import { normalizeNumber } from "../sales/calc";

import {
  CONTRACT_ORDER_STATUS,
  CONTRACT_STATUS,
  calculateContractOrderTotals,
  canAcceptOrders,
  validateContractInput,
  validateContractOrderInput,
  type Contract,
  type ContractInput,
  type ContractOrder,
  type ContractOrderInput,
  type ContractProgress,
} from "./types";

import {
  validatePaymentInformation,
  validateWithholdingInformation,
  WITHHOLDING_RATE,
  type ContractFinancialInput,
  type ContractFinancialReport,
} from "./financials";

import type { SalesInvoice } from "../sales/invoice";

/* ------------------------------------------------------------------ */
/* Backend API                                                         */
/* ------------------------------------------------------------------ */

const CONTRACT_API_BASE = (API_BASE_URL || HR_API_BASE_URL).replace(/\/+$/, "");
const CONTRACT_API_ROOT = "/api/contracts";

const contractListeners = new Set<() => void>();

function notifyContractListeners(): void {
  contractListeners.forEach((listener) => listener());
}

function getContractAuthToken(): string | null {
  const session = authRepository.getSession() as any;

  const token =
    session?.token ||
    session?.accessToken ||
    session?.access_token;

  return typeof token === "string" && token.trim()
    ? token.trim()
    : null;
}

async function contractApiRequest<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!CONTRACT_API_BASE) {
    throw new Error(
      "API base URL is missing. Set VITE_API_BASE_URL in the frontend environment.",
    );
  }

  const token = getContractAuthToken();

  if (!token) {
    throw new Error(
      "Your backend authentication token is missing. Please sign in again.",
    );
  }

  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);

  if (
    options.body !== undefined &&
    options.body !== null &&
    !(options.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(
      `${CONTRACT_API_BASE}${CONTRACT_API_ROOT}${path}`,
      {
        ...options,
        headers,
      },
    );
  } catch {
    throw new Error(
      "Unable to connect to the Contracts API. Check the backend URL and network connection.",
    );
  }

  const responseText = await response.text();

  let payload: any = null;

  if (responseText.trim()) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = { message: responseText };
    }
  }

  if (!response.ok || payload?.success === false) {
    const message =
      payload?.messages?.error ??
      payload?.message ??
      payload?.error ??
      payload?.errors ??
      `Contracts API request failed (${response.status}).`;

    throw new Error(
      Array.isArray(message)
        ? message.join(" ")
        : typeof message === "object"
          ? JSON.stringify(message)
          : String(message),
    );
  }

  return (payload?.data ?? payload) as T;
}

async function contractBinaryRequest(
  path: string,
): Promise<Blob> {
  if (!CONTRACT_API_BASE) {
    throw new Error("Contracts API base URL is missing.");
  }

  const token = getContractAuthToken();

  if (!token) {
    throw new Error("Your authentication token is missing.");
  }

  let response: Response;

  try {
    response = await fetch(
      `${CONTRACT_API_BASE}${CONTRACT_API_ROOT}${path}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
  } catch {
    throw new Error("Unable to download the contract attachment.");
  }

  if (!response.ok) {
    throw new Error(
      `Unable to retrieve attachment (${response.status}).`,
    );
  }

  return response.blob();
}

function jsonBody(data: unknown): string {
  return JSON.stringify(data);
}

function contractDateForApi(
  value: number | string | undefined,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("The contract date is invalid.");
  }

  return date.toISOString().slice(0, 10);
}

function paymentDateForApi(
  value: number | string | undefined,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("The payment date is invalid.");
  }

  return date.toISOString().slice(0, 10);
}

function unwrapContractResponse(response: any): Contract {
  const raw =
    response?.contract ??
    response?.data?.contract ??
    response?.data ??
    response;

  if (!raw || typeof raw !== "object" || !raw.id) {
    throw new Error("The backend returned an invalid contract.");
  }

  return raw as Contract;
}

function unwrapArray<T>(response: any): T[] {
  const raw = response?.data ?? response;

  return Array.isArray(raw) ? raw : [];
}

function firstError(
  errors: Record<string, string>,
  fallback: string,
): string {
  return Object.values(errors)[0] ?? fallback;
}

/**
 * Converts the frontend evidence object into a File.
 */
async function evidenceToFile(
  evidence: any,
  fallbackName: string,
): Promise<File | null> {
  if (!evidence) return null;

  if (typeof File !== "undefined" && evidence instanceof File) {
    return evidence;
  }

  if (
    typeof File !== "undefined" &&
    evidence.file instanceof File
  ) {
    return evidence.file;
  }

  if (
    typeof File !== "undefined" &&
    evidence.rawFile instanceof File
  ) {
    return evidence.rawFile;
  }

  const fileUrl =
    typeof evidence === "string"
      ? evidence
      : evidence.fileUrl || evidence.url || evidence.previewUrl;

  if (
    typeof fileUrl === "string" &&
    fileUrl.startsWith("blob:")
  ) {
    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new Error(`Could not read evidence file: ${fallbackName}`);
    }

    const blob = await response.blob();

    return new File(
      [blob],
      evidence.fileName || evidence.name || fallbackName,
      {
        type:
          evidence.mimeType ||
          evidence.type ||
          blob.type ||
          "application/octet-stream",
      },
    );
  }

  return null;
}

function appendField(
  formData: FormData,
  key: string,
  value: unknown,
): void {
  if (value !== undefined && value !== null) {
    formData.append(key, String(value));
  }
}

async function getContractFromApi(
  id: string,
): Promise<Contract | null> {
  const response = await contractApiRequest<any>(
    `/${encodeURIComponent(id)}`,
  );

  return unwrapContractResponse(response);
}

async function getOrdersFromApi(
  contractId: string,
): Promise<ContractOrder[]> {
  const response = await contractApiRequest<any>(
    `/${encodeURIComponent(contractId)}/orders`,
  );

  return unwrapArray<ContractOrder>(response);
}

async function getAllOrdersFromApi(): Promise<ContractOrder[]> {
  const response = await contractApiRequest<any>("/all-orders");

  return unwrapArray<ContractOrder>(response);
}

async function getContractsFromApi(): Promise<Contract[]> {
  const response = await contractApiRequest<any>("/");

  return unwrapArray<Contract>(response);
}

async function postAction(
  path: string,
  data: unknown = {},
): Promise<any> {
  return contractApiRequest(path, {
    method: "POST",
    body: jsonBody(data),
  });
}

async function putData(
  path: string,
  data: unknown,
): Promise<any> {
  return contractApiRequest(path, {
    method: "PUT",
    body: jsonBody(data),
  });
}

/* ------------------------------------------------------------------ */
/* Contract progress calculations                                      */
/* ------------------------------------------------------------------ */

/**
 * Pending and completed orders both reserve contract value.
 * Only completed orders contribute to fulfilled contract progress.
 *
 * This calculation does not change the contract lifecycle.
 */
function calculateProgressFromOrders(
  contract: Contract,
  orders: ContractOrder[],
  backendProgress?: ContractProgress | null,
): ContractProgress {
  const contractValue = Math.max(
    0,
    normalizeNumber(contract.contractValue),
  );

  const relevantOrders = orders.filter(
    (order) =>
      order.status !== CONTRACT_ORDER_STATUS.CANCELLED,
  );

  const fulfilledValue = relevantOrders
    .filter(
      (order) =>
        order.status === CONTRACT_ORDER_STATUS.COMPLETED,
    )
    .reduce(
      (sum, order) =>
        sum + normalizeNumber(order.lineTotalInclVat),
      0,
    );

  const reservedValue = relevantOrders
    .filter(
      (order) =>
        order.status === CONTRACT_ORDER_STATUS.PENDING,
    )
    .reduce(
      (sum, order) =>
        sum + normalizeNumber(order.lineTotalInclVat),
      0,
    );

  const committedValue = fulfilledValue + reservedValue;

  const remainingValue = Math.max(
    0,
    contractValue - fulfilledValue,
  );

  const availableValue = Math.max(
    0,
    contractValue - committedValue,
  );

  return {
    ...(backendProgress ?? {}),
    contractValue,
    fulfilledValue,
    reservedValue,
    remainingValue,
    availableValue,
    overFulfilled: committedValue > contractValue,
  } as ContractProgress;
}

/* ------------------------------------------------------------------ */
/* Errors + authorization                                              */
/* ------------------------------------------------------------------ */

export class ContractPermissionError extends Error {}

interface Caller {
  id: string;
  name: string;
  email?: string;
  role: string;
}

function sessionCaller(action: string): Caller {
  const session = authRepository.getSession();

  if (!session || session.isGuest) {
    throw new ContractPermissionError(
      `Sign in with an authorized account to ${action}.`,
    );
  }

  const user: AuthUser = session.user;

  if (user.accountStatus === "DISABLED") {
    throw new ContractPermissionError(
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

  if (
    caller.role !== USER_ROLES.FINANCE &&
    caller.role !== USER_ROLES.ADMIN
  ) {
    throw new ContractPermissionError(
      `Only Finance can ${action}.`,
    );
  }

  return caller;
}

function requireSales(action: string): Caller {
  const caller = sessionCaller(action);

  if (
    caller.role !== USER_ROLES.SALES &&
    caller.role !== USER_ROLES.ADMIN
  ) {
    throw new ContractPermissionError(
      `Only Sales can ${action}.`,
    );
  }

  return caller;
}

function requireSalesOrFinance(action: string): Caller {
  const caller = sessionCaller(action);

  if (
    caller.role !== USER_ROLES.SALES &&
    caller.role !== USER_ROLES.FINANCE &&
    caller.role !== USER_ROLES.ADMIN
  ) {
    throw new ContractPermissionError(
      `Only Sales or Finance can ${action}.`,
    );
  }

  return caller;
}

function actorLabel(caller: Caller): string {
  return caller.email || caller.name;
}

/* ------------------------------------------------------------------ */
/* Financial helpers                                                   */
/* ------------------------------------------------------------------ */

function validateFinancialInput(
  input: ContractFinancialInput,
): void {
  if (input.payment && input.payment !== null) {
    const validation = validatePaymentInformation(input.payment);

    if (!validation.valid) {
      throw new Error(
        firstError(
          validation.errors,
          "Payment information is incomplete.",
        ),
      );
    }
  }

  if (input.withholding) {
    const validation = validateWithholdingInformation({
      enabled: input.withholding.enabled,
      evidence: input.withholding.evidence,
    });

    if (!validation.valid) {
      throw new Error(
        firstError(
          validation.errors,
          "Withholding information is incomplete.",
        ),
      );
    }
  }
}

function financialPayload(
  input: ContractFinancialInput,
): Record<string, unknown> {
  return {
    ...(input.payment === undefined
      ? {}
      : {
          payment:
            input.payment === null
              ? null
              : {
                  bank: input.payment.bank.trim(),
                  paymentSender: input.payment.paymentSender.trim(),
                  paymentAmount: Math.max(
                    0,
                    normalizeNumber(input.payment.paymentAmount),
                  ),
                  paymentDate: paymentDateForApi(
                    input.payment.paymentDate,
                  ),
                  paymentReferenceNumber:
                    input.payment.paymentReferenceNumber.trim(),
                  paymentEvidence: input.payment.paymentEvidence,
                  remark: input.payment.remark?.trim() || "",
                },
        }),
    withholding: input.withholding
      ? {
          enabled: input.withholding.enabled,
          rate: input.withholding.enabled
            ? WITHHOLDING_RATE
            : 0,
          evidence: input.withholding.enabled
            ? input.withholding.evidence
            : null,
        }
      : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Repository interface                                                */
/* ------------------------------------------------------------------ */

export interface ContractsRepository {
  getContracts(): Promise<Contract[]>;
  getContractById(id: string): Promise<Contract | null>;
  getContractOrders(contractId: string): Promise<ContractOrder[]>;
  getAllOrders(): Promise<ContractOrder[]>;
  getOrderById(id: string): Promise<ContractOrder | null>;
  getContractProgress(contractId: string): Promise<ContractProgress | null>;
  getFinancialReport(id: string): Promise<ContractFinancialReport | null>;

  saveFinancialInformation(
    id: string,
    input: ContractFinancialInput,
  ): Promise<Contract>;

  createContract(input: ContractInput, actor?: string): Promise<Contract>;
  updateContract(id: string, input: ContractInput): Promise<Contract>;
  activateContract(id: string, actor?: string): Promise<Contract>;

  requestCompletion(id: string): Promise<Contract>;

  confirmCompletion(
    id: string,
    reason: string | undefined,
    actor?: string,
  ): Promise<Contract>;

  convertContractToInvoice(
    id: string,
    actor?: string,
  ): Promise<{
    contract: Contract;
    invoiceId: string;
    invoiceNumber: string;
  }>;

  completeOrder(
    contractId: string,
    input: ContractOrderInput,
    actor?: string,
  ): Promise<ContractOrder>;

  approveOrder(orderId: string, actor?: string): Promise<ContractOrder>;

  updateOrder(
    orderId: string,
    input: ContractOrderInput,
    actor?: string,
  ): Promise<ContractOrder>;

  cancelOrder(
    orderId: string,
    reason: string,
    actor?: string,
  ): Promise<ContractOrder>;

  subscribe(listener: () => void): () => void;
}

/* ------------------------------------------------------------------ */
/* Implementation                                                      */
/* ------------------------------------------------------------------ */

export class LocalContractsRepository implements ContractsRepository {
  /* -------------------------------------------------------------- */
  /* Read operations                                                 */
  /* -------------------------------------------------------------- */

  async getContracts(): Promise<Contract[]> {
    const contracts = await getContractsFromApi();

    return contracts.sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  async getContractById(id: string): Promise<Contract | null> {
    return getContractFromApi(id);
  }

  async getContractOrders(
    contractId: string,
  ): Promise<ContractOrder[]> {
    const orders = await getOrdersFromApi(contractId);

    return orders.sort(
      (a, b) => a.orderNumber - b.orderNumber,
    );
  }

  async getAllOrders(): Promise<ContractOrder[]> {
    return getAllOrdersFromApi();
  }

  async getOrderById(id: string): Promise<ContractOrder | null> {
    const orders = await getAllOrdersFromApi();

    return orders.find((order) => order.id === id) ?? null;
  }

  async getContractProgress(
    contractId: string,
  ): Promise<ContractProgress | null> {
    const contract = await getContractFromApi(contractId);

    if (!contract) return null;

    const [backendProgress, orders] = await Promise.all([
      contractApiRequest<ContractProgress>(
        `/${encodeURIComponent(contractId)}/progress`,
      ),
      getOrdersFromApi(contractId),
    ]);

    return calculateProgressFromOrders(
      contract,
      orders,
      backendProgress,
    );
  }

  async getFinancialReport(
    id: string,
  ): Promise<ContractFinancialReport | null> {
    const contract = await getContractFromApi(id);

    if (!contract) return null;

    const report = await contractApiRequest<any>(
      `/${encodeURIComponent(id)}/financial-report`,
    );

    let invoice: SalesInvoice | null = null;
    let invoiceError: string | undefined;

    try {
      const invoices = await salesInvoicesRepository.getInvoices();

      invoice =
        invoices.find((item) => item.contractId === id) ?? null;

      if (!invoice && contract.status === CONTRACT_STATUS.COMPLETED) {
        invoiceError =
          "No Sales Invoice has been created for this completed contract yet.";
      }
    } catch (error) {
      invoiceError =
        error instanceof Error
          ? error.message
          : "The Sales Invoice for this contract could not be loaded.";
    }

    return {
      ...report,
      invoice: invoice ?? report.invoice ?? null,
      invoiceError: invoiceError ?? report.invoiceError,
    } as ContractFinancialReport;
  }

  /* -------------------------------------------------------------- */
  /* Finance — financial information                                 */
  /* -------------------------------------------------------------- */

  async saveFinancialInformation(
    id: string,
    input: ContractFinancialInput,
  ): Promise<Contract> {
    requireFinance(
      "record contract payment and withholding information",
    );

    const current = await getContractFromApi(id);

    if (!current) {
      throw new Error("Contract not found");
    }

    validateFinancialInput(input);

    const payload = financialPayload(input);

    await putData(
      `/${encodeURIComponent(id)}/financial-information`,
      payload,
    );

    const updated = await getContractFromApi(id);

    if (!updated) {
      throw new Error(
        "Financial information was saved, but the contract could not be reloaded.",
      );
    }

    notifyContractListeners();

    return updated;
  }

  /* -------------------------------------------------------------- */
  /* Finance — create contract                                       */
  /* -------------------------------------------------------------- */

  async createContract(
    input: ContractInput,
    actor?: string,
  ): Promise<Contract> {
    const caller = requireFinance("create contracts");

    const validation = validateContractInput(input);

    if (!validation.valid) {
      throw new Error(
        firstError(validation.errors, "Contract is incomplete."),
      );
    }

    const payment = input.payment;

    if (!payment) {
      throw new Error("The initial payment information is required.");
    }

    const contractValue = normalizeNumber(input.contractValue);
    const paymentAmount = normalizeNumber(payment.paymentAmount);

    if (paymentAmount < contractValue) {
      throw new Error(
        "The initial payment amount cannot be less than the contract value.",
      );
    }

    const paymentFile = await evidenceToFile(
      payment.paymentEvidence,
      "payment-evidence",
    );

    const withholdingFile = await evidenceToFile(
      input.withholding?.evidence,
      "withholding-evidence",
    );

    if (input.withholding?.enabled && !withholdingFile) {
      throw new Error(
        "Withholding evidence is required when withholding is enabled.",
      );
    }

    const attachmentInput: any = input.attachments;

    const contractAttachment = Array.isArray(attachmentInput)
      ? attachmentInput[0]
      : attachmentInput;

    const contractFile = await evidenceToFile(
      contractAttachment,
      "contract-attachment",
    );

    const formData = new FormData();

    appendField(
      formData,
      "customerName",
      input.customerName.trim(),
    );

    appendField(
      formData,
      "customerTin",
      input.tin.trim(),
    );

    appendField(
      formData,
      "fsNo",
      input.fsNo.trim(),
    );

    appendField(
      formData,
      "contractValue",
      contractValue,
    );

    appendField(
      formData,
      "contractDate",
      contractDateForApi(input.contractDate),
    );

    appendField(
      formData,
      "remark",
      input.remark?.trim() || "",
    );

    formData.append(
      "payment",
      JSON.stringify({
        bank: payment.bank.trim(),
        paymentSender: payment.paymentSender.trim(),
        paymentAmount,
        paymentDate: paymentDateForApi(payment.paymentDate),
        paymentReferenceNumber:
          payment.paymentReferenceNumber.trim(),
        remark: payment.remark?.trim() || "",
      }),
    );

    formData.append(
      "withholding",
      JSON.stringify({
        enabled: input.withholding?.enabled ?? false,
        rate: input.withholding?.enabled
          ? WITHHOLDING_RATE
          : 0,
      }),
    );

    if (contractFile) {
      formData.append(
        "contractAttachment",
        contractFile,
        contractFile.name,
      );
    }

    if (paymentFile) {
      formData.append(
        "paymentAttachment",
        paymentFile,
        paymentFile.name,
      );
    }

    if (withholdingFile) {
      formData.append(
        "withholdingAttachment",
        withholdingFile,
        withholdingFile.name,
      );
    }

    const response = await contractApiRequest<any>(
      "/",
      {
        method: "POST",
        body: formData,
      },
    );

    const created = unwrapContractResponse(response);

    notifyContractListeners();

    void actor;
    void caller;

    return created;
  }

  /* -------------------------------------------------------------- */
  /* Finance — update contract                                       */
  /* -------------------------------------------------------------- */

  async updateContract(
    id: string,
    input: ContractInput,
  ): Promise<Contract> {
    requireFinance("edit contracts");

    const current = await getContractFromApi(id);

    if (!current) {
      throw new Error("Contract not found");
    }

    const validation = validateContractInput(input);

    if (!validation.valid) {
      throw new Error(
        firstError(validation.errors, "Contract is incomplete."),
      );
    }

    if (current.status !== CONTRACT_STATUS.DRAFT) {
      throw new Error(
        "Only draft contracts can be edited.",
      );
    }

    await putData(
      `/${encodeURIComponent(id)}`,
      {
        customerName: input.customerName.trim(),
        customerTin: input.tin.trim(),
        fsNo: input.fsNo.trim(),
        contractValue: normalizeNumber(input.contractValue),
        contractDate: contractDateForApi(input.contractDate),
        remark: input.remark?.trim() || "",
      },
    );

    const updated = await getContractFromApi(id);

    if (!updated) {
      throw new Error("The updated contract could not be reloaded.");
    }

    notifyContractListeners();

    return updated;
  }

  /* -------------------------------------------------------------- */
  /* Finance — activate contract                                     */
  /* -------------------------------------------------------------- */

  async activateContract(
    id: string,
    actor?: string,
  ): Promise<Contract> {
    const caller = requireFinance("activate contracts");

    const current = await getContractFromApi(id);

    if (!current) {
      throw new Error("Contract not found");
    }

    if (current.status !== CONTRACT_STATUS.DRAFT) {
      throw new Error("Only a Draft contract can be activated.");
    }

    await postAction(
      `/${encodeURIComponent(id)}/activate`,
    );

    const updated = await getContractFromApi(id);

    if (!updated) {
      throw new Error("The activated contract could not be reloaded.");
    }

    notifyContractListeners();

    void actor;
    void caller;

    return updated;
  }

  /* -------------------------------------------------------------- */
  /* Finance — completion review                                     */
  /* -------------------------------------------------------------- */

  async requestCompletion(id: string): Promise<Contract> {
    requireFinance("request contract completion review");

    const current = await getContractFromApi(id);

    if (!current) {
      throw new Error("Contract not found");
    }

    if (current.status !== CONTRACT_STATUS.ACTIVE) {
      throw new Error(
        "Only an active contract can be submitted for completion review.",
      );
    }

    /*
     * The current contract lifecycle does not have a separate
     * READY_FOR_COMPLETION status. Finance confirms completion directly.
     */
    throw new Error(
      "A separate completion-review status is no longer used. Use Confirm Completion to complete this active contract.",
    );
  }

  /* -------------------------------------------------------------- */
  /* Finance — confirm completion                                    */
  /* -------------------------------------------------------------- */

  async confirmCompletion(
    id: string,
    reason: string | undefined,
    actor?: string,
  ): Promise<Contract> {
    requireFinance("confirm contract completion");

    const current = await getContractFromApi(id);

    if (!current) {
      throw new Error("Contract not found");
    }

    if (current.status !== CONTRACT_STATUS.ACTIVE) {
      throw new Error(
        "Only an active contract can be confirmed as completed.",
      );
    }

    const progress = await this.getContractProgress(id);

    if (!progress) {
      throw new Error("Contract progress could not be loaded.");
    }

    const belowValue =
      progress.fulfilledValue < progress.contractValue;

    const reasonText = reason?.trim() ?? "";

    if (belowValue && !reasonText) {
      throw new Error(
        "Closing a contract below its contract value requires a recorded reason.",
      );
    }

    await postAction(
      `/${encodeURIComponent(id)}/confirm-completion`,
      {
        reason: reasonText,
      },
    );

    const updated = await getContractFromApi(id);

    if (!updated) {
      throw new Error("The contract could not be reloaded.");
    }

    notifyContractListeners();

    void actor;

    return updated;
  }

  /* -------------------------------------------------------------- */
  /* Finance — convert completed contract into Sales Invoice        */
  /* -------------------------------------------------------------- */

  async convertContractToInvoice(
    id: string,
    actor?: string,
  ): Promise<{
    contract: Contract;
    invoiceId: string;
    invoiceNumber: string;
  }> {
    const caller = requireFinance(
      "convert completed contracts into Sales Invoices",
    );

    const current = await getContractFromApi(id);

    if (!current) {
      throw new Error("Contract not found");
    }

    if (current.status !== CONTRACT_STATUS.COMPLETED) {
      throw new Error(
        "Finance must confirm contract completion before converting it into a Sales Invoice.",
      );
    }

    if (!current.completionConfirmedAt) {
      throw new Error(
        "Contract completion must be confirmed before conversion.",
      );
    }

    const existingInvoices = await salesInvoicesRepository.getInvoices();

    const existingInvoice = existingInvoices.find(
      (invoice) => invoice.contractId === id,
    );

    if (existingInvoice) {
      return {
        contract: current,
        invoiceId: existingInvoice.id,
        invoiceNumber: existingInvoice.invoiceNumber,
      };
    }

    await postAction(
      `/${encodeURIComponent(id)}/conversion/start`,
    );

    const allOrders = await getOrdersFromApi(id);

    const approvedOrders = allOrders
      .filter(
        (order) =>
          order.status === CONTRACT_ORDER_STATUS.COMPLETED,
      )
      .sort((a, b) => a.orderNumber - b.orderNumber);

    if (!approvedOrders.length) {
      throw new Error(
        "This contract has no approved orders to invoice.",
      );
    }

    try {
      const invoice = await salesInvoicesRepository.createInvoice(
        {
          customer: {
            name: current.customer.name,
            tin: current.customer.tin,
          },
          fsNo: current.fsNo,
          contractId: current.id,
          orders: approvedOrders.map((order) => ({
            aggregate: order.aggregate,
            quantity: order.quantity,
            unitPrice: order.unitPrice,
            royaltyInvoiceNumber: order.royaltyInvoiceNumber,
            contractOrderId: order.id,
            orderDate: order.orderDate,
          })),
          withholdingEnabled: current.withholding?.enabled ?? false,
          withholdingEvidence: current.withholding?.enabled
            ? current.withholding.evidence
            : undefined,
          payment: {
            bank: current.payment?.bank ?? "",
            paymentSender: current.payment?.paymentSender ?? "",
            paymentReferenceNumber:
              current.payment?.paymentReferenceNumber ?? "",
            paymentEvidence: current.payment?.paymentEvidence,
          },
          remark:
            `Converted from Contract ${current.contractNumber} (${approvedOrders.length} approved orders).`,
        },
        {
          status: ORDER_STATUS.PENDING_FINANCE_REVIEW,
          actor: actor ?? actorLabel(caller),
        },
      );

      await postAction(
        `/${encodeURIComponent(id)}/conversion/complete`,
        {
          salesInvoiceId: invoice.id,
        },
      );

      const updatedContract = await getContractFromApi(id);

      if (!updatedContract) {
        throw new Error(
          "The invoice was created, but the contract could not be reloaded.",
        );
      }

      notifyContractListeners();

      return {
        contract: updatedContract,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      try {
        await postAction(
          `/${encodeURIComponent(id)}/conversion/failed`,
          { message },
        );
      } catch {
        // Preserve the original conversion error.
      }

      throw error;
    }
  }

  /* -------------------------------------------------------------- */
  /* Sales — create contract order                                    */
  /* -------------------------------------------------------------- */

  async completeOrder(
    contractId: string,
    input: ContractOrderInput,
    actor?: string,
  ): Promise<ContractOrder> {
    requireSales("create contract orders");

    const contract = await getContractFromApi(contractId);

    if (!contract) {
      throw new Error("Contract not found");
    }

    if (!canAcceptOrders(contract.status)) {
      throw new Error(
        "This contract is not accepting orders. It may already be completed.",
      );
    }

    if (normalizeNumber(contract.contractValue) <= 0) {
      throw new Error(
        `${contract.contractNumber} has no valid contract value. Finance must correct it first.`,
      );
    }

    const validation = validateContractOrderInput(input);

    if (!validation.valid) {
      throw new Error(
        firstError(validation.errors, "Order is incomplete."),
      );
    }

    const totals = calculateContractOrderTotals(input);

    const progress = await this.getContractProgress(contractId);

    if (!progress) {
      throw new Error("Contract progress could not be loaded.");
    }

    const availableValue = Math.max(
      0,
      normalizeNumber(progress.availableValue),
    );

    if (totals.lineTotalInclVat > availableValue) {
      throw new Error(
        `This order exceeds the available contract value. Available: ${availableValue.toLocaleString()}; requested: ${totals.lineTotalInclVat.toLocaleString()}.`,
      );
    }

    /*
     * The backend creates new orders as PENDING.
     * They reserve contract value until Finance approves them.
     */
    const response = await postAction(
      `/${encodeURIComponent(contractId)}/orders`,
      {
        aggregate: input.aggregate,
        quantity: normalizeNumber(input.quantity),
        royaltyInvoiceNumber: input.royaltyInvoiceNumber.trim(),
        orderDate: contractDateForApi(input.orderDate),
      },
    );

    const order = response as ContractOrder;

    notifyContractListeners();

    void actor;

    return order;
  }

  /* -------------------------------------------------------------- */
  /* Finance — approve order                                          */
  /* -------------------------------------------------------------- */

  async approveOrder(
    orderId: string,
    actor?: string,
  ): Promise<ContractOrder> {
    requireFinance("approve contract orders");

    const order = await this.getOrderById(orderId);

    if (!order) {
      throw new Error("Contract order not found.");
    }

    if (order.status === CONTRACT_ORDER_STATUS.COMPLETED) {
      return order;
    }

    if (order.status !== CONTRACT_ORDER_STATUS.PENDING) {
      throw new Error(
        "Only pending contract orders can be approved.",
      );
    }

    /*
     * The backend controller supplied earlier does not yet contain
     * a separate order-approval endpoint. Do not mark an order approved
     * locally or change its status without backend confirmation.
     */
    throw new Error(
      "The backend does not yet provide a contract-order approval endpoint.",
    );
  }

  /* -------------------------------------------------------------- */
  /* Sales / Finance — update order                                   */
  /* -------------------------------------------------------------- */

  async updateOrder(
    orderId: string,
    input: ContractOrderInput,
    actor?: string,
  ): Promise<ContractOrder> {
    const caller = requireSalesOrFinance("correct contract orders");

    const order = await this.getOrderById(orderId);

    if (!order) {
      throw new Error("Contract order not found.");
    }

    const contract = await getContractFromApi(order.contractId);

    if (!contract) {
      throw new Error("Contract not found.");
    }

    if (contract.status === CONTRACT_STATUS.COMPLETED) {
      throw new Error(
        "Orders belonging to a completed contract cannot be edited.",
      );
    }

    if (order.status === CONTRACT_ORDER_STATUS.CANCELLED) {
      throw new Error("A cancelled order cannot be edited.");
    }

    if (
      caller.role === USER_ROLES.SALES &&
      order.completedByUserId !== caller.id &&
      order.createdByUserId !== caller.id
    ) {
      throw new ContractPermissionError(
        "Only the salesperson who created this order — or Finance — can correct it.",
      );
    }

    const validation = validateContractOrderInput(input);

    if (!validation.valid) {
      throw new Error(
        firstError(validation.errors, "Order is incomplete."),
      );
    }

    const totals = calculateContractOrderTotals(input);

    const allOrders = await getOrdersFromApi(contract.id);

    /*
     * Pending and approved orders both reserve contract value.
     * Exclude the current order because its replacement amount is
     * included separately below.
     */
    const otherCommittedOrders = allOrders.filter(
      (item) =>
        item.id !== orderId &&
        (
          item.status === CONTRACT_ORDER_STATUS.PENDING ||
          item.status === CONTRACT_ORDER_STATUS.COMPLETED
        ),
    );

    const otherCommittedValue = otherCommittedOrders.reduce(
      (sum, item) => {
        const lineTotal = normalizeNumber(item.lineTotalInclVat);

        if (lineTotal > 0) {
          return sum + lineTotal;
        }

        return (
          sum +
          calculateContractOrderTotals({
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          }).lineTotalInclVat
        );
      },
      0,
    );

    const newCommittedValue =
      otherCommittedValue + totals.lineTotalInclVat;

    const contractValue = Math.max(
      0,
      normalizeNumber(contract.contractValue),
    );

    if (newCommittedValue > contractValue) {
      throw new Error(
        `This correction would exceed the contract value. Committed after correction: ${newCommittedValue.toLocaleString()}; contract value: ${contractValue.toLocaleString()}.`,
      );
    }

    await putData(
      `/orders/${encodeURIComponent(orderId)}`,
      {
        aggregate: input.aggregate,
        quantity: normalizeNumber(input.quantity),
        royaltyInvoiceNumber: input.royaltyInvoiceNumber.trim(),
        orderDate: contractDateForApi(input.orderDate),
      },
    );

    const updated = await this.getOrderById(orderId);

    if (!updated) {
      throw new Error("The updated order could not be reloaded.");
    }

    notifyContractListeners();

    void actor;

    return updated;
  }

  /* -------------------------------------------------------------- */
  /* Finance — cancel individual order                                */
  /* -------------------------------------------------------------- */

  async cancelOrder(
    orderId: string,
    reason: string,
    actor?: string,
  ): Promise<ContractOrder> {
    requireFinance("cancel contract orders");

    const reasonText = reason?.trim();

    if (!reasonText) {
      throw new Error("A cancellation reason is required.");
    }

    const order = await this.getOrderById(orderId);

    if (!order) {
      throw new Error("Contract order not found.");
    }

    if (order.status === CONTRACT_ORDER_STATUS.CANCELLED) {
      throw new Error("This order is already cancelled.");
    }

    await postAction(
      `/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        reason: reasonText,
      },
    );

    const updated = await this.getOrderById(orderId);

    if (!updated) {
      throw new Error("The cancelled order could not be reloaded.");
    }

    notifyContractListeners();

    void actor;

    return updated;
  }

  /* -------------------------------------------------------------- */
  /* Subscription                                                     */
  /* -------------------------------------------------------------- */

  subscribe(listener: () => void): () => void {
    contractListeners.add(listener);

    return () => {
      contractListeners.delete(listener);
    };
  }
}

/* ------------------------------------------------------------------ */
/* Repository instance                                                 */
/* ------------------------------------------------------------------ */

export const contractsRepository: ContractsRepository =
  new LocalContractsRepository();

/* ------------------------------------------------------------------ */
/* Derived helpers                                                     */
/* ------------------------------------------------------------------ */

export function completedContractOrders(
  orders: ContractOrder[],
): ContractOrder[] {
  return orders.filter(
    (order) => order.status === CONTRACT_ORDER_STATUS.COMPLETED,
  );
}

export function pendingContractOrders(
  orders: ContractOrder[],
): ContractOrder[] {
  return orders.filter(
    (order) => order.status === CONTRACT_ORDER_STATUS.PENDING,
  );
}
