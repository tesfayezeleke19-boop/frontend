
/**
 * API-backed repository — the trusted data layer for standard Contract Orders.
 *
 * All contract and order records are stored by the CodeIgniter backend.
 * No standard contract data is read from or written to localStorage.
 *
 * Frontend permission checks provide immediate feedback. The backend must
 * independently enforce every permission using the authenticated Bearer token.
 */
import { authRepository } from "../auth/authRepository";
import { USER_ROLES, type AuthUser } from "../auth/types";
import { ORDER_STATUS } from "../sales/types";
import { salesInvoicesRepository } from "../sales/invoiceRepo";
import { normalizeNumber } from "../sales/calc";

import { contractsApi } from "./api";

import {
  CONTRACT_ORDER_STATUS,
  CONTRACT_STATUS,
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
  type ContractFinancialInput,
  type ContractFinancialReport,
} from "./financials";

/* ------------------------------------------------------------------ */
/* Errors + authorization                                              */
/* ------------------------------------------------------------------ */

export class ContractPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractPermissionError";
  }
}

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

  if (caller.role !== USER_ROLES.FINANCE) {
    throw new ContractPermissionError(
      `Only Finance can ${action}.`,
    );
  }

  return caller;
}

function requireSales(action: string): Caller {
  const caller = sessionCaller(action);

  if (caller.role !== USER_ROLES.SALES) {
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
    caller.role !== USER_ROLES.FINANCE
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

function firstError(
  errors: Record<string, string>,
  fallback: string,
): string {
  return Object.values(errors)[0] ?? fallback;
}

/* ------------------------------------------------------------------ */
/* Repository change notifications                                    */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

function notifyContractsChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error(
        "Contract refresh listener failed:",
        error,
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function validateContract(input: ContractInput): void {
  const validation = validateContractInput(input);

  if (!validation.valid) {
    throw new Error(
      firstError(
        validation.errors,
        "Contract information is incomplete.",
      ),
    );
  }
}

function validateOrder(input: ContractOrderInput): void {
  const validation = validateContractOrderInput(input);

  if (!validation.valid) {
    throw new Error(
      firstError(
        validation.errors,
        "Contract order information is incomplete.",
      ),
    );
  }
}

function sortContracts(contracts: Contract[]): Contract[] {
  return [...contracts].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}

function sortOrders(orders: ContractOrder[]): ContractOrder[] {
  return [...orders].sort(
    (a, b) => a.orderNumber - b.orderNumber,
  );
}

/**
 * Converts the backend progress response into the exact ContractProgress
 * interface defined in types.ts.
 *
 * Supports both camelCase and snake_case API response properties.
 */
function normalizeProgress(raw: unknown): ContractProgress {
  const data =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};

  const readNumber = (
    ...values: unknown[]
  ): number => {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== "") {
        const parsed = Number(value);

        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return 0;
  };

  const readBoolean = (
    value: unknown,
    fallback: boolean,
  ): boolean => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();

      if (["true", "1", "yes"].includes(normalized)) {
        return true;
      }

      if (["false", "0", "no"].includes(normalized)) {
        return false;
      }
    }

    return fallback;
  };

  const contractValue = Math.max(
    0,
    readNumber(
      data.contractValue,
      data.contract_value,
    ),
  );

  const fulfilledValue = Math.max(
    0,
    readNumber(
      data.fulfilledValue,
      data.fulfilled_value,
    ),
  );

  const remainingValue = Math.max(
    0,
    readNumber(
      data.remainingValue,
      data.remaining_value,
      contractValue - fulfilledValue,
    ),
  );

  const rawFulfillmentPercent = readNumber(
    data.rawFulfillmentPercent,
    data.raw_fulfillment_percent,
    data.fulfillmentPercent,
    data.fulfillment_percent,
    data.fulfillment_percentage,
    contractValue > 0
      ? (fulfilledValue / contractValue) * 100
      : 0,
  );

  const fulfillmentPercent = Math.max(
    0,
    Math.min(
      100,
      readNumber(
        data.fulfillmentPercent,
        data.fulfillment_percent,
        data.fulfillment_percentage,
        rawFulfillmentPercent,
      ),
    ),
  );

  return {
    contractValue,
    fulfilledValue,
    remainingValue,

    overFulfilled: readBoolean(
      data.overFulfilled ?? data.over_fulfilled,
      fulfilledValue > contractValue,
    ),

    orderCount: Math.max(
      0,
      readNumber(
        data.orderCount,
        data.order_count,
        data.totalOrders,
        data.total_orders,
      ),
    ),

    completedOrderCount: Math.max(
      0,
      readNumber(
        data.completedOrderCount,
        data.completed_order_count,
        data.completedOrders,
        data.completed_orders,
      ),
    ),

    fulfillmentPercent,
    rawFulfillmentPercent,

    reachedValue: readBoolean(
      data.reachedValue ?? data.reached_value,
      contractValue > 0 && fulfilledValue >= contractValue,
    ),
  };
}

