/**
 * HATI PLC — Credit Contract data model.
 *
 * A credit contract is an ADDITIONAL workflow that sits beside the existing
 * Contract Orders module. It never migrates, reinterprets, or changes standard
 * contracts: it has its own collection, its own statuses, its own repository,
 * and its own pages.
 *
 * What makes it "credit":
 *
 *   - Finance can create it before an FS No exists. No placeholder FS No is
 *     ever invented; the field simply stays empty ("Pending") until the
 *     contract is finalized.
 *   - Any authorized Sales user can add orders to an active credit contract
 *     without an immediate payment for each order.
 *   - Fulfillment, amount paid, and outstanding balance are three separate
 *     measurements. Fulfillment is contract value versus completed orders.
 *     Amount paid comes only from the resulting Sales Invoice's confirmed
 *     payment. They are never derived from one another.
 *
 * Lifecycle:
 *
 *   DRAFT → ACTIVE → INVOICED
 *        └─────→ CANCELLED
 *
 *   DRAFT    Finance is preparing the agreement; Sales cannot add orders.
 *   ACTIVE   Orders can be added by any authorized Sales user.
 *   INVOICED Finance finalized with an FS No; one Sales Invoice now holds the
 *            contract's orders and the contract's orders are frozen.
 *   CANCELLED No new orders; the record and its audit trail are kept.
 */
import { normalizeNumber, roundMoney, VAT_DIVISOR } from "../sales/calc";
import { AGGREGATE_TYPES, type AggregateType } from "../sales/types";
import type { ContractAttachment } from "../contracts/types";
import type {
  ContractPaymentHistoryEntry,
  ContractPaymentInformation,
  ContractWithholdingInformation,
} from "../contracts/financials";

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

export const CREDIT_CONTRACT_STATUS = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  INVOICED: "INVOICED",
  CANCELLED: "CANCELLED",
} as const;

export type CreditContractStatus =
  (typeof CREDIT_CONTRACT_STATUS)[keyof typeof CREDIT_CONTRACT_STATUS];

export const CREDIT_CONTRACT_STATUS_LABELS: Record<
  CreditContractStatus,
  string
> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

export const CREDIT_CONTRACT_STATUS_UI: Record<
  CreditContractStatus,
  { label: string; className: string }
> = {
  DRAFT: { label: "Draft", className: "erp-badge-draft" },
  ACTIVE: { label: "Active", className: "erp-badge-pending" },
  INVOICED: { label: "Invoiced", className: "erp-badge-approved" },
  CANCELLED: { label: "Cancelled", className: "erp-badge-rejected" },
};

/** Only an active credit contract accepts new orders. */
export function creditContractAcceptsOrders(
  status: CreditContractStatus,
): boolean {
  return status === CREDIT_CONTRACT_STATUS.ACTIVE;
}

/** FS No is mandatory only at finalization, never at creation. */
export function requiresFsNoAtCreation(): false {
  return false;
}

/* ------------------------------------------------------------------ */
/* Records                                                            */
/* ------------------------------------------------------------------ */

export interface CreditContractStatusHistoryEntry {
  status: CreditContractStatus;
  at: number;
  by?: string;
  note?: string;
}

export interface CreditContract {
  id: string;
  /** Own sequence — CREDIT-0001 — distinct from CONTRACT-0001. */
  contractNumber: string;
  customer: { name: string; tin: string };
  /** Contract value in ETB, VAT-inclusive (the payable fulfillment basis). */
  contractValue: number;
  /** Empty until Finance finalizes. Never a placeholder. */
  fsNo: string;
  contractDate: number;
  attachments: ContractAttachment[];
  remark?: string;
  status: CreditContractStatus;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
  activatedAt?: number;
  activatedBy?: string;
  /** Set when the Sales Invoice was created by finalization. */
  salesInvoiceId?: string;
  salesInvoiceNumber?: string;
  finalizedAt?: number;
  finalizedBy?: string;
  /** Recorded reason when Finance finalizes below the contract value. */
  finalizationReason?: string;
  closedBelowValue?: boolean;
  /**
   * Finance-recorded payment information. Optional at creation, editable after
   * finalization, and NEVER a payment confirmation by itself.
   */
  payment?: ContractPaymentInformation;
  /** Optional withholding decision; the amount is always derived. */
  withholding?: ContractWithholdingInformation;
  /** Append-only audit trail of payment/withholding changes. */
  paymentHistory?: ContractPaymentHistoryEntry[];
  /** Retry guard while a finalization attempt is in flight. */
  finalizationStartedAt?: number;
  finalizationError?: string;
  cancelledAt?: number;
  cancelledBy?: string;
  cancellationReason?: string;
  statusHistory: CreditContractStatusHistoryEntry[];
}

