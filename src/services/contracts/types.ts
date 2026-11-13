/**
 * NexERP — Contract Orders data model.
 *
 * A Contract is a LARGE customer agreement (e.g. 10,000,000 ETB) that is
 * fulfilled through MANY individual orders over time. Contracts belong to
 * the company, not to an individual salesperson: any authorized Sales user
 * can complete an order under any active contract, and each completed order
 * is attributed to the authenticated user who completed it.
 *
 * Lifecycle (independent of the ordinary Sales Invoice lifecycle):
 *
 *   DRAFT → IN_PROGRESS → READY_FOR_COMPLETION → CONVERTED
 *                    └──────────→ CANCELLED
 *
 * A completed contract order is reported in the existing shared Royalty
 * Report immediately — long before the contract is converted into one
 * Sales Invoice. Royalty reporting does NOT complete, convert, or finalize
 * the contract, and the contract lifecycle never changes because of the
 * Royalty Report.
 *
 * Fulfillment basis (see getContractProgress): a contract value is the
 * amount the customer contracted to pay, and the existing Sales Invoice
 * model stores unit prices VAT-EXCLUSIVE with the payable invoice total =
 * subtotal × 1.15. Contract fulfillment therefore uses the VAT-INCLUSIVE
 * order total (quantity × unit price × 1.15) so "fulfilled" and "contract
 * value" are compared on the same payable basis. Royalty reporting keeps
 * its own, unchanged VAT-EXCLUSIVE base (quantity × unit price) — these are
 * two different business calculations and are never mixed.
 *
 * Aggregate codes are preserved as STRINGS ("00" is never 0).
 */
import { normalizeNumber, roundMoney, VAT_DIVISOR } from "../sales/calc";
import { AGGREGATE_TYPES, type AggregateType } from "../sales/types";
import type { FileEvidence } from "../sales/invoice";
import type {
  ContractPaymentHistoryEntry,
  ContractPaymentInformation,
  ContractWithholdingInformation,
} from "./financials";

/* ------------------------------------------------------------------ */
/* Contract lifecycle                                                  */
/* ------------------------------------------------------------------ */

export const CONTRACT_STATUS = {
  DRAFT: "DRAFT",
  IN_PROGRESS: "IN_PROGRESS",
  READY_FOR_COMPLETION: "READY_FOR_COMPLETION",
  CONVERTED: "CONVERTED",
  CANCELLED: "CANCELLED",
} as const;

export type ContractStatus = (typeof CONTRACT_STATUS)[keyof typeof CONTRACT_STATUS];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In Progress",
  READY_FOR_COMPLETION: "Ready for Completion",
  CONVERTED: "Converted",
  CANCELLED: "Cancelled",
};

/** Status → badge styling (same convention as the Sales order badges). */
export const CONTRACT_STATUS_UI: Record<
  ContractStatus,
  { label: string; className: string }
> = {
  DRAFT: { label: "Draft", className: "erp-badge-draft" },
  IN_PROGRESS: { label: "In Progress", className: "erp-badge-pending" },
  READY_FOR_COMPLETION: {
    label: "Ready for Completion",
    className: "erp-badge-pending",
  },
  CONVERTED: { label: "Converted", className: "erp-badge-approved" },
  CANCELLED: { label: "Cancelled", className: "erp-badge-rejected" },
};

/** Contracts that still accept new orders from any authorized Sales user. */
export function canAcceptOrders(status: ContractStatus): boolean {
  return (
    status === CONTRACT_STATUS.IN_PROGRESS ||
    status === CONTRACT_STATUS.READY_FOR_COMPLETION
  );
}

/* ------------------------------------------------------------------ */
/* Contract order lifecycle                                           */
/* ------------------------------------------------------------------ */

/**
 * A contract order has no separate draft workflow: the order form IS the
 * completion action, so a successfully saved order is COMPLETED and is
 * reported for royalty immediately. CANCELLED keeps the record (and its
 * audit trail) but removes it from the active royalty totals.
 */
export const CONTRACT_ORDER_STATUS = {
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export type ContractOrderStatus =
  (typeof CONTRACT_ORDER_STATUS)[keyof typeof CONTRACT_ORDER_STATUS];

/**
 * Attachments reuse the existing API-ready file-evidence model
 * ({ id, fileName, fileUrl, mimeType, fileSize }) — no second attachment
 * model is introduced for contracts.
 */
export type ContractAttachment = FileEvidence;

/** Paper-contract document types accepted by the existing upload pattern. */
export const CONTRACT_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
] as const;

/** `accept` attribute for the paper-contract upload input. */
export const CONTRACT_ATTACHMENT_ACCEPT =
  "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

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
  /** Actor identity (session email/name) that caused the transition. */
  by?: string;
  note?: string;
}

