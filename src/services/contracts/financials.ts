
/**
 * Shared contract financials — payment information, withholding and the
 * completed-contract financial report used by BOTH contract workflows
 * (standard contracts and credit contracts).
 *
 * The Sales Invoice is the reference implementation for payment and
 * withholding behaviour, so this module never introduces a second formula:
 *
 *   - Withholding is ALWAYS computed by `calculateSalesInvoiceTotals`
 *     (3% of the VAT-inclusive total, and only when withholding is enabled).
 *   - Confirmed amounts paid come ONLY from a PAYMENT_CONFIRMED Sales Invoice.
 *     Recording payment information never marks anything as paid.
 *   - Before an invoice exists, the payable figures are a DERIVED PROJECTION
 *     of the completed contract orders and are labelled with
 *     `grossAmountDueBasis: "COMPLETED_ORDERS"`. Nothing is presented as an
 *     authoritative payment or withholding record until the Sales Invoice
 *     exists (`grossAmountDueBasis: "INVOICE"`).
 *
 * Fulfillment and payment stay separate: fulfillment compares completed order
 * value with the contract value; payments only ever describe money received.
 */
import { normalizeNumber, roundMoney } from "../sales/calc";
import {
  WITHHOLDING_RATE,
  calculateSalesInvoiceTotals,
  type FileEvidence,
  type SalesInvoice,
} from "../sales/invoice";
import { ORDER_STATUS } from "../sales/types";

// Re-exported so contract repositories and UI never re-declare the rate.
export { WITHHOLDING_RATE };

/* ------------------------------------------------------------------ */
/* Payment information                                                 */
/* ------------------------------------------------------------------ */

export interface ContractPaymentInformation {
  bank: string;
  paymentSender: string;
  /** Reported/announced payment amount — informational only. */
  paymentAmount: number;
  /** Business date of the reported payment (epoch millis). */
  paymentDate?: number;
  paymentReferenceNumber: string;
  paymentEvidence?: FileEvidence;
  remark?: string;
  /** Audit: the authenticated Finance user who recorded the information. */
  recordedBy?: string;
  recordedAt?: number;
  updatedAt?: number;
}

/** Input gathered by the Finance payment-information form. */
export interface ContractPaymentInput {
  bank: string;
  paymentSender: string;
  paymentAmount: number;
  paymentDate?: number;
  paymentReferenceNumber: string;
  /** `undefined` leaves existing evidence; `null` explicitly removes it. */
  paymentEvidence?: FileEvidence | null;
  remark?: string;
}

/* ------------------------------------------------------------------ */
/* Withholding                                                         */
/* ------------------------------------------------------------------ */

export interface ContractWithholdingInformation {
  enabled: boolean;
  rate: number;
  evidence?: FileEvidence;
  recordedBy?: string;
  recordedAt?: number;
  updatedAt?: number;
}

export interface ContractWithholdingInput {
  enabled: boolean;
  /** `undefined` leaves existing evidence; `null` explicitly removes it. */
  evidence?: FileEvidence | null;
}

/**
 * One atomic write of contract financial information, so payment details and
 * the withholding decision can never land half-saved.
 */
export interface ContractFinancialInput {
  /** `null` clears recorded payment information; `undefined` leaves it as is. */
  payment?: ContractPaymentInput | null;
  withholding: ContractWithholdingInput;
}

export const WITHHOLDING_RATE_LABEL = `${Math.round(WITHHOLDING_RATE * 100)}%`;

/**
 * Normalize a stored payment timestamp to its local calendar day. Existing
 * records may contain noon timestamps from an older entry path; comparison
 * must treat the same calendar date as unchanged.
 */
export function normalizePaymentDate(
  value?: number | null,
): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/** Parse the shared `YYYY-MM-DD` payment-date input into a local date. */
export function parsePaymentDateInput(value: string): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const date = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

