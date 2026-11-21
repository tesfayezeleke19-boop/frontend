
/**
 * NexERP — Contract Orders data model.
 *
 * Contract values and order fulfillment use the VAT-inclusive payable basis.
 * Pending orders reserve contract value but do not count as approved
 * fulfillment or royalty-report entries.
 *
 * Aggregate codes are preserved as STRINGS ("00" is never 0).
 */
import {
  normalizeNumber,
  roundMoney,
  VAT_DIVISOR,
} from "../sales/calc";
import { AGGREGATE_TYPES, type AggregateType } from "../sales/types";
import type { FileEvidence } from "../sales/invoice";
import type {
  ContractPaymentHistoryEntry,
  ContractPaymentInformation,
  ContractPaymentInput,
  ContractWithholdingInformation,
  ContractWithholdingInput,
} from "./financials";

/* ------------------------------------------------------------------ */
/* Contract lifecycle                                                  */
/* ------------------------------------------------------------------ */

export const CONTRACT_STATUS = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
} as const;

export type ContractStatus =
  (typeof CONTRACT_STATUS)[keyof typeof CONTRACT_STATUS];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  COMPLETED: "Completed",
};

export const CONTRACT_STATUS_UI: Record<
  ContractStatus,
  { label: string; className: string }
> = {
  DRAFT: {
    label: "Draft",
    className: "erp-badge-draft",
  },
  ACTIVE: {
    label: "Active",
    className: "erp-badge-pending",
  },
  COMPLETED: {
    label: "Completed",
    className: "erp-badge-approved",
  },
};

export function canAcceptOrders(status: ContractStatus): boolean {
  return status === CONTRACT_STATUS.ACTIVE;
}

/* ------------------------------------------------------------------ */
/* Contract order lifecycle                                            */
/* ------------------------------------------------------------------ */

export const CONTRACT_ORDER_STATUS = {
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export type ContractOrderStatus =
  (typeof CONTRACT_ORDER_STATUS)[keyof typeof CONTRACT_ORDER_STATUS];

export type ContractAttachment = FileEvidence;

export const MAX_CONTRACT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const CONTRACT_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
] as const;

export const CONTRACT_ATTACHMENT_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

export function isAcceptedContractAttachmentType(mimeType: string): boolean {
  const normalized = (mimeType || "").trim().toLowerCase();

  if (!normalized) return false;
  if (normalized === "image/jpg") return true;

  return (CONTRACT_ATTACHMENT_MIME_TYPES as readonly string[]).includes(
    normalized,
  );
}

export interface ContractStatusHistoryEntry {
  status: ContractStatus;
  at: number;
  by?: string;
  note?: string;
}

export interface Contract {
  id: string;
  contractNumber: string;
  customer: {
    name: string;
    tin: string;
  };

  /** VAT-inclusive contract value. */
  contractValue: number;

  fsNo: string;
  contractDate: number;
  attachments: ContractAttachment[];
  remark?: string;
  status: ContractStatus;

  createdBy?: string;
  createdAt: number;
  updatedAt: number;

  activatedAt?: number;
  activatedBy?: string;

  completionConfirmedAt?: number;
  completionConfirmedBy?: string;
  completionReason?: string;
  closedBelowValue?: boolean;

  /** Finance-recorded payment information. */
  payment?: ContractPaymentInformation;
  withholding?: ContractWithholdingInformation;
  paymentHistory?: ContractPaymentHistoryEntry[];

  statusHistory: ContractStatusHistoryEntry[];
}

export interface ContractOrder {
  id: string;
  contractId: string;
  orderNumber: number;
  aggregate: AggregateType;
  quantity: number;
  unit: string;
  unitPrice: number;

  /** VAT-exclusive royalty calculation base. */
  lineTotalExclVat: number;

  /** VAT-inclusive contract reservation/fulfillment amount. */
  lineTotalInclVat: number;

  royaltyInvoiceNumber?: string;
  orderDate: number;
  status: ContractOrderStatus;

  completedByUserId: string;
  completedByName: string;
  completedByEmail?: string;
  completedAt: number;

  createdByUserId: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;

  lastEditedByUserId?: string;
  lastEditedByName?: string;
  lastEditedByEmail?: string;
  editedAt?: number;

  cancelledAt?: number;
  cancelledBy?: string;
  cancelReason?: string;