/** A large customer contract fulfilled by many individual orders. */
export interface Contract {
  id: string;
  /** Generated internal contract id — e.g. CONTRACT-0001. Never user-typed. */
  contractNumber: string;
  customer: { name: string; tin: string };
  /**
   * Contract value in ETB, VAT-INCLUSIVE (same payable basis as
   * fulfillment — see getContractProgress).
   */
  contractValue: number;
  /** ONE FS No per contract, carried into the resulting Sales Invoice. */
  fsNo: string;
  contractDate: number;
  /** Signed/original paper contract images or PDFs (contract-level). */
  attachments: ContractAttachment[];
  remark?: string;
  status: ContractStatus;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
  activatedAt?: number;
  activatedBy?: string;
  /** Set when the contract reached its value or Finance requested review. */
  readyAt?: number;
  completionConfirmedAt?: number;
  completionConfirmedBy?: string;
  /** Recorded reason when Finance closes/confirms below the contract value. */
  completionReason?: string;
  closedBelowValue?: boolean;
  /**
   * Finance-recorded payment information. Optional at creation, editable after
   * completion, and NEVER a payment confirmation by itself.
   */
  payment?: ContractPaymentInformation;
  /** Optional withholding decision; the amount is always derived. */
  withholding?: ContractWithholdingInformation;
  /** Append-only audit trail of payment/withholding changes. */
  paymentHistory?: ContractPaymentHistoryEntry[];
  cancelledAt?: number;
  cancelledBy?: string;
  cancellationReason?: string;
  /** Resulting Sales Invoice (set only after invoice creation succeeded). */
  salesInvoiceId?: string;
  salesInvoiceNumber?: string;
  convertedAt?: number;
  convertedBy?: string;
  /** Retry guard: set while a conversion attempt is running. */
  conversionStartedAt?: number;
  conversionError?: string;
  /** Append-only lifecycle history. */
  statusHistory: ContractStatusHistoryEntry[];
}

/** One individual order completed under a contract. */
export interface ContractOrder {
  id: string;
  contractId: string;
  /** Sequential display number inside the contract — "Order 1", "Order 2". */
  orderNumber: number;
  aggregate: AggregateType;
  quantity: number;
  unit: string;
  /** Unit price in ETB per m³, stored per order — later price changes never
   *  recalculate historical orders. */
  unitPrice: number;
  /** VAT-EXCLUSIVE line total (royalty base): quantity × unitPrice. */
  lineTotalExclVat: number;
  /** VAT-INCLUSIVE line total (contract fulfillment basis). */
  lineTotalInclVat: number;
  /** Royalty Invoice Number — per order, supplied by the user (never invented). */
  royaltyInvoiceNumber?: string;
  orderDate: number;
  status: ContractOrderStatus;
  /**
   * Business-facing "Completed By" — the salesperson who completed the order.
   * Preserved across corrections; the editor is recorded separately below.
   */
  completedByUserId: string;
  completedByName: string;
  completedByEmail?: string;
  completedAt: number;
  createdByUserId: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
  /** Audit: who corrected the order most recently (never replaces Completed By). */
  lastEditedByUserId?: string;
  lastEditedByName?: string;
  lastEditedByEmail?: string;
  editedAt?: number;
  cancelledAt?: number;
  cancelledBy?: string;
  cancelReason?: string;
  /** Stable link to this order's Royalty Report entry. */
  royaltySourceKey: string;
}

/* ------------------------------------------------------------------ */
/* Inputs                                                             */
/* ------------------------------------------------------------------ */

