
/**
 * NexERP — Sales Invoice data model + centralized invoice calculations.
 *
 * A Sales Invoice is the parent transaction. It contains one or more
 * Orders (line items with their own aggregate, quantity, unit price, and
 * royalty). This module is the single source of truth for the invoice
 * shape, the invoice lifecycle, and ALL derived financial numbers
 * (line totals, VAT, withholding, royalty).
 *
 * Numeric rules: every financial field is stored as a real number.
 * Formatting ETB strings happens only at the UI layer.
 */
import {
  ORDER_STATUS,
  type AggregateType,
  type OrderStatus,
} from "./types";
import {
  normalizeNumber,
  roundMoney,
  VAT_DIVISOR,
} from "./calc";

/* ------------------------------------------------------------------ */
/* Business constants                                                  */
/* ------------------------------------------------------------------ */

/** Withholding rate — 3% of the VAT-inclusive total. */
export const WITHHOLDING_RATE = 0.03;

/** Order/line VAT rate (15%) as a multiplier. */
export const ORDER_VAT_RATE = 0.15;

/** Royalty rate (3% of each order's VAT-exclusive value). */
export const INVOICE_ROYALTY_RATE = 0.03;

/* ------------------------------------------------------------------ */
/* File evidence                                                       */
/* ------------------------------------------------------------------ */

export interface FileEvidence {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
}

/* ------------------------------------------------------------------ */
/* Invoice child order                                                 */
/* ------------------------------------------------------------------ */

export interface InvoiceOrder {
  id: string;

  /** Position inside the invoice, 1-based — displayed as "Order 1". */
  orderNumber: number;

  aggregate: AggregateType;
  quantity: number;
  unit: string;
  unitPrice: number;

  /** VAT-exclusive line total: quantity × unitPrice. */
  lineTotalExclVat: number;

  /** Royalty Order number — 1-based. */
  royaltyOrderNumber: number;

  /**
   * Royalty Invoice Number — supplied per child Order by the user.
   * Never auto-generated.
   */
  royaltyInvoiceNumber?: string;

  /** Royalty amount: 3% of VAT-exclusive line total. */
  royaltyAmount: number;

  /**
   * Source Contract Order reference.
   * Used to reconcile this invoice line with its originating
   * contract order.
   */
  contractOrderId?: string;

  /**
   * Business date of the source contract order.
   * Used as the Royalty Report date for contract-sourced lines.
   */
  orderDate?: number;
}

/* ------------------------------------------------------------------ */
/* Invoice financial summary                                           */
/* ------------------------------------------------------------------ */

export interface InvoiceFinancialSummary {
  subtotalExclVat: number;
  totalVat: number;
  totalPriceInclVat: number;
  withholdingEnabled: boolean;
  withholdingRate: number;
  withholdingAmount: number;
  netAmountAfterWithholding: number;
}

export interface InvoicePayment {
  bank: string;
  paymentSender: string;
  paymentReferenceNumber: string;
  paymentEvidence?: FileEvidence;
}

/** Sales Invoice — parent transaction containing one or more Orders. */
export interface SalesInvoice {
  id: string;

  /** Parent identifier — e.g. INV-00001. */
  invoiceNumber: string;

  date: number;

  customer: {
    name: string;
    tin: string;
  };

  /**
   * FS No — Finance/Sales reference number.
   * Distinct from invoiceNumber and payment reference number.
   */
  fsNo: string;

  /**
   * Source Contract reference.
   * Set when an invoice originates from a contract.
   */
  contractId?: string;

  /** @deprecated Legacy field retained for compatibility. */
  reffNo?: string;

  orders: InvoiceOrder[];

  financialSummary: InvoiceFinancialSummary;

  payment: InvoicePayment;

  withholdingEvidence?: FileEvidence;

  remark?: string;

  status: OrderStatus;

  legacyOrderId?: string;
  legacyReffNo?: string;
  legacyTransactionNumber?: string;
  legacySenderName?: string;

  rejectionReason?: string;

  createdAt: number;
  updatedAt: number;

  submittedAt?: number;
  submittedBy?: string;

  financeReviewedAt?: number;

  approvedAt?: number;
  approvedBy?: string;

  rejectedAt?: number;

  paymentConfirmedAt?: number;
  paymentConfirmedBy?: string;

  createdBy?: string;
}

