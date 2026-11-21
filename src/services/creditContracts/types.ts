
/**
 * HATI PLC — Credit Contract data model.
 *
 * Credit contracts are an independent workflow beside standard contracts.
 * They use their own collection, statuses, repository, and pages.
 *
 * Lifecycle:
 *
 *   DRAFT → ACTIVE → INVOICED
 *        └─────→ CANCELLED
 *
 *   DRAFT    Finance is preparing the agreement; Sales cannot add orders.
 *   ACTIVE   Authorized Sales users can add orders.
 *   INVOICED Finance has completed the credit contract and supplied its FS No.
 *            All existing Sales Invoices belonging to the credit contract
 *            receive that FS No. No additional orders are accepted.
 *   CANCELLED No new orders; the record and audit trail are retained.
 *
 * Each credit order is registered as an individual Sales Invoice when created.
 * The royalty invoice number is required when creating the order.
 * FS No is supplied later by Finance when completing the credit contract.
 *
 * All persistence belongs to the backend API. This file contains types,
 * calculations, and validation only. It does not use localStorage.
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
  INVOICED: "Completed",
  CANCELLED: "Cancelled",
};

export const CREDIT_CONTRACT_STATUS_UI: Record<
  CreditContractStatus,
  { label: string; className: string }
> = {
  DRAFT: { label: "Draft", className: "erp-badge-draft" },
  ACTIVE: { label: "Active", className: "erp-badge-pending" },
  INVOICED: { label: "Completed", className: "erp-badge-approved" },
  CANCELLED: { label: "Cancelled", className: "erp-badge-rejected" },
};

/** Only an active credit contract accepts new orders. */
export function creditContractAcceptsOrders(
  status: CreditContractStatus,
): boolean {
  return status === CREDIT_CONTRACT_STATUS.ACTIVE;
}

/** FS No is mandatory only when Finance completes the credit contract. */
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

  /** Own sequence — CREDIT-0001 — distinct from standard contracts. */
  contractNumber: string;

  customer: {
    name: string;
    tin: string;
  };

  /** Empty until Finance completes the credit contract. */
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

  /**
   * Sales Invoices created from this credit contract's individual orders.
   * Each order has its own Sales Invoice.
   */
  salesInvoiceIds?: string[];
  salesInvoiceNumbers?: string[];

  finalizedAt?: number;
  finalizedBy?: string;

  /** Finance-recorded payment information. */
  payment?: ContractPaymentInformation;

  /** Optional withholding decision and information. */
  withholding?: ContractWithholdingInformation;

  /** Append-only audit trail of payment/withholding changes. */
  paymentHistory?: ContractPaymentHistoryEntry[];

  /** Retry guard while a completion attempt is in flight. */
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

/** One order created by a Sales user against a credit contract. */
export interface CreditContractOrder {
  id: string;
  creditContractId: string;

  /** Sequential display number within the contract — 1, 2, 3 … */
  orderNumber: number;

  aggregate: AggregateType;
  quantity: number;
  unit: string;

  /** Unit price at the time of the order. */
  unitPrice: number;

  /** VAT-exclusive line total — royalty base. */
  lineTotalExclVat: number;

  /** VAT-inclusive line total — fulfillment/payment minimum basis. */
  lineTotalInclVat: number;

  /** Required when creating the credit order. */
  royaltyInvoiceNumber: string;

  orderDate: number;
  status: CreditOrderStatus;

  /**
   * Sales Invoice created for this individual credit order.
   * The invoice is registered when the order is created.
   */
  salesInvoiceId?: string;
  salesInvoiceNumber?: string;

  /** Business-facing "Completed By". */
  completedByUserId: string;
  completedByName: string;
  completedByEmail?: string;
  completedAt: number;

  createdByUserId: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;

  /** Audit: who last corrected the order. */
  lastEditedByUserId?: string;
  lastEditedByName?: string;
  lastEditedByEmail?: string;
  editedAt?: number;

  cancelledAt?: number;
  cancelledBy?: string;
  cancelReason?: string;

  /** Stable Royalty Report source reference. */
  royaltySourceKey: string;
}

/* ------------------------------------------------------------------ */
/* Inputs                                                             */
/* ------------------------------------------------------------------ */

export interface CreditContractInput {
  customerName: string;
  tin: string;

  /**
   * No initial contract value and no FS No are required at creation.
   * The minimum completion payment is calculated from completed orders.
   */
  contractDate: number;

  attachments?: ContractAttachment[];
  remark?: string;
}

export interface CreditContractOrderInput {
  aggregate: string;
  quantity: number;
  unitPrice: number;

  /** Required for every credit order. */
  royaltyInvoiceNumber: string;

  orderDate: number;
}

/**
 * Input submitted by Finance when completing an active credit contract.
 *
 * The payment amount must be at least the accumulated completed-order value
 * including VAT. The frontend calculates this minimum from
 * CreditContractTotals.fulfilledValue.
 *
 * paymentDate is a Gregorian YYYY-MM-DD string from the Ethiopian date picker.
 * The picker displays Ethiopian dates while retaining this value format.
 *
 * Evidence files are uploaded by the repository/API. They are not persisted
 * as File objects in the CreditContract record.
 */
export interface CreditContractCompletionInput {
  fsNo: string;

  /** Must be >= completed orders' accumulated value including VAT. */
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

/**
 * Retained for compatibility with existing finalization references.
 * New completion workflow should use CreditContractCompletionInput.
 */
export interface CreditFinalizationInput {
  fsNo: string;
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

    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }

  return `CREDIT-${String(max + 1).padStart(4, "0")}`;
}