export interface ContractInput {
  customerName: string;
  tin: string;
  contractValue: number;
  fsNo: string;
  contractDate: number;
  attachments?: ContractAttachment[];
  remark?: string;
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

/** Next sequential contract number: CONTRACT-0001, CONTRACT-0002, ... */
export function computeNextContractNumber(
  contracts: { contractNumber: string }[],
): string {
  let max = 0;
  for (const contract of contracts) {
    const match = /^CONTRACT-(\d+)$/.exec(contract.contractNumber);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `CONTRACT-${String(max + 1).padStart(4, "0")}`;
}

/**
 * The ONE contract-order money calculation. Quantity and unit price are the
 * stored order values; nothing is recalculated from the contract.
 */
export function calculateContractOrderTotals(order: {
  quantity: unknown;
  unitPrice: unknown;
}): { lineTotalExclVat: number; lineTotalInclVat: number } {
  const quantity = Math.max(0, normalizeNumber(order.quantity));
  const unitPrice = Math.max(0, normalizeNumber(order.unitPrice));
  const lineTotalExclVat = roundMoney(quantity * unitPrice);
  return {
    lineTotalExclVat,
    lineTotalInclVat: roundMoney(lineTotalExclVat * VAT_DIVISOR),
  };
}

/** Stable Royalty Report source reference for a contract order. */
export function royaltySourceKeyForOrder(orderId: string): string {
  return `contract-order:${orderId}`;
}

/**
 * A contract order belongs in the Royalty Report only once it has actually
 * been completed and saved. A cancelled order keeps its record and audit
 * trail but no longer contributes an active royalty amount.
 */
export function isContractOrderRoyaltyReported(order: ContractOrder): boolean {
  return order.status === CONTRACT_ORDER_STATUS.COMPLETED;
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export interface ContractProgress {
  contractValue: number;
  /** Fulfilled value — VAT-inclusive total of the contract's COMPLETED orders. */
  fulfilledValue: number;
  /** Contract Value − Fulfilled Value, never negative. */
  remainingValue: number;
  /** True when fulfilled value exceeds the contract value. */
  overFulfilled: boolean;
  orderCount: number;
  completedOrderCount: number;
  /**
   * Displayed fulfillment percentage — zero-safe and capped with
   * Math.min(100, …) so a contract can never display more than 100%.
   */
  fulfillmentPercent: number;
  /** Unclamped percentage, kept for financial transparency only. */
  rawFulfillmentPercent: number;
  /** True when the contract has reached its full contract value. */
  reachedValue: boolean;
}

/**
 * Contract progress on the documented VAT-INCLUSIVE payable basis.
 * Cancelled orders and orders of other contracts are excluded by callers.
 * Zero contract values never divide by zero.
 */
export function getContractProgress(
  contract: Pick<Contract, "contractValue">,
  orders: Pick<
    ContractOrder,
    "status" | "lineTotalInclVat" | "lineTotalExclVat" | "quantity"
  >[],
): ContractProgress {
  const contractValue = Math.max(0, normalizeNumber(contract.contractValue));
  const active = orders.filter(
    (order) => order.status === CONTRACT_ORDER_STATUS.COMPLETED,
  );
  const fulfilledValue = roundMoney(
    active.reduce(
      (sum, order) => sum + normalizeNumber(order.lineTotalInclVat),
      0,
    ),
  );
  const remainingRaw = roundMoney(contractValue - fulfilledValue);
  const reachedValue = contractValue > 0 && fulfilledValue >= contractValue;
  const rawPercent =
    contractValue > 0
      ? Math.round((fulfilledValue / contractValue) * 10000) / 100
      : 0;
  return {
    contractValue,
    fulfilledValue,
    remainingValue: Math.max(0, remainingRaw),
    overFulfilled: fulfilledValue > contractValue,
    orderCount: orders.length,
    completedOrderCount: active.length,
    // The displayed percentage is capped; the real fulfilled amount is not.
    fulfillmentPercent: Math.max(0, Math.min(100, rawPercent)),
    rawFulfillmentPercent: rawPercent,
    reachedValue,
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

/** Contract form validation (Finance). */
export function validateContractInput(input: ContractInput): ValidationResult {
  const errors: Record<string, string> = {};
  if (!input.customerName?.trim()) {
    errors.customerName = "Customer / Company Name is required";
  }
  if (!input.tin?.trim()) errors.tin = "Customer TIN Number is required";
  if (!input.fsNo?.trim()) errors.fsNo = "FS No is required";
  const value = normalizeNumber(input.contractValue);
  if (!Number.isFinite(input.contractValue) || value < 0) {
    errors.contractValue = "Enter a valid contract value in ETB";
  }
  if (!input.contractDate || Number.isNaN(new Date(input.contractDate).getTime())) {
    errors.contractDate = "A valid contract date is required";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Contract order validation. Required fields follow the existing Sales
 * Invoice order rules (aggregate 00/01/02, quantity > 0, valid unit price,
 * Royalty Invoice Number required on the order form) plus the order date.
 */
export function validateContractOrderInput(
  input: ContractOrderInput,
): ValidationResult {
  const errors: Record<string, string> = {};
  if (!(AGGREGATE_TYPES as readonly string[]).includes(String(input.aggregate))) {
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
  if (!input.orderDate || Number.isNaN(new Date(input.orderDate).getTime())) {
    errors.orderDate = "A valid order date is required";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Attachment validation — type convention; the project has no size rule. */
export function validateContractAttachment(file: {
  name: string;
  type: string;
  size: number;
}): ValidationResult {
  const errors: Record<string, string> = {};
  if (!file.name?.trim()) errors.fileName = "A file name is required";
  if (!isAcceptedContractAttachmentType(file.type)) {
    errors.mimeType = "Only PDF, JPG, and PNG files are accepted";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}