export const CREDIT_ORDER_STATUS = {
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export type CreditOrderStatus =
  (typeof CREDIT_ORDER_STATUS)[keyof typeof CREDIT_ORDER_STATUS];

/** One order completed by a Sales user against a credit contract. */
export interface CreditContractOrder {
  id: string;
  creditContractId: string;
  /** Sequential display number within the contract — 1, 2, 3 … */
  orderNumber: number;
  aggregate: AggregateType;
  quantity: number;
  unit: string;
  /** Unit price at the time of the order — future price changes never
   *  rewrite historical orders. */
  unitPrice: number;
  /** VAT-exclusive line total (royalty base): quantity × unit price. */
  lineTotalExclVat: number;
  /** VAT-inclusive line total (fulfillment basis). */
  lineTotalInclVat: number;
  royaltyInvoiceNumber?: string;
  orderDate: number;
  status: CreditOrderStatus;
  /**
   * Business-facing "Completed By" — the salesperson who completed the order.
   * Never replaced when somebody else corrects the order.
   */
  completedByUserId: string;
  completedByName: string;
  completedByEmail?: string;
  completedAt: number;
  createdByUserId: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
  /** Audit: who last corrected the order (kept separate from Completed By). */
  lastEditedByUserId?: string;
  lastEditedByName?: string;
  lastEditedByEmail?: string;
  editedAt?: number;
  cancelledAt?: number;
  cancelledBy?: string;
  cancelReason?: string;
  /** Stable Royalty Report source reference — never duplicated per order. */
  royaltySourceKey: string;
}

/* ------------------------------------------------------------------ */
/* Inputs                                                             */
/* ------------------------------------------------------------------ */

export interface CreditContractInput {
  customerName: string;
  tin: string;
  contractValue: number;
  /** Optional: credit contracts are created before an FS No exists. */
  fsNo?: string;
  contractDate: number;
  attachments?: ContractAttachment[];
  remark?: string;
}

export interface CreditContractOrderInput {
  aggregate: string;
  quantity: number;
  unitPrice: number;
  royaltyInvoiceNumber: string;
  orderDate: number;
}

export interface CreditFinalizationInput {
  fsNo: string;
  /** Required when finalizing below the contract value. */
  reason?: string;
}

/* ------------------------------------------------------------------ */
/* Numbering + money                                                  */
/* ------------------------------------------------------------------ */

export function computeNextCreditContractNumber(
  contracts: { contractNumber: string }[],
): string {
  let max = 0;
  for (const contract of contracts) {
    const match = /^CREDIT-(\d+)$/.exec(contract.contractNumber);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `CREDIT-${String(max + 1).padStart(4, "0")}`;
}

/** The one credit-order money calculation (VAT-exclusive royalty base). */
export function calculateCreditOrderTotals(order: {
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

/** Royalty source reference — identical convention to contract orders. */
export function creditRoyaltySourceKey(orderId: string): string {
  return `contract-order:${orderId}`;
}

export function isCreditOrderRoyaltyReported(
  order: CreditContractOrder,
): boolean {
  return order.status === CREDIT_ORDER_STATUS.COMPLETED;
}

/* ------------------------------------------------------------------ */
/* Progress — capped fulfillment                                      */
/* ------------------------------------------------------------------ */

export interface CreditContractProgress {
  contractValue: number;
  /** Actual fulfilled value (never clamped) — over-fulfillment stays visible. */
  fulfilledValue: number;
  /** Remaining value, never negative. */
  remainingValue: number;
  overFulfilled: boolean;
  orderCount: number;
  completedOrderCount: number;
  /** Displayed fulfillment percentage — always between 0 and 100. */
  fulfillmentPercent: number;
  /** True when Finance finalized the contract below its contract value. */
  closedBelowValue?: boolean;
  /** Unclamped percentage, kept for financial transparency. */
  rawFulfillmentPercent: number;
  reachedValue: boolean;
}

/**
 * Credit contract progress.
 *
 * `fulfillmentPercent` is clamped with Math.min(100, …) so a completed or
 * over-completed contract displays exactly 100%; the real fulfilled value and
 * `overFulfilled` keep the underlying financial position visible. Zero-value
 * contracts never divide by zero, and invalid numbers fall back to 0.
 */
export function getCreditContractProgress(
  contract: Pick<CreditContract, "contractValue">,
  orders: Pick<
    CreditContractOrder,
    "status" | "lineTotalInclVat" | "quantity" | "unitPrice"
  >[],
): CreditContractProgress {
  const contractValue = Math.max(0, normalizeNumber(contract.contractValue));
  const active = orders.filter(
    (order) => order.status === CREDIT_ORDER_STATUS.COMPLETED,
  );
  const fulfilledValue = roundMoney(
    active.reduce(
      (sum, order) => sum + normalizeNumber(order.lineTotalInclVat),
      0,
    ),
  );
  const rawPercent =
    contractValue > 0
      ? Math.round((fulfilledValue / contractValue) * 10000) / 100
      : 0;
  return {
    contractValue,
    fulfilledValue,
    remainingValue: Math.max(0, roundMoney(contractValue - fulfilledValue)),
    overFulfilled: fulfilledValue > contractValue,
    orderCount: orders.length,
    completedOrderCount: active.length,
    fulfillmentPercent: Math.max(0, Math.min(100, rawPercent)),
    rawFulfillmentPercent: rawPercent,
    reachedValue: contractValue > 0 && fulfilledValue >= contractValue,
  };
}

/* ------------------------------------------------------------------ */
/* Payments — derived from the resulting Sales Invoice only            */
/* ------------------------------------------------------------------ */

export type CreditPaymentStatus =
  | "NOT_INVOICED"
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERPAID";

export interface CreditPaymentSummary {
  status: CreditPaymentStatus;
  /** Amount due on the resulting invoice; 0 before finalization. */
  amountDue: number;
  /** Amount the backend has actually confirmed as paid. */
  amountPaid: number;
  /** Amount due − amount paid, never negative. */
  outstandingBalance: number;
  invoiceNumber?: string;
  invoiceStatus?: string;
  invoiceApproved: boolean;
  paymentConfirmedAt?: number;
  /** True when no invoice exists yet, so no payment can have been recorded. */
  awaitingFinalization: boolean;
}

export const CREDIT_PAYMENT_STATUS_LABELS: Record<CreditPaymentStatus, string> =
  {
    NOT_INVOICED: "Not invoiced",
    UNPAID: "Unpaid",
    PARTIALLY_PAID: "Partially paid",
    PAID: "Paid",
    OVERPAID: "Overpaid",
  };

/**
 * Build the payment view of a credit contract from its Sales Invoice.
 *
 * The current backend/Sales Invoice model records ONE payment confirmation per
 * invoice (no partial-payment ledger), so a confirmed invoice counts as fully
 * paid and an unconfirmed one counts as nothing paid. Partial amounts are never
 * invented here; when the backend gains a payment ledger this is the only
 * function that needs to change.
 */
export function buildCreditPaymentSummary(input: {
  invoiceNumber?: string;
  invoiceStatus?: string;
  invoiceApproved?: boolean;
  amountDue?: number;
  paymentConfirmed?: boolean;
  paymentConfirmedAt?: number;
}): CreditPaymentSummary {
  const amountDue = Math.max(0, normalizeNumber(input.amountDue ?? 0));
  const awaitingFinalization = !input.invoiceNumber;
  const amountPaid = input.paymentConfirmed ? amountDue : 0;
  const outstandingBalance = Math.max(0, roundMoney(amountDue - amountPaid));

  let status: CreditPaymentStatus;
  if (awaitingFinalization) status = "NOT_INVOICED";
  else if (amountDue > 0 && amountPaid > amountDue) status = "OVERPAID";
  else if (amountPaid >= amountDue && amountDue > 0) status = "PAID";
  else if (amountPaid > 0) status = "PARTIALLY_PAID";
  else status = "UNPAID";

  return {
    status,
    amountDue,
    amountPaid,
    outstandingBalance,
    invoiceNumber: input.invoiceNumber,
    invoiceStatus: input.invoiceStatus,
    invoiceApproved: input.invoiceApproved ?? false,
    paymentConfirmedAt: input.paymentConfirmedAt,
    awaitingFinalization,
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

export interface CreditValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

/** Creation validation — FS No is deliberately NOT required. */
export function validateCreditContractInput(
  input: CreditContractInput,
): CreditValidationResult {
  const errors: Record<string, string> = {};
  if (!input.customerName?.trim()) {
    errors.customerName = "Customer / Company Name is required";
  }
  if (!input.tin?.trim()) errors.tin = "Customer TIN Number is required";
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
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateCreditOrderInput(
  input: CreditContractOrderInput,
): CreditValidationResult {
  const errors: Record<string, string> = {};
  if (
    !(AGGREGATE_TYPES as readonly string[]).includes(String(input.aggregate))
  ) {
    errors.aggregate = "Aggregate (00, 01 or 02) is required";
  }
  const quantity = normalizeNumber(input.quantity);
  if (!Number.isFinite(input.quantity) || quantity <= 0) {
    errors.quantity = "Quantity must be greater than zero";
  }
  const unitPrice = normalizeNumber(input.unitPrice);
  if (!Number.isFinite(input.unitPrice) || unitPrice <= 0) {
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

/** Finalization validation — FS No becomes mandatory here. */
export interface CreditContractFinancials {
  progress: CreditContractProgress;
  payments: CreditPaymentSummary;
}

export function validateCreditFinalization(
  input: CreditFinalizationInput,
  progress: Pick<CreditContractProgress, "fulfilledValue" | "contractValue">,
): CreditValidationResult {
  const errors: Record<string, string> = {};
  if (!input.fsNo?.trim()) {
    errors.fsNo = "FS No is required to finalize a credit contract";
  }
  if (
    progress.fulfilledValue < progress.contractValue &&
    !input.reason?.trim()
  ) {
    errors.reason =
      "A reason is required when finalizing below the contract value";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}
