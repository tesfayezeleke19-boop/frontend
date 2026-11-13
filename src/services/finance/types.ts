/**
 * Finance domain types.
 *
 * Financial records are derived from confirmed Sales Orders — they always
 * reference the original order (sourceOrderId/sourceOrderNumber) and never
 * become a second, independent copy of the sales data. The future
 * PHP/ERPNext backend owns the authoritative accounting ledger; these
 * frontend records only represent the workflow and prepare the data
 * relationship.
 */
import type { SalesInvoice } from "../sales/invoice";

export const FINANCIAL_RECORD_STATUS = {
  POSTED: "POSTED",
} as const;

export type FinancialRecordStatus =
  (typeof FINANCIAL_RECORD_STATUS)[keyof typeof FINANCIAL_RECORD_STATUS];

export const FINANCIAL_RECORD_STATUS_LABELS: Record<
  FinancialRecordStatus,
  string
> = {
  POSTED: "Posted",
};

/**
 * A financial record created when Finance confirms payment for an approved
 * Sales Order. Mirrors the source order's financial details and references it
 * by id — this is a mock/workflow record, not a real accounting entry.
 */
export interface FinancialRecord {
  id: string;
  recordNumber: string; // e.g. FIN-REC-0001, generated sequentially
  sourceOrderId: string;
  sourceOrderNumber: string;
  customerName: string;
  aggregate: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  bank: string;
  status: FinancialRecordStatus;
  postedAt: number;
  postedBy?: string;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Expenses                                                            */
/* ------------------------------------------------------------------ */

/**
 * LEGACY payment statuses — kept for records created before the expense
 * workflows were split. Finance-created expenses no longer pass through
 * PENDING_PAYMENT/DONE, and no new record is given these statuses.
 *
 *   PENDING_PAYMENT — historically submitted to the obsolete Admin payment
 *                     queue. Displayed with its historical meaning only.
 *   DONE            — historically payment confirmed by Admin (paid
 *                     timestamp, admin identity, optional reference).
 *   UNVERIFIED      — historical record created before that workflow
 *                     existed. Flagged for review; never relabelled.
 */
export const EXPENSE_PAYMENT_STATUS = {
  DRAFT: "DRAFT",
  PENDING_PAYMENT: "PENDING_PAYMENT",
  DONE: "DONE",
  UNVERIFIED: "UNVERIFIED",
} as const;

export type ExpensePaymentStatus =
  (typeof EXPENSE_PAYMENT_STATUS)[keyof typeof EXPENSE_PAYMENT_STATUS];

export const EXPENSE_PAYMENT_STATUS_LABELS: Record<
  ExpensePaymentStatus,
  string
> = {
  DRAFT: "Draft",
  PENDING_PAYMENT: "Pending Payment",
  DONE: "Done",
  UNVERIFIED: "Unverified (historical)",
};

/* ------------------------------------------------------------------ */
/* Expense source ownership (two separate workflows, one record set)   */
/* ------------------------------------------------------------------ */

/**
 * Canonical ownership of every expense. The repository assigns this from
 * the authenticated caller's role — it is never a free form choice:
 *
 *   FINANCE — Workflow A: created and managed directly by Finance; no
 *             Admin approval, never enters any review queue.
 *   ADMIN   — Workflow B: created by Admin/management; goes to Finance
 *             for review after submission (approve or reject).
 *   LEGACY  — Records whose owner cannot be safely established. They keep
 *             their historical status/meaning and are counted exactly once
 *             under the existing accounting policy until an authorized
 *             reconciliation classifies them.
 */
export const EXPENSE_SOURCE = {
  FINANCE: "FINANCE",
  ADMIN: "ADMIN",
  LEGACY: "LEGACY",
} as const;

export type ExpenseSource = (typeof EXPENSE_SOURCE)[keyof typeof EXPENSE_SOURCE];

export const EXPENSE_SOURCE_LABELS: Record<ExpenseSource, string> = {
  FINANCE: "Finance",
  ADMIN: "Admin",
  LEGACY: "Legacy",
};

/**
 * Canonical review/lifecycle status for newly created expenses:
 *
 *   DRAFT                  — saved as a draft (Admin workflow); editable by
 *                            its creator, not visible to Finance review.
 *   RECORDED               — saved as a direct record (Finance workflow).
 *                            Valid immediately — no approval step exists.
 *   PENDING_FINANCE_REVIEW — Admin submitted it; Finance must act.
 *   APPROVED               — Finance approved; eligible for financial reports.
 *   REJECTED               — Finance rejected; reason stored; Admin can edit
 *                            and resubmit (same record, same ID).
 *
 * Legacy records keep their historical `paymentStatus` instead — their old
 * labels (Pending Payment / Done / Unverified) are preserved, never silently
 * relabelled as approved.
 */
export const EXPENSE_REVIEW_STATUS = {
  DRAFT: "DRAFT",
  RECORDED: "RECORDED",
  PENDING_FINANCE_REVIEW: "PENDING_FINANCE_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

export type ExpenseReviewStatus =
  (typeof EXPENSE_REVIEW_STATUS)[keyof typeof EXPENSE_REVIEW_STATUS];

export const EXPENSE_REVIEW_STATUS_LABELS: Record<
  ExpenseReviewStatus,
  string
> = {
  DRAFT: "Draft",
  RECORDED: "Recorded",
  PENDING_FINANCE_REVIEW: "Pending Finance Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/** One persisted lifecycle step (append-only; preserves the same record ID). */
export interface ExpenseStatusHistoryEntry {
  status: string;
  at: number;
  actor?: string;
  note?: string;
}

/** Supplier/WHT attachment metadata — API-ready, never a browser File. */
export interface ExpenseAttachment {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
}

/**
 * Expense classification — how the company records the spend:
 *
 *   STANDARD — the existing expense flow: VAT applies (unless the record is
 *              historical), and bank/payment information plus the supplier
 *              invoice attachment are required for submission.
 *   CASUAL   — a real, recordable expense for which VAT does not apply and
 *              no bank details or payment evidence are required.
 *
 * This is a recording classification, NOT a legal tax determination. A
 * CASUAL expense is never presented as legally VAT-exempt — it simply does
 * not carry a VAT component in this system.
 *
 * Old records have no `expenseType`. They are read as STANDARD by
 * `expenseTypeOf()` so their historical behavior and totals are preserved;
 * missing optional fields are never used to reclassify them.
 */
export const EXPENSE_TYPE = {
  STANDARD: "STANDARD",
  CASUAL: "CASUAL",
} as const;

export type ExpenseType = (typeof EXPENSE_TYPE)[keyof typeof EXPENSE_TYPE];

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  STANDARD: "Standard",
  CASUAL: "Casual",
};

/** Stored records without a classification are Standard (backward compatible). */
export function expenseTypeOf(expense: {
  expenseType?: ExpenseType;
}): ExpenseType {
  return expense.expenseType === EXPENSE_TYPE.CASUAL
    ? EXPENSE_TYPE.CASUAL
    : EXPENSE_TYPE.STANDARD;
}

/**
 * Whether VAT applies to a record. Casual expenses are explicitly NOT
 * subject to VAT in this system — that is a classification decision, not an
 * inference from an empty VAT field. Standard records keep the existing
 * behavior even when a historical record happens to store vatAmount = 0.
 */
export function isVatApplicable(expense: {
  expenseType?: ExpenseType;
}): boolean {
  return expenseTypeOf(expense) === EXPENSE_TYPE.STANDARD;
}

/**
 * A recorded finance expense.
 *
 * VAT/WHT breakdown fields follow the centralized expense calculation
 * engine (src/services/finance/expenseCalculations.ts). `amount` is the
 * accounting expense amount — Total / After VAT — which is what the
 * existing Net Profit formula deducts (Total Transferred is a payment
 * measure and is never double-subtracted).
 */
export interface Expense {
  id: string;
  /** Equipment / Item description. */
  item: string;
  /** Standard vs casual recording classification (absent = Standard). */
  expenseType?: ExpenseType;
  /** Expense Category (controlled dropdown, optional on legacy data). */
  category?: string;
  /** Accounting expense amount = total / after VAT. */
  amount: number;
  /** Amount excluding VAT. */
  amountBeforeVat: number;
  vatAmount: number;
  /** Withholding toggle + computed amount. */
  whtEnabled: boolean;
  whtAmount: number;
  /** totalAfterVat − whtAmount (payment measure, not the expense amount). */
  totalTransferred: number;
  /** Bank / payment identification (reuses invoice payment conventions). */
  bank?: string;
  /** Payment transaction/reference — existing field, reused for Admin's
   *  payment confirmation instead of a redundant new field. */
  paymentReference?: string;
  paymentParty?: string;
  invoiceAttachment?: ExpenseAttachment;
  whtAttachment?: ExpenseAttachment;
  remark?: string;
  date: number;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
  /* -------------------- Workflow -------------------- */
  /** Canonical ownership — assigned by the repository from the caller's
   *  role; never selectable in a form and never changed by reviews. */
  expenseSource?: ExpenseSource;
  /** Canonical workflow status for new records (see EXPENSE_REVIEW_STATUS). */
  reviewStatus?: ExpenseReviewStatus;
  /** Append-only status history (submissions, approvals, rejections). */
  statusHistory?: ExpenseStatusHistoryEntry[];
  /** Finance rejection reason — shown to Admin on rejected records. */
  rejectionReason?: string;
  /** Finance user who reviewed (approved/rejected). */
  reviewedBy?: string;
  /** When Finance reviewed (approved/rejected). */
  reviewedAt?: number;
  /* -------------------- Legacy payment lifecycle -------------------- */
  /** Historical payment status (old Finance→Admin payment workflow).
   *  Retained for legacy records only — NEVER part of the money formula. */
  paymentStatus?: ExpensePaymentStatus;
  submittedAt?: number;
  submittedBy?: string;
  /** When Admin recorded the payment as Done. */
  paidAt?: number;
  /** The Admin user who confirmed payment. */
  paidBy?: string;
  /** Optional Admin payment note/confirmation detail. */
  paymentConfirmationNote?: string;
}

/** Input for creating or updating an expense. */
export interface ExpenseInput {
  item: string;
  category?: string;
  /** Standard vs casual classification (defaults to Standard). */
  expenseType?: ExpenseType;
  amount: number;
  amountBeforeVat?: number;
  vatAmount?: number;
  whtEnabled?: boolean;
  whtAmount?: number;
  totalTransferred?: number;
  bank?: string;
  paymentReference?: string;
  paymentParty?: string;
  invoiceAttachment?: ExpenseAttachment;
  whtAttachment?: ExpenseAttachment;
  remark?: string;
  date: number;
}

/** Business categories — reuse the existing option conventions. */
export const EXPENSE_CATEGORIES = [
  "Equipment",
  "Fuel & Transport",
  "Maintenance",
  "Salaries & Wages",
  "Utilities",
  "Rent",
  "Office Supplies",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type ExpenseDisplayKind =
  | "recorded"
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "legacy";

/**
 * One display rule shared by every expense surface — Finance/Sales pages
 * must not invent their own status mapping.
 */
export function getExpenseDisplayStatus(expense: Expense): {
  label: string;
  kind: ExpenseDisplayKind;
  badgeClass: string;
} {
  if (
    expense.expenseSource === "ADMIN" &&
    expense.reviewStatus &&
    EXPENSE_REVIEW_STATUS_LABELS[expense.reviewStatus]
  ) {
    const status = expense.reviewStatus;
    const badgeClass =
      status === "APPROVED"
        ? "erp-badge-approved"
        : status === "REJECTED"
          ? "erp-badge-rejected"
          : status === "PENDING_FINANCE_REVIEW"
            ? "erp-badge-pending"
            : "erp-badge-draft";
    return {
      label: EXPENSE_REVIEW_STATUS_LABELS[status],
      kind:
        status === "APPROVED"
          ? "approved"
          : status === "REJECTED"
            ? "rejected"
            : status === "PENDING_FINANCE_REVIEW"
              ? "pending"
              : "draft",
      badgeClass,
    };
  }
  if (
    expense.expenseSource === "FINANCE" &&
    expense.reviewStatus &&
    EXPENSE_REVIEW_STATUS_LABELS[expense.reviewStatus]
  ) {
    const status = expense.reviewStatus;
    return {
      label: EXPENSE_REVIEW_STATUS_LABELS[status],
      kind: status === "DRAFT" ? "draft" : "recorded",
      badgeClass: status === "DRAFT" ? "erp-badge-draft" : "erp-badge-approved",
    };
  }
  // Legacy record — keep the historical payment status and its meaning.
  const legacy = expense.paymentStatus ?? "UNVERIFIED";
  return {
    label: EXPENSE_PAYMENT_STATUS_LABELS[legacy],
    kind: "legacy",
    badgeClass:
      legacy === "DONE"
        ? "erp-badge-approved"
        : legacy === "PENDING_PAYMENT"
          ? "erp-badge-pending"
          : "erp-badge-rejected",
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard & Reports                                                 */
/* ------------------------------------------------------------------ */

/** Sales-review breakdown used on the Finance dashboard. */
export interface FinanceReviewSummary {
  pending: number;
  approved: number;
  rejected: number;
  /** approved ÷ (approved + rejected), as a percentage (0–100). */
  approvalRate: number;
}

/** Payment-queue breakdown used on the Finance dashboard and reports. */
export interface FinancePaymentSummary {
  pendingCount: number;
  pendingAmount: number;
  confirmedCount: number;
  confirmedAmount: number;
}

/**
 * Aggregations for the Finance dashboard, derived from the shared Sales
 * repository. Financial metrics are computed through the centralized
 * calculation service (src/services/finance/calculations.ts).
 *
 * Total Sales = sum of totalPrice for FINANCE_APPROVED orders (VAT-inclusive).
 * VAT, Gross Income, Royalty, and Net Profit are derived from that.
 */
export interface FinanceSummary {
  // Core financial KPIs
  totalSales: number;
  vat: number;
  grossIncome: number;
  royalty: number;
  totalExpenses: number;
  netProfit: number;
  /** Expense VAT component (input VAT) — informational. */
  expenseVat: number;
  /** Expense WHT withheld — a payment measure, NOT deducted from profit. */
  expenseWht: number;
  // Operational KPIs
  pendingApprovals: number;
  approved: number;
  rejected: number;
  pendingPayments: number;
  confirmedPayments: number;
  confirmedRevenue: number;
  review: FinanceReviewSummary;
  payments: FinancePaymentSummary;
  recentPending: SalesInvoice[];
}

/** Grouped revenue data for the Finance reporting views. */
/* ------------------------------------------------------------------ */
/* Payroll Financial Records                                           */
/* ------------------------------------------------------------------ */

export const PAYROLL_RECORD_STATUS = {
  POSTED: "POSTED",
} as const;

export type PayrollRecordStatus =
  (typeof PAYROLL_RECORD_STATUS)[keyof typeof PAYROLL_RECORD_STATUS];

export const PAYROLL_RECORD_STATUS_LABELS: Record<PayrollRecordStatus, string> = {
  POSTED: "Posted",
};

/**
 * A financial record created when Finance marks a payroll run as PAID.
 * References the HR Payroll Run — this is a workflow record, not a real
 * accounting entry.
 */
export interface PayrollFinancialRecord {
  id: string;
  recordNumber: string; // e.g. PAY-REC-0001
  payrollId: string;
  payrollPeriod: string; // e.g. "August 2026"
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  status: PayrollRecordStatus;
  paidAt: number;
  paidBy?: string;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Dashboard & Reports                                                 */
/* ------------------------------------------------------------------ */

export interface FinancialReportsData {
  byMonth: { name: string; value: number }[];
  byAggregate: { name: string; value: number }[];
  byBank: { name: string; value: number }[];
  byCustomer: { name: string; value: number }[];
  totals: { totalSales: number; vat: number; grossIncome: number; royalty: number };
  payments: FinancePaymentSummary;
}