/** The one credit-order money calculation. */
export function calculateCreditOrderTotals(order: {
  quantity: unknown;
  unitPrice: unknown;
}): {
  lineTotalExclVat: number;
  lineTotalInclVat: number;
} {
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
/* Accumulated order totals                                            */
/* ------------------------------------------------------------------ */

/**
 * Accumulated totals of completed credit orders.
 *
 * fulfilledValue is VAT-inclusive and is the minimum payment amount
 * required when Finance completes the credit contract.
 *
 * royaltyBase is VAT-exclusive and is used for royalty calculations.
 */
export interface CreditContractTotals {
  /** VAT-inclusive completed-order value. */
  fulfilledValue: number;

  /** VAT-exclusive completed-order value — royalty base. */
  royaltyBase: number;

  orderCount: number;
  completedOrderCount: number;
}

export function getCreditContractTotals(
  orders: Pick<
    CreditContractOrder,
    | "status"
    | "lineTotalInclVat"
    | "lineTotalExclVat"
    | "quantity"
    | "unitPrice"
  >[],
): CreditContractTotals {
  const completed = orders.filter(
    (order) => order.status === CREDIT_ORDER_STATUS.COMPLETED,
  );

  return {
    fulfilledValue: roundMoney(
      completed.reduce(
        (sum, order) => sum + normalizeNumber(order.lineTotalInclVat),
        0,
      ),
    ),

    royaltyBase: roundMoney(
      completed.reduce(
        (sum, order) => sum + normalizeNumber(order.lineTotalExclVat),
        0,
      ),
    ),

    orderCount: orders.length,
    completedOrderCount: completed.length,
  };
}

/**
 * The minimum amount Finance must enter when completing a credit contract.
 * This is the accumulated completed-order value INCLUDING VAT.
 */
export function getCreditContractMinimumPayment(
  orders: Pick<
    CreditContractOrder,
    "status" | "lineTotalInclVat" | "lineTotalExclVat" | "quantity" | "unitPrice"
  >[],
): number {
  return getCreditContractTotals(orders).fulfilledValue;
}

/* ------------------------------------------------------------------ */
/* Payments — derived from Sales Invoice payment confirmation          */
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

  /** True when no invoice exists yet. */
  awaitingFinalization: boolean;
}

export const CREDIT_PAYMENT_STATUS_LABELS: Record<
  CreditPaymentStatus,
  string
> = {
  NOT_INVOICED: "Not invoiced",
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERPAID: "Overpaid",
};

/**
 * Build the payment view from backend-confirmed Sales Invoice payment data.
 *
 * The current Sales Invoice model records one payment confirmation per
 * invoice. A confirmed invoice counts as fully paid; an unconfirmed invoice
 * counts as unpaid.
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

  const outstandingBalance = Math.max(
    0,
    roundMoney(amountDue - amountPaid),
  );

  let status: CreditPaymentStatus;

  if (awaitingFinalization) {
    status = "NOT_INVOICED";
  } else if (amountDue > 0 && amountPaid > amountDue) {
    status = "OVERPAID";
  } else if (amountPaid >= amountDue && amountDue > 0) {
    status = "PAID";
  } else if (amountPaid > 0) {
    status = "PARTIALLY_PAID";
  } else {
    status = "UNPAID";
  }

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

  if (!input.tin?.trim()) {
    errors.tin = "Customer TIN Number is required";
  }

  if (
    !input.contractDate ||
    Number.isNaN(new Date(input.contractDate).getTime())
  ) {
    errors.contractDate = "A valid contract date is required";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
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

/** Finalization validation — retained for existing references. */
export function validateCreditFinalization(
  input: CreditFinalizationInput,
): CreditValidationResult {
  const errors: Record<string, string> = {};

  if (!input.fsNo?.trim()) {
    errors.fsNo = "FS No is required to complete a credit contract";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Finance completion validation.
 *
 * minimumPaymentAmount must be the VAT-inclusive accumulated value of
 * completed orders, obtained from getCreditContractMinimumPayment().
 */
export function validateCreditContractCompletion(
  input: CreditContractCompletionInput,
  minimumPaymentAmount: number,
): CreditValidationResult {
  const errors: Record<string, string> = {};

  if (!input.fsNo?.trim()) {
    errors.fsNo = "FS No is required";
  }

  const paymentAmount = normalizeNumber(input.paymentAmount);
  const minimum = Math.max(0, normalizeNumber(minimumPaymentAmount));

  if (!Number.isFinite(input.paymentAmount) || paymentAmount <= 0) {
    errors.paymentAmount = "Enter a valid payment amount";
  } else if (paymentAmount < minimum) {
    errors.paymentAmount =
      "Payment amount cannot be less than the completed orders' total including VAT";
  }

  if (!input.bank?.trim()) {
    errors.bank = "Bank is required";
  }

  if (!input.paymentSender?.trim()) {
    errors.paymentSender = "Payment sender is required";
  }

  if (!input.paymentDate?.trim()) {
    errors.paymentDate = "Payment date is required";
  } else if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate) ||
    Number.isNaN(new Date(`${input.paymentDate}T00:00:00`).getTime())
  ) {
    errors.paymentDate = "Enter a valid payment date";
  }

  if (!input.paymentReferenceNumber?.trim()) {
    errors.paymentReferenceNumber = "Payment reference number is required";
  }

  if (input.withholdingEnabled && !input.withholdingEvidence) {
    errors.withholdingEvidence =
      "Withholding evidence is required when withholding is enabled";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/* ------------------------------------------------------------------ */
/* Financial report                                                   */
/* ------------------------------------------------------------------ */

export interface CreditContractFinancials {
  totals: CreditContractTotals;
  payments: CreditPaymentSummary;
}