  royaltySourceKey: string;
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export interface ContractInput {
  customerName: string;
  tin: string;
  contractValue: number;
  fsNo: string;
  contractDate: number;
  attachments?: ContractAttachment[];
  remark?: string;

  /** Required when creating a contract. */
  payment?: ContractPaymentInput | null;
  withholding?: ContractWithholdingInput;
}

export interface ContractOrderInput {
  aggregate: string;
  quantity: number;
  unitPrice: number;
  royaltyInvoiceNumber: string;
  orderDate: number;
}

/* ------------------------------------------------------------------ */
/* Numbering + calculations                                            */
/* ------------------------------------------------------------------ */

export function computeNextContractNumber(
  contracts: { contractNumber: string }[],
): string {
  let max = 0;

  for (const contract of contracts) {
    const match = /^CONTRACT-(\d+)$/.exec(contract.contractNumber);

    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }

  return `CONTRACT-${String(max + 1).padStart(4, "0")}`;
}

/**
 * Calculate contract order totals using the VAT-inclusive payable basis.
 *
 * Calculation order:
 * 1. Normalize quantity and unit price.
 * 2. Calculate and round the VAT-exclusive subtotal.
 * 3. Apply 15% VAT to that rounded subtotal.
 * 4. Round the VAT-inclusive total to two decimal places.
 *
 * This avoids floating-point discrepancies such as 299999.9999.
 */
export function calculateContractOrderTotals(order: {
  quantity: unknown;
  unitPrice: unknown;
}): { lineTotalExclVat: number; lineTotalInclVat: number } {
  const quantity = Math.max(0, normalizeNumber(order.quantity));
  const unitPrice = Math.max(0, normalizeNumber(order.unitPrice));

  const lineTotalExclVat = roundMoney(quantity * unitPrice);

  const lineTotalInclVat = roundMoney(
    lineTotalExclVat * VAT_DIVISOR,
  );

  return {
    lineTotalExclVat,
    lineTotalInclVat,
  };
}

export function royaltySourceKeyForOrder(orderId: string): string {
  return `contract-order:${orderId}`;
}

/** Only Finance-approved orders are royalty-reported. */
export function isContractOrderRoyaltyReported(
  order: ContractOrder,
): boolean {
  return order.status === CONTRACT_ORDER_STATUS.COMPLETED;
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export interface ContractProgress {
  contractValue: number;

  /** Finance-approved order value. */
  fulfilledValue: number;

  /** Value reserved by pending orders awaiting Finance approval. */
  reservedValue: number;

  /** Remaining value after approved fulfillment only. */
  remainingValue: number;

  /** Available value for creating additional orders. */
  availableValue: number;

  /** True when approved fulfillment plus pending reservations exceed value. */
  overFulfilled: boolean;

  /** Non-cancelled orders only. */
  orderCount: number;
  completedOrderCount: number;
  pendingOrderCount: number;

  /** Official progress based only on Finance-approved orders. */
  fulfillmentPercent: number;

  /** Uncapped official fulfillment percentage. */
  rawFulfillmentPercent: number;

  /** True only when approved fulfillment reaches contract value. */
  reachedValue: boolean;
}

export function getContractProgress(
  contract: Pick<Contract, "contractValue">,
  orders: Pick<
    ContractOrder,
    "status" | "lineTotalInclVat" | "lineTotalExclVat" | "quantity"
  >[],
): ContractProgress {
  const contractValue = Math.max(
    0,
    normalizeNumber(contract.contractValue),
  );

  // Cancelled orders do not count toward fulfillment, reservations,
  // progress, or active order count.
  const activeOrders = orders.filter(
    (order) => order.status !== CONTRACT_ORDER_STATUS.CANCELLED,
  );

  // Finance-approved orders count toward official fulfillment.
  const completed = activeOrders.filter(
    (order) => order.status === CONTRACT_ORDER_STATUS.COMPLETED,
  );

  // Pending orders reserve contract capacity.
  const pending = activeOrders.filter(
    (order) => order.status === CONTRACT_ORDER_STATUS.PENDING,
  );

  const fulfilledValue = roundMoney(
    completed.reduce(
      (sum, order) => sum + normalizeNumber(order.lineTotalInclVat),
      0,
    ),
  );

  const reservedValue = roundMoney(
    pending.reduce(
      (sum, order) => sum + normalizeNumber(order.lineTotalInclVat),
      0,
    ),
  );

  // Official remaining fulfillment excludes only approved orders.
  const remainingValue = Math.max(
    0,
    roundMoney(contractValue - fulfilledValue),
  );

  // Available ordering capacity excludes approved and pending orders.
  const committedValue = roundMoney(
    fulfilledValue + reservedValue,
  );

  const availableValue = Math.max(
    0,
    roundMoney(contractValue - committedValue),
  );

  const rawPercent =
    contractValue > 0
      ? (fulfilledValue / contractValue) * 100
      : 0;

  const rawFulfillmentPercent =
    Math.round((rawPercent + Number.EPSILON) * 100) / 100;

  const reachedValue =
    contractValue > 0 && fulfilledValue >= contractValue;

  return {
    contractValue,
    fulfilledValue,
    reservedValue,
    remainingValue,
    availableValue,
    overFulfilled: committedValue > contractValue,
    orderCount: activeOrders.length,
    completedOrderCount: completed.length,
    pendingOrderCount: pending.length,
    fulfillmentPercent: Math.max(
      0,
      Math.min(100, rawFulfillmentPercent),
    ),
    rawFulfillmentPercent,
    reachedValue,
  };
}

/**
 * A contract can accept another order only when:
 * - its lifecycle status is ACTIVE;
 * - it has a positive contract value;
 * - available capacity remains after approved and pending orders.
 */
export function canAddOrders(
  contract: Pick<Contract, "status" | "contractValue">,
  orders: Pick<
    ContractOrder,
    "status" | "lineTotalInclVat" | "lineTotalExclVat" | "quantity"
  >[],
): boolean {
  if (!canAcceptOrders(contract.status)) return false;

  if (normalizeNumber(contract.contractValue) <= 0) {
    return false;
  }

  return getContractProgress(contract, orders).availableValue > 0;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export function validateContractInput(
  input: ContractInput,
): ValidationResult {
  const errors: Record<string, string> = {};

  if (!input.customerName?.trim()) {
    errors.customerName = "Customer / Company Name is required";
  }

  if (!input.tin?.trim()) {
    errors.tin = "Customer TIN Number is required";
  }

  if (!input.fsNo?.trim()) {
    errors.fsNo = "FS No is required";
  }

  const value = normalizeNumber(input.contractValue);

  if (!Number.isFinite(input.contractValue) || value <= 0) {
    errors.contractValue = "Enter a contract value greater than zero";
  }

  if (
    !input.contractDate ||
    Number.isNaN(new Date(input.contractDate).getTime())
  ) {
    errors.contractDate = "A valid contract date is required";
  }

  // Payment information is mandatory during contract creation.
  if (!input.payment) {
    errors.payment =
      "Payment information is required when creating a contract";
  } else {
    const reportedAmount = normalizeNumber(input.payment.paymentAmount);

    if (
      !Number.isFinite(input.payment.paymentAmount) ||
      reportedAmount < value
    ) {
      errors.paymentAmount =
        "Reported amount cannot be less than the contract value";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateContractOrderInput(
  input: ContractOrderInput,
): ValidationResult {
  const errors: Record<string, string> = {};

  if (
    !(AGGREGATE_TYPES as readonly string[]).includes(
      String(input.aggregate),
    )
  ) {
    errors.aggregate = "Aggregate (00, 01 or 02) is required";
  }

  const quantity = normalizeNumber(input.quantity);

  if (!Number.isFinite(input.quantity) || quantity <= 0) {
    errors.quantity = "Quantity must be greater than zero";
  }

  const unitPrice = normalizeNumber(input.unitPrice);

  if (!Number.isFinite(input.unitPrice) || unitPrice < 0) {
    errors.unitPrice = "Enter a valid unit price";
  }

  if (!input.royaltyInvoiceNumber?.trim()) {
    errors.royaltyInvoiceNumber = "Royalty Invoice Number is required";
  }

  if (
    !input.orderDate ||
    Number.isNaN(new Date(input.orderDate).getTime())
  ) {
    errors.orderDate = "A valid order date is required";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateContractAttachment(file: {
  name: string;
  type: string;
  size: number;
}): ValidationResult {
  const errors: Record<string, string> = {};

  if (!file.name?.trim()) {
    errors.fileName = "A file name is required";
  }

  if (!isAcceptedContractAttachmentType(file.type)) {
    errors.mimeType =
      "Only PDF, JPEG, PNG, and WebP files are accepted";
  }

  if (
    !Number.isFinite(file.size) ||
    file.size < 0 ||
    file.size > MAX_CONTRACT_ATTACHMENT_BYTES
  ) {
    errors.fileSize = "File size must be a valid value not exceeding 10 MB";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