/** Format a stored payment timestamp back into the shared date input. */
export function formatPaymentDateInput(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Meaningful payment change detection used by every save path. Strings are
 * trimmed, amounts are normalized, dates are compared by calendar day, and
 * evidence is compared by server attachment id.
 */
export function paymentInformationChanged(
  current: ContractPaymentInformation | undefined,
  next: ContractPaymentInformation,
): boolean {
  if (!current) return true;

  return (
    current.bank.trim() !== next.bank.trim() ||
    current.paymentSender.trim() !== next.paymentSender.trim() ||
    normalizeNumber(current.paymentAmount) !==
      normalizeNumber(next.paymentAmount) ||
    (normalizePaymentDate(current.paymentDate) ?? null) !==
      (normalizePaymentDate(next.paymentDate) ?? null) ||
    current.paymentReferenceNumber.trim() !==
      next.paymentReferenceNumber.trim() ||
    (current.paymentEvidence?.id ?? null) !==
      (next.paymentEvidence?.id ?? null) ||
    (current.remark ?? "").trim() !== (next.remark ?? "").trim()
  );
}

/* ------------------------------------------------------------------ */
/* Audit history                                                       */
/* ------------------------------------------------------------------ */

export type ContractFinancialAction =
  | "PAYMENT_INFORMATION_RECORDED"
  | "PAYMENT_INFORMATION_UPDATED"
  | "PAYMENT_INFORMATION_CLEARED"
  | "WITHHOLDING_UPDATED";

export interface ContractPaymentHistoryEntry {
  action: ContractFinancialAction;
  at: number;
  by: string;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Statuses                                                            */
/* ------------------------------------------------------------------ */

export const CONTRACT_PAYMENT_STATUS = {
  NO_PAYMENT_INFORMATION: "NO_PAYMENT_INFORMATION",
  RECORDED_NOT_CONFIRMED: "RECORDED_NOT_CONFIRMED",
  AWAITING_INVOICE_APPROVAL: "AWAITING_INVOICE_APPROVAL",
  AWAITING_PAYMENT_CONFIRMATION: "AWAITING_PAYMENT_CONFIRMATION",
  PAID: "PAID",
  INVOICE_UNAVAILABLE: "INVOICE_UNAVAILABLE",
} as const;

export type ContractPaymentStatus =
  (typeof CONTRACT_PAYMENT_STATUS)[keyof typeof CONTRACT_PAYMENT_STATUS];

export const CONTRACT_PAYMENT_STATUS_LABELS: Record<
  ContractPaymentStatus,
  string
> = {
  NO_PAYMENT_INFORMATION: "No payment information",
  RECORDED_NOT_CONFIRMED: "Recorded — not confirmed",
  AWAITING_INVOICE_APPROVAL: "Awaiting invoice approval",
  AWAITING_PAYMENT_CONFIRMATION: "Awaiting payment confirmation",
  PAID: "Paid",
  INVOICE_UNAVAILABLE: "Invoice status unavailable",
};

export interface ContractPaymentStatusUI {
  label: string;
  className: string;
}

export const CONTRACT_PAYMENT_STATUS_UI: Record<
  ContractPaymentStatus,
  ContractPaymentStatusUI
> = {
  NO_PAYMENT_INFORMATION: {
    label: "No payment information",
    className: "erp-badge-draft",
  },
  RECORDED_NOT_CONFIRMED: {
    label: "Recorded — not confirmed",
    className: "erp-badge-pending",
  },
  AWAITING_INVOICE_APPROVAL: {
    label: "Awaiting invoice approval",
    className: "erp-badge-pending",
  },
  AWAITING_PAYMENT_CONFIRMATION: {
    label: "Awaiting payment confirmation",
    className: "erp-badge-pending",
  },
  PAID: {
    label: "Paid",
    className: "erp-badge-payment",
  },
  INVOICE_UNAVAILABLE: {
    label: "Invoice status unavailable",
    className: "erp-badge-rejected",
  },
};

/**
 * Safe UI lookup.
 *
 * The backend may return an unexpected or missing status while older records
 * are being migrated. Never allow that to crash a report component.
 *
 * We deliberately do not treat an unknown status as "No payment information",
 * because that could misrepresent the actual financial position.
 */
export function getContractPaymentStatusUI(
  status: unknown,
): ContractPaymentStatusUI {
  if (
    typeof status === "string" &&
    Object.prototype.hasOwnProperty.call(CONTRACT_PAYMENT_STATUS_UI, status)
  ) {
    return CONTRACT_PAYMENT_STATUS_UI[status as ContractPaymentStatus];
  }

  return {
    label: "Status unavailable",
    className: "erp-badge-draft",
  };
}

export const CONTRACT_WITHHOLDING_STATUS = {
  NOT_APPLIED: "NOT_APPLIED",
  PENDING_INVOICE: "PENDING_INVOICE",
  APPLIED: "APPLIED",
} as const;

export type ContractWithholdingStatus =
  (typeof CONTRACT_WITHHOLDING_STATUS)[keyof typeof CONTRACT_WITHHOLDING_STATUS];

export const CONTRACT_WITHHOLDING_STATUS_LABELS: Record<
  ContractWithholdingStatus,
  string
> = {
  NOT_APPLIED: "Not applied",
  PENDING_INVOICE: "Enabled — pending invoice",
  APPLIED: "Applied on invoice",
};

/**
 * Safe withholding status lookup.
 */
export function getContractWithholdingStatusLabel(
  status: unknown,
): string {
  if (
    typeof status === "string" &&
    Object.prototype.hasOwnProperty.call(
      CONTRACT_WITHHOLDING_STATUS_LABELS,
      status,
    )
  ) {
    return CONTRACT_WITHHOLDING_STATUS_LABELS[
      status as ContractWithholdingStatus
    ];
  }

  return "Status unavailable";
}

/* ------------------------------------------------------------------ */
/* Financial report                                                    */
/* ------------------------------------------------------------------ */

export interface ContractFinancialReport {
  contractNumber: string;
  customerName: string;
  customerTin: string;
  contractDate: number;
  /** Completion (standard contract) or finalization (credit contract) date. */
  completionDate?: number;
  fsNo: string;
  remark?: string;

  contractValue: number;
  fulfilledValue: number;
  remainingContractValue: number;
  overFulfilled: boolean;
  /** Displayed fulfillment percentage — always capped to 0…100. */
  fulfillmentPercent: number;
  /** Unclamped percentage, kept for transparency only. */
  rawFulfillmentPercent: number;
  closedBelowValue: boolean;
  closingReason?: string;

  /** VAT-inclusive gross payable amount. */
  grossAmountDue: number;
  /** Where the payable figures came from — never presented as interchangeable. */
  grossAmountDueBasis: "INVOICE" | "COMPLETED_ORDERS";
  totalVat: number;
  subtotalExclVat: number;

  withholdingEnabled: boolean;
  withholdingRate: number;
  withholdingAmount: number;
  /** Gross amount due less withholding. */
  netAmount: number;

  /** Confirmed amount paid — only from a PAYMENT_CONFIRMED invoice. */
  amountPaid: number;
  outstandingBalance: number;
  paymentStatus: ContractPaymentStatus;
  withholdingStatus: ContractWithholdingStatus;

  payment?: ContractPaymentInformation;
  withholding?: ContractWithholdingInformation;
  paymentHistory: ContractPaymentHistoryEntry[];

  invoice?: {
    id: string;
    invoiceNumber: string;
    status: string;
    approved: boolean;
    paymentConfirmed: boolean;
  };
  /** Set when the invoice could not be read from the backend — surfaced in UI. */
  invoiceError?: string;
  paymentConfirmedAt?: number;
  paymentConfirmedBy?: string;
}

export interface ContractFinancialReportInput {
  contract: {
    contractNumber: string;
    customer: { name: string; tin: string };
    contractValue: number;
    fsNo?: string;
    contractDate: number;
    remark?: string;
    payment?: ContractPaymentInformation;
    withholding?: ContractWithholdingInformation;
    paymentHistory?: ContractPaymentHistoryEntry[];
    completionConfirmedAt?: number;
    finalizedAt?: number;
    completionReason?: string;
    finalizationReason?: string;
    closedBelowValue?: boolean;
  };
  /** COMPLETED orders of this contract (cancelled orders are excluded). */
  completedOrders: { quantity: unknown; unitPrice: unknown }[];
  fulfilledValue: number;
  remainingValue: number;
  invoice?: SalesInvoice | null;
  invoiceError?: string;
}

function invoiceIsApproved(invoice: SalesInvoice): boolean {
  return (
    invoice.status === ORDER_STATUS.FINANCE_APPROVED ||
    invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED
  );
}

/**
 * Build the financial position of a contract.
 *
 * Formula source is the Sales Invoice engine:
 *   subtotalExclVat   = Σ (quantity × unitPrice)
 *   totalVat          = subtotal × 0.15
 *   grossAmountDue    = subtotal × 1.15
 *   withholdingAmount = grossAmountDue × 0.03   (only when enabled)
 *   netAmount         = grossAmountDue − withholdingAmount
 *
 * Withholding reduces what is owed; it is never added to paid amounts and it
 * never counts as fulfillment.
 */
export function buildContractFinancialReport(
  input: ContractFinancialReportInput,
): ContractFinancialReport {
  const contractValue = Math.max(
    0,
    normalizeNumber(input.contract.contractValue),
  );

  const fulfilledValue = Math.max(
    0,
    normalizeNumber(input.fulfilledValue),
  );

  const remainingValue = Math.max(
    0,
    normalizeNumber(
      input.remainingValue ?? contractValue - fulfilledValue,
    ),
  );

  const rawFulfillmentPercent =
    contractValue > 0
      ? Math.round((fulfilledValue / contractValue) * 10000) / 100
      : 0;

  const fulfillmentPercent = Math.max(
    0,
    Math.min(100, rawFulfillmentPercent),
  );

  const invoice = input.invoice ?? null;
  const invoiceSummary = invoice?.financialSummary;

  const withholdingEnabled = invoiceSummary
    ? invoiceSummary.withholdingEnabled
    : Boolean(input.contract.withholding?.enabled);

  // Pre-invoice figures are a projection built with the SAME engine the
  // Sales Invoice uses, so no second withholding formula exists.
  const projection = calculateSalesInvoiceTotals({
    orders: input.completedOrders,
    withholdingEnabled,
  });

  const subtotalExclVat = invoiceSummary
    ? invoiceSummary.subtotalExclVat
    : projection.subtotalExclVat;

  const totalVat = invoiceSummary
    ? invoiceSummary.totalVat
    : projection.totalVat;

  const grossAmountDue = invoiceSummary
    ? invoiceSummary.totalPriceInclVat
    : projection.totalPriceInclVat;

  const withholdingAmount = invoiceSummary
    ? invoiceSummary.withholdingAmount
    : projection.withholdingAmount;

  const netAmount = invoiceSummary
    ? invoiceSummary.netAmountAfterWithholding
    : projection.netAmountAfterWithholding;

  const withholdingRate = invoiceSummary
    ? invoiceSummary.withholdingRate
    : projection.withholdingRate;

  const paymentConfirmed =
    invoice?.status === ORDER_STATUS.PAYMENT_CONFIRMED;

  const genericRecordedPayment = Boolean(
    input.contract.payment?.recordedAt,
  );

  // Only a confirmed Sales Invoice payment counts as money received.
  const amountPaid = paymentConfirmed ? roundMoney(netAmount) : 0;

  const outstandingBalance = Math.max(
    0,
    roundMoney(netAmount - amountPaid),
  );

  let paymentStatus: ContractPaymentStatus;

  if (paymentConfirmed) {
    paymentStatus = CONTRACT_PAYMENT_STATUS.PAID;
  } else if (invoice) {
    paymentStatus = invoiceIsApproved(invoice)
      ? CONTRACT_PAYMENT_STATUS.AWAITING_PAYMENT_CONFIRMATION
      : CONTRACT_PAYMENT_STATUS.AWAITING_INVOICE_APPROVAL;
  } else if (input.invoiceError) {
    paymentStatus = CONTRACT_PAYMENT_STATUS.INVOICE_UNAVAILABLE;
  } else if (genericRecordedPayment) {
    paymentStatus = CONTRACT_PAYMENT_STATUS.RECORDED_NOT_CONFIRMED;
  } else {
    paymentStatus = CONTRACT_PAYMENT_STATUS.NO_PAYMENT_INFORMATION;
  }

  let withholdingStatus: ContractWithholdingStatus;

  if (!withholdingEnabled) {
    withholdingStatus = CONTRACT_WITHHOLDING_STATUS.NOT_APPLIED;
  } else if (invoice) {
    withholdingStatus = CONTRACT_WITHHOLDING_STATUS.APPLIED;
  } else {
    withholdingStatus = CONTRACT_WITHHOLDING_STATUS.PENDING_INVOICE;
  }

  return {
    contractNumber: input.contract.contractNumber,
    customerName: input.contract.customer.name,
    customerTin: input.contract.customer.tin,
    contractDate: input.contract.contractDate,
    completionDate:
      input.contract.finalizedAt ??
      input.contract.completionConfirmedAt,
    fsNo: input.contract.fsNo ?? "",
    remark: input.contract.remark,

    contractValue,
    fulfilledValue,
    remainingContractValue: remainingValue,
    overFulfilled: fulfilledValue > contractValue,
    fulfillmentPercent,
    rawFulfillmentPercent,
    closedBelowValue: Boolean(input.contract.closedBelowValue),
    closingReason:
      input.contract.finalizationReason ??
      input.contract.completionReason,

    grossAmountDue,
    grossAmountDueBasis: invoice ? "INVOICE" : "COMPLETED_ORDERS",
    totalVat,
    subtotalExclVat,

    withholdingEnabled,
    withholdingRate,
    withholdingAmount,
    netAmount,

    amountPaid,
    outstandingBalance,
    paymentStatus,
    withholdingStatus,

    payment: input.contract.payment,
    withholding: input.contract.withholding,
    paymentHistory: input.contract.paymentHistory ?? [],

    invoice: invoice
      ? {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          approved: invoiceIsApproved(invoice),
          paymentConfirmed,
        }
      : undefined,

    invoiceError: input.invoiceError,
    paymentConfirmedAt: invoice?.paymentConfirmedAt,
    paymentConfirmedBy: invoice?.paymentConfirmedBy,
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface ContractFinancialValidation {
  valid: boolean;
  errors: Record<string, string>;
}

/**
 * Payment information is OPTIONAL — an empty form is never an error.
 * Once Finance chooses to record it, the fields mirror the Sales Invoice
 * payment requirements (bank, sender, reference).
 */
export function validatePaymentInformation(
  input: ContractPaymentInput,
): ContractFinancialValidation {
  const errors: Record<string, string> = {};

  if (!input.bank?.trim()) {
    errors.bank = "Bank is required";
  }

  if (!input.paymentSender?.trim()) {
    errors.paymentSender = "Payment Sent By is required";
  }

  if (!input.paymentReferenceNumber?.trim()) {
    errors.paymentReferenceNumber = "Reference Number is required";
  }

  const amount = normalizeNumber(input.paymentAmount);

  if (!Number.isFinite(amount) || amount < 0) {
    errors.paymentAmount = "Enter a valid payment amount";
  }

  if (
    input.paymentDate !== undefined &&
    (Number.isNaN(input.paymentDate) ||
      Number.isNaN(new Date(input.paymentDate).getTime()))
  ) {
    errors.paymentDate = "Enter a valid payment date";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Withholding mirrors the Sales Invoice rule: evidence is required whenever
 * withholding is ON, and never required when it is OFF.
 */
export function validateWithholdingInformation(
  input: ContractWithholdingInput,
): ContractFinancialValidation {
  const errors: Record<string, string> = {};

  if (input.enabled && !input.evidence) {
    errors.withholdingEvidence =
      "Withholding Evidence is required when Withholding is ON";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