function isCompletedOrder(order: ContractOrder): boolean {
  return order.status === CONTRACT_ORDER_STATUS.COMPLETED;
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

  getContractProgress(
    contractId: string,
  ): Promise<ContractProgress | null>;

  getFinancialReport(
    id: string,
  ): Promise<ContractFinancialReport | null>;

  saveFinancialInformation(
    id: string,
    input: ContractFinancialInput,
  ): Promise<Contract>;

  createContract(
    input: ContractInput,
    actor?: string,
  ): Promise<Contract>;

  updateContract(
    id: string,
    input: ContractInput,
  ): Promise<Contract>;

  activateContract(
    id: string,
    actor?: string,
  ): Promise<Contract>;

  requestCompletion(id: string): Promise<Contract>;

  confirmCompletion(
    id: string,
    reason: string | undefined,
    actor?: string,
  ): Promise<Contract>;

  cancelContract(
    id: string,
    reason: string,
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
/* API repository                                                      */
/* ------------------------------------------------------------------ */

export class ApiContractsRepository implements ContractsRepository {
  /* ---------------------------------------------------------------- */
  /* Reads                                                             */
  /* ---------------------------------------------------------------- */

  async getContracts(): Promise<Contract[]> {
    const contracts = await contractsApi.getContracts();

    return sortContracts(contracts);
  }

  async getContractById(id: string): Promise<Contract | null> {
    try {
      return await contractsApi.getContract(id);
    } catch (error) {
      if (
        error instanceof Error &&
        (/\b404\b/i.test(error.message) ||
          /not found/i.test(error.message))
      ) {
        return null;
      }

      throw error;
    }
  }

  async getContractOrders(
    contractId: string,
  ): Promise<ContractOrder[]> {
    const orders = await contractsApi.getOrders(contractId);

    return sortOrders(orders);
  }

  async getAllOrders(): Promise<ContractOrder[]> {
    const orders = await contractsApi.getAllOrders();

    return [...orders].sort(
      (a, b) =>
        b.createdAt - a.createdAt ||
        a.orderNumber - b.orderNumber,
    );
  }

  async getOrderById(id: string): Promise<ContractOrder | null> {
    const orders = await contractsApi.getAllOrders();

    return orders.find((order) => order.id === id) ?? null;
  }

  async getContractProgress(
    contractId: string,
  ): Promise<ContractProgress | null> {
    const contract = await this.getContractById(contractId);

    if (!contract) return null;

    const progress = await contractsApi.getProgress(contractId);

    return normalizeProgress(progress);
  }

  async getFinancialReport(
    id: string,
  ): Promise<ContractFinancialReport | null> {
    const contract = await this.getContractById(id);

    if (!contract) return null;

    return contractsApi.getFinancialReport(id);
  }

  /* ---------------------------------------------------------------- */
  /* Finance — financial information                                   */
  /* ---------------------------------------------------------------- */

  async saveFinancialInformation(
    id: string,
    input: ContractFinancialInput,
  ): Promise<Contract> {
    requireFinance(
      "record contract payment and withholding information",
    );

    const current = await this.getContractById(id);

    if (!current) {
      throw new Error("Contract not found.");
    }

    if (current.status === CONTRACT_STATUS.CANCELLED) {
      throw new Error(
        "A cancelled contract cannot take payment or withholding updates.",
      );
    }

    const payment =
      input.payment === null
        ? null
        : input.payment
          ? {
              ...input.payment,
              paymentEvidence:
                input.payment.paymentEvidence ??
                current.payment?.paymentEvidence,
            }
          : undefined;

    const withholdingEvidence = input.withholding.enabled
      ? input.withholding.evidence ??
        current.withholding?.evidence
      : input.withholding.evidence;

    const withholdingValidation =
      validateWithholdingInformation({
        enabled: input.withholding.enabled,
        evidence: withholdingEvidence,
      });

    if (!withholdingValidation.valid) {
      throw new Error(
        firstError(
          withholdingValidation.errors,
          "Withholding information is incomplete.",
        ),
      );
    }

    if (payment) {
      const paymentValidation =
        validatePaymentInformation(payment);

      if (!paymentValidation.valid) {
        throw new Error(
          firstError(
            paymentValidation.errors,
            "Payment information is incomplete.",
          ),
        );
      }
    }

    const updated = await contractsApi.saveFinancialInformation(
      id,
      {
        payment,
        withholding: {
          enabled: input.withholding.enabled,
          evidence: withholdingEvidence,
        },
      },
    );

    notifyContractsChanged();

    return updated;
  }

  /* ---------------------------------------------------------------- */
  /* Finance — contract lifecycle                                      */
  /* ---------------------------------------------------------------- */

  async createContract(
    input: ContractInput,
    actor?: string,
  ): Promise<Contract> {
    requireFinance("create contracts");

    validateContract(input);

    const created = await contractsApi.createContract(input);

    void actor;

    notifyContractsChanged();

    return created;
  }

  async updateContract(
    id: string,
    input: ContractInput,
  ): Promise<Contract> {
    requireFinance("edit contracts");

    validateContract(input);

    const current = await this.getContractById(id);

    if (!current) {
      throw new Error("Contract not found.");
    }

    if (current.status !== CONTRACT_STATUS.DRAFT) {
      throw new Error(
        "Only a Draft contract can be edited. An activated contract keeps its customer, FS No, value, date, and attachments.",
      );
    }

    const updated = await contractsApi.updateContract(id, input);

    notifyContractsChanged();

    return updated;
  }

  async activateContract(
    id: string,
    actor?: string,
  ): Promise<Contract> {
    requireFinance("activate contracts");

    const current = await this.getContractById(id);

    if (!current) {
      throw new Error("Contract not found.");
    }

    if (current.status !== CONTRACT_STATUS.DRAFT) {
      throw new Error("Only a Draft contract can be activated.");
    }

    const updated = await contractsApi.activateContract(id);

    void actor;

    notifyContractsChanged();

    return updated;
  }

  async requestCompletion(id: string): Promise<Contract> {
    requireFinance("request contract completion review");

    const current = await this.getContractById(id);

    if (!current) {
      throw new Error("Contract not found.");
    }

    if (current.status !== CONTRACT_STATUS.IN_PROGRESS) {
      throw new Error(
        "Only an In Progress contract can be flagged for completion review.",
      );
    }

    const updated = await contractsApi.requestCompletion(id);

    notifyContractsChanged();

    return updated;
  }

  async confirmCompletion(
    id: string,
    reason: string | undefined,
    actor?: string,
  ): Promise<Contract> {
    requireFinance("confirm contract completion");

    const current = await this.getContractById(id);

    if (!current) {
      throw new Error("Contract not found.");
    }

    if (
      current.status !== CONTRACT_STATUS.IN_PROGRESS &&
      current.status !== CONTRACT_STATUS.READY_FOR_COMPLETION
    ) {
      throw new Error(
        "Only an active contract can be confirmed as completed.",
      );
    }

    const progress = await contractsApi.getProgress(id);
    const normalizedProgress = normalizeProgress(progress);

    const belowValue =
      normalizedProgress.fulfilledValue <
      normalizedProgress.contractValue;

    if (belowValue && !reason?.trim()) {
      throw new Error(
        "Closing a contract below its contract value requires a recorded reason.",
      );
    }

    const updated = await contractsApi.confirmCompletion(
      id,
      reason?.trim() || undefined,
    );

    void actor;

    notifyContractsChanged();

    return updated;
  }

  async cancelContract(
    id: string,
    reason: string,
    actor?: string,
  ): Promise<Contract> {
    requireFinance("cancel contracts");

    const reasonText = reason?.trim();

    if (!reasonText) {
      throw new Error("A cancellation reason is required.");
    }

    const current = await this.getContractById(id);

    if (!current) {
      throw new Error("Contract not found.");
    }

    if (current.status === CONTRACT_STATUS.CONVERTED) {
      throw new Error(
        "A converted contract has a Sales Invoice and cannot be cancelled.",
      );
    }

    if (current.status === CONTRACT_STATUS.CANCELLED) {
      throw new Error("This contract is already cancelled.");
    }

    const updated = await contractsApi.cancelContract(
      id,
      reasonText,
    );

    void actor;

    notifyContractsChanged();

    return updated;
  }

  /* ---------------------------------------------------------------- */
  /* Finance — conversion into the existing Sales Invoice              */
  /* ---------------------------------------------------------------- */

  async convertContractToInvoice(
    id: string,
    actor?: string,
  ): Promise<{
    contract: Contract;
    invoiceId: string;
    invoiceNumber: string;
  }> {
    const caller = requireFinance(
      "convert contracts into Sales Invoices",
    );

    const current = await this.getContractById(id);

    if (!current) {
      throw new Error("Contract not found.");
    }

    if (
      current.status === CONTRACT_STATUS.CONVERTED &&
      current.salesInvoiceId
    ) {
      const existing =
        await salesInvoicesRepository.getInvoiceById(
          current.salesInvoiceId,
        );

      if (existing) {
        return {
          contract: current,
          invoiceId: existing.id,
          invoiceNumber: existing.invoiceNumber,
        };
      }
    }

    if (current.status === CONTRACT_STATUS.CANCELLED) {
      throw new Error(
        "A cancelled contract cannot be converted.",
      );
    }

    if (!current.completionConfirmedAt) {
      throw new Error(
        "Finance must confirm contract completion before converting it into a Sales Invoice.",
      );
    }

    const orders = (await contractsApi.getOrders(id))
      .filter(isCompletedOrder)
      .sort((a, b) => a.orderNumber - b.orderNumber);

    if (orders.length === 0) {
      throw new Error(
        "This contract has no completed orders — there is nothing to invoice.",
      );
    }

    const existingInvoices =
      await salesInvoicesRepository.getInvoices();

    const adopted = existingInvoices.find(
      (invoice) => invoice.contractId === id,
    );

    if (adopted) {
      const linked = await contractsApi.markConverted(
        id,
        adopted.id,
      );

      notifyContractsChanged();

      return {
        contract: linked,
        invoiceId: adopted.id,
        invoiceNumber: adopted.invoiceNumber,
      };
    }

    await contractsApi.startConversion(id);

    try {
      const invoice = await salesInvoicesRepository.createInvoice(
        {
          customer: {
            name: current.customer.name,
            tin: current.customer.tin,
          },
          fsNo: current.fsNo,
          contractId: current.id,
          orders: orders.map((order) => ({
            aggregate: order.aggregate,
            quantity: order.quantity,
            unitPrice: order.unitPrice,
            royaltyInvoiceNumber: order.royaltyInvoiceNumber,
            contractOrderId: order.id,
            orderDate: order.orderDate,
          })),
          withholdingEnabled:
            current.withholding?.enabled ?? false,
          withholdingEvidence:
            current.withholding?.enabled
              ? current.withholding.evidence
              : undefined,
          payment: {
            bank: current.payment?.bank ?? "",
            paymentSender:
              current.payment?.paymentSender ?? "",
            paymentReferenceNumber:
              current.payment?.paymentReferenceNumber ?? "",
            paymentEvidence:
              current.payment?.paymentEvidence,
          },
          remark: `Converted from Contract ${current.contractNumber} (${orders.length} orders). Payment details are completed before approval.`,
        },
        {
          status: ORDER_STATUS.PENDING_FINANCE_REVIEW,
          actor: actor ?? actorLabel(caller),
        },
      );

      const converted = await contractsApi.markConverted(
        id,
        invoice.id,
      );

      notifyContractsChanged();

      return {
        contract: converted,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      };
    } catch (error) {
      try {
        await contractsApi.markConversionFailed(
          id,
          error instanceof Error
            ? error.message
            : String(error),
        );
      } catch (failureError) {
        console.error(
          "Could not record contract conversion failure:",
          failureError,
        );
      }

      notifyContractsChanged();

      throw error;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Sales — individual orders                                         */
  /* ---------------------------------------------------------------- */

  async completeOrder(
    contractId: string,
    input: ContractOrderInput,
    actor?: string,
  ): Promise<ContractOrder> {
    requireSales("complete contract orders");

    validateOrder(input);

    const contract = await this.getContractById(contractId);

    if (!contract) {
      throw new Error("Contract not found.");
    }

    if (!canAcceptOrders(contract.status)) {
      throw new Error(
        "This contract is not accepting orders — it is cancelled or already converted.",
      );
    }

    const created = await contractsApi.createOrder(
      contractId,
      {
        ...input,
        quantity: normalizeNumber(input.quantity),
        unitPrice: normalizeNumber(input.unitPrice),
        royaltyInvoiceNumber:
          input.royaltyInvoiceNumber.trim(),
      },
    );

    void actor;

    notifyContractsChanged();

    return created;
  }

  async updateOrder(
    orderId: string,
    input: ContractOrderInput,
    actor?: string,
  ): Promise<ContractOrder> {
    const caller = requireSalesOrFinance(
      "correct contract orders",
    );

    validateOrder(input);

    const current = await this.getOrderById(orderId);

    if (!current) {
      throw new Error("Contract order not found.");
    }

    const contract = await this.getContractById(
      current.contractId,
    );

    if (!contract) {
      throw new Error("Contract not found.");
    }

    if (contract.status === CONTRACT_STATUS.CONVERTED) {
      throw new Error(
        "This contract has been converted into a Sales Invoice and its orders are frozen.",
      );
    }

    if (current.status === CONTRACT_ORDER_STATUS.CANCELLED) {
      throw new Error("A cancelled order cannot be edited.");
    }

    if (
      caller.role === USER_ROLES.SALES &&
      current.completedByUserId !== caller.id
    ) {
      throw new ContractPermissionError(
        "Only the salesperson who completed this order — or Finance — can correct it.",
      );
    }

    const updated = await contractsApi.updateOrder(
      orderId,
      {
        ...input,
        quantity: normalizeNumber(input.quantity),
        unitPrice: normalizeNumber(input.unitPrice),
        royaltyInvoiceNumber:
          input.royaltyInvoiceNumber.trim(),
      },
    );

    void actor;

    notifyContractsChanged();

    return updated;
  }

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

    const current = await this.getOrderById(orderId);

    if (!current) {
      throw new Error("Contract order not found.");
    }

    const contract = await this.getContractById(
      current.contractId,
    );

    if (!contract) {
      throw new Error("Contract not found.");
    }

    if (contract.status === CONTRACT_STATUS.CONVERTED) {
      throw new Error(
        "This contract has been converted into a Sales Invoice — its orders can no longer be cancelled here.",
      );
    }

    if (current.status === CONTRACT_ORDER_STATUS.CANCELLED) {
      throw new Error("This order is already cancelled.");
    }

    const cancelled = await contractsApi.cancelOrder(
      orderId,
      reasonText,
    );

    void actor;

    notifyContractsChanged();

    return cancelled;
  }

  /* ---------------------------------------------------------------- */
  /* Subscription                                                      */
  /* ---------------------------------------------------------------- */

  subscribe(listener: () => void): () => void {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }
}

/** Single API-backed repository instance used by the application. */
export const contractsRepository: ContractsRepository =
  new ApiContractsRepository();

/* ------------------------------------------------------------------ */
/* Derived helpers                                                     */
/* ------------------------------------------------------------------ */

/** Completed, non-cancelled orders — the royalty-eligible set. */
export function completedContractOrders(
  orders: ContractOrder[],
): ContractOrder[] {
  return orders.filter(isCompletedOrder);
}