/* ------------------------------------------------------------------ */
/* Centralized calculation engine                                      */
/* ------------------------------------------------------------------ */

/**
 * Compute one order's derived values from its raw inputs.
 *
 * All monetary calculations are rounded to two decimal places.
 */
export function calculateOrderTotals(order: {
  quantity: unknown;
  unitPrice: unknown;
}): {
  lineTotalExclVat: number;
  royaltyAmount: number;
} {
  const quantity = Math.max(
    0,
    normalizeNumber(order.quantity),
  );

  const unitPrice = Math.max(
    0,
    normalizeNumber(order.unitPrice),
  );

  const lineTotalExclVat = roundMoney(
    quantity * unitPrice,
  );

  const royaltyAmount = roundMoney(
    lineTotalExclVat * INVOICE_ROYALTY_RATE,
  );

  return {
    lineTotalExclVat,
    royaltyAmount,
  };
}

/**
 * Calculate all invoice financial totals.
 *
 * Formulas:
 *
 * lineTotalExclVat[i] = quantity[i] × unitPrice[i]
 * subtotalExclVat     = Σ lineTotalExclVat
 * totalVat            = subtotalExclVat × 0.15
 * totalPriceInclVat   = subtotalExclVat × 1.15
 * withholdingAmount   = totalPriceInclVat × 0.03 (when enabled)
 * netAmountAfterWithholding = totalPriceInclVat - withholdingAmount
 * royaltyAmount[i]    = lineTotalExclVat[i] × 0.03
 */
export function calculateSalesInvoiceTotals(input: {
  orders: {
    quantity: unknown;
    unitPrice: unknown;
  }[];
  withholdingEnabled: boolean;
}): InvoiceFinancialSummary {
  let subtotalExclVat = 0;

  for (const order of input.orders) {
    const { lineTotalExclVat } =
      calculateOrderTotals(order);

    subtotalExclVat += lineTotalExclVat;
  }

  subtotalExclVat = roundMoney(subtotalExclVat);

  const totalVat = roundMoney(
    subtotalExclVat * ORDER_VAT_RATE,
  );

  const totalPriceInclVat = roundMoney(
    subtotalExclVat * VAT_DIVISOR,
  );

  const withholdingRate = input.withholdingEnabled
    ? WITHHOLDING_RATE
    : 0;

  const withholdingAmount = input.withholdingEnabled
    ? roundMoney(
        totalPriceInclVat * WITHHOLDING_RATE,
      )
    : 0;

  const netAmountAfterWithholding = roundMoney(
    totalPriceInclVat - withholdingAmount,
  );

  return {
    subtotalExclVat,
    totalVat,
    totalPriceInclVat,
    withholdingEnabled: input.withholdingEnabled,
    withholdingRate,
    withholdingAmount,
    netAmountAfterWithholding,
  };
}

/**
 * Recalculate every order's royalty amount.
 *
 * Stored totals are recalculated from quantity and unit price,
 * rather than trusting previously stored derived values.
 */
export function calculateInvoiceOrderRoyalties<
  T extends {
    quantity: unknown;
    unitPrice: unknown;
  } & {
    lineTotalExclVat?: number;
    royaltyAmount?: number;
  },
>(orders: T[]): T[] {
  return orders.map((order) => {
    const {
      lineTotalExclVat,
      royaltyAmount,
    } = calculateOrderTotals(order);

    return {
      ...order,
      lineTotalExclVat,
      royaltyAmount,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Invoice number generation                                           */
/* ------------------------------------------------------------------ */

/** Next sequential invoice number: INV-00001, INV-00002, ... */
export function computeNextInvoiceNumber(
  invoices: { invoiceNumber: string }[],
): string {
  let max = 0;

  for (const invoice of invoices) {
    const match = /^INV-(\d+)$/.exec(
      invoice.invoiceNumber,
    );

    if (match) {
      max = Math.max(
        max,
        parseInt(match[1], 10),
      );
    }
  }

  return `INV-${String(max + 1).padStart(5, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface InvoiceValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

/** Rejection/draft statuses that allow editing an invoice. */
export function isEditableInvoiceStatus(
  status: OrderStatus,
): boolean {
  return (
    status === ORDER_STATUS.DRAFT ||
    status === ORDER_STATUS.REJECTED
  );
}

/**
 * Full submission validation.
 *
 * Drafts can be saved with incomplete information.
 * Submitting for Finance review requires all required fields.
 */
export function validateInvoiceForSubmit(invoice: {
  customer: {
    name: string;
    tin: string;
  };
  fsNo: string;
  orders: {
    aggregate: unknown;
    quantity: unknown;
    unitPrice: unknown;
    royaltyInvoiceNumber?: unknown;
  }[];
  payment: {
    bank: string;
    paymentSender: string;
    paymentReferenceNumber: string;
    paymentEvidence?: FileEvidence;
  };
  withholdingEnabled: boolean;
  withholdingEvidence?: FileEvidence;
}): InvoiceValidationResult {
  const errors: Record<string, string> = {};

  if (!invoice.customer.name?.trim()) {
    errors.customerName =
      "Customer / Company Name is required";
  }

  if (!invoice.customer.tin?.trim()) {
    errors.customerTin =
      "Customer TIN Number is required";
  }

  if (!invoice.fsNo?.trim()) {
    errors.fsNo = "FS No is required";
  }

  if (!invoice.orders.length) {
    errors.orders = "At least one Order is required";
  } else {
    invoice.orders.forEach((order, index) => {
      const label = `Order ${index + 1}`;

      const quantity = normalizeNumber(
        order.quantity,
      );

      const unitPrice = normalizeNumber(
        order.unitPrice,
      );

      if (
        typeof order.aggregate !== "string" ||
        !order.aggregate.trim()
      ) {
        errors[`order-${index}-aggregate`] =
          `${label}: Aggregate type is required`;
      }

      if (quantity <= 0) {
        errors[`order-${index}-quantity`] =
          `${label}: Quantity must be greater than zero`;
      }

      if (
        unitPrice < 0 ||
        !Number.isFinite(unitPrice)
      ) {
        errors[`order-${index}-unitPrice`] =
          `${label}: Enter a valid unit price`;
      }

      if (
        order.royaltyInvoiceNumber !== undefined &&
        order.royaltyInvoiceNumber !== null &&
        !String(order.royaltyInvoiceNumber).trim()
      ) {
        errors[
          `order-${index}-royaltyInvoiceNumber`
        ] =
          `${label}: Royalty Invoice Number cannot be only whitespace`;
      }
    });
  }

  if (!invoice.payment.bank?.trim()) {
    errors.bank = "Bank is required";
  }

  if (!invoice.payment.paymentSender?.trim()) {
    errors.paymentSender =
      "Payment Sent By is required";
  }

  if (
    !invoice.payment.paymentReferenceNumber?.trim()
  ) {
    errors.paymentReferenceNumber =
      "Reference Number is required";
  }

  if (!invoice.payment.paymentEvidence) {
    errors.paymentEvidence =
      "Payment Evidence is required before submitting";
  }

  if (
    invoice.withholdingEnabled &&
    !invoice.withholdingEvidence
  ) {
    errors.withholdingEvidence =
      "Withholding Evidence is required when Withholding is ON";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/* ------------------------------------------------------------------ */
/* Legacy order migration                                              */
/* ------------------------------------------------------------------ */

/**
 * Convert one legacy SalesOrder into a one-order Sales Invoice.
 *
 * Legacy identifiers are retained for backward compatibility.
 */
export function migrateLegacyOrderToInvoice(
  legacy: {
    id: string;
    orderNumber: string;
    customerName: string;
    tin: string;
    reffNo: string;
    aggregate: AggregateType;
    quantity: number;
    unitPrice: number;
    unit: string;
    bank: string;
    senderName: string;
    transactionNumber: string;
    remark?: string;
    status: OrderStatus;
    orderDate?: number;
    createdAt: number;
    updatedAt: number;
    submittedAt?: number;
    submittedBy?: string;
    financeReviewedAt?: number;
    approvedAt?: number;
    approvedBy?: string;
    rejectedAt?: number;
    paymentConfirmedAt?: number;
    paymentConfirmedBy?: string;
    rejectionReason?: string;
    createdBy?: string;
  },
): SalesInvoice {
  const now = legacy.createdAt;

  const order: InvoiceOrder = {
    id: `${legacy.id}-o1`,
    orderNumber: 1,
    aggregate: legacy.aggregate,
    quantity: legacy.quantity,
    unit: legacy.unit || "m³",
    unitPrice: legacy.unitPrice,
    lineTotalExclVat: 0,
    royaltyOrderNumber: 1,
    royaltyAmount: 0,
  };

  const {
    lineTotalExclVat,
    royaltyAmount,
  } = calculateOrderTotals(order);

  order.lineTotalExclVat = lineTotalExclVat;
  order.royaltyAmount = royaltyAmount;

  const financialSummary =
    calculateSalesInvoiceTotals({
      orders: [order],
      withholdingEnabled: false,
    });

  return {
    id: legacy.id,
    invoiceNumber: legacy.orderNumber,
    date: legacy.orderDate ?? now,
    customer: {
      name: legacy.customerName,
      tin: legacy.tin,
    },
    fsNo: legacy.reffNo,
    orders: [order],
    financialSummary,
    payment: {
      bank: legacy.bank,
      paymentSender: legacy.senderName,
      paymentReferenceNumber:
        legacy.transactionNumber,
    },
    remark: legacy.remark,
    status: legacy.status,
    legacyOrderId: legacy.id,
    legacyReffNo: legacy.reffNo,
    legacyTransactionNumber:
      legacy.transactionNumber,
    legacySenderName: legacy.senderName,
    rejectionReason: legacy.rejectionReason,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
    submittedAt: legacy.submittedAt,
    submittedBy: legacy.submittedBy,
    financeReviewedAt: legacy.financeReviewedAt,
    approvedAt: legacy.approvedAt,
    approvedBy: legacy.approvedBy,
    rejectedAt: legacy.rejectedAt,
    paymentConfirmedAt:
      legacy.paymentConfirmedAt,
    paymentConfirmedBy:
      legacy.paymentConfirmedBy,
    createdBy: legacy.createdBy,
  };
}

/**
 * Statuses that count as captured sales revenue.
 * Mirrors the legacy REVENUE_STATUSES definition.
 */
export const INVOICE_REVENUE_STATUSES =
  new Set<OrderStatus>([
    ORDER_STATUS.PENDING_FINANCE_REVIEW,
    ORDER_STATUS.FINANCE_APPROVED,
    ORDER_STATUS.PAYMENT_CONFIRMED,
  ]);

/* ------------------------------------------------------------------ */
/* Repository interface                                                */
/* ------------------------------------------------------------------ */

export interface SalesInvoiceInput {
  customer: {
    name: string;
    tin: string;
  };

  fsNo: string;

  /** Source Contract id — set by Contract Order conversion. */
  contractId?: string;

  orders: {
    aggregate: AggregateType;
    quantity: number;
    unitPrice: number;

    /** Royalty Invoice Number — user-supplied per order. */
    royaltyInvoiceNumber?: string;

    /** Source Contract Order id. */
    contractOrderId?: string;

    /** Source contract order business date. */
    orderDate?: number;
  }[];

  withholdingEnabled: boolean;

  payment: {
    bank: string;
    paymentSender: string;
    paymentReferenceNumber: string;
    paymentEvidence?: FileEvidence;
  };

  withholdingEvidence?: FileEvidence;
  remark?: string;
}

export interface SalesInvoicesRepository {
  getInvoices(): Promise<SalesInvoice[]>;

  getInvoiceById(
    id: string,
  ): Promise<SalesInvoice | null>;

  getInvoicesByStatus(
    status: OrderStatus,
  ): Promise<SalesInvoice[]>;

  /** Invoices pending payment confirmation. */
  getFinanceApprovedInvoices(): Promise<SalesInvoice[]>;

  /** Invoices with confirmed payment. */
  getPaymentConfirmedInvoices(): Promise<SalesInvoice[]>;

  computeNextInvoiceNumber(): Promise<string>;

  createInvoice(
    input: SalesInvoiceInput,
    options?: {
      status?: OrderStatus;
      actor?: string;
    },
  ): Promise<SalesInvoice>;

  saveDraft(
    id: string,
    input: Partial<SalesInvoiceInput>,
    actor?: string,
  ): Promise<SalesInvoice>;

  submitInvoice(
    id: string,
    actor?: string,
  ): Promise<SalesInvoice>;

  approveInvoice(
    id: string,
    actor?: string,
  ): Promise<SalesInvoice>;

  rejectInvoice(
    id: string,
    reason: string,
    actor?: string,
  ): Promise<SalesInvoice>;

  confirmInvoicePayment(
    id: string,
    actor?: string,
  ): Promise<SalesInvoice>;

  subscribe(
    listener: () => void,
  ): () => void;
}
