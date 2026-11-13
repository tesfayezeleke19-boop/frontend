/**
 * Shared API DTOs — the contract between the NexERP frontend and the future
 * PHP or Django backend.
 *
 * Design decisions (must be confirmed with the backend team):
 *   - JSON keys are camelCase to match the frontend and avoid a second
 *     naming convention in every component. The backend may map its own
 *     snake_case model fields to these names.
 *   - Every successful response is wrapped as `{ "data": ... }`. List
 *     endpoints add `{ "meta": ... }` for pagination.
 *   - Dates are ISO-8601 UTC strings on the wire (e.g.
 *     "2026-10-18T09:30:00.000Z"). The browser converts to epoch ms only at
 *     the adapter boundary.
 *   - Money is serialized as a decimal number or decimal string with at most
 *     two fraction digits (`1234.5` / `"1234.50"`). The adapter accepts both
 *     and normalizes through the existing money helpers. Backends must not
 *     rely on JavaScript floating-point arithmetic for stored totals.
 *   - Identifiers are opaque strings. Backend ids are NOT part of
 *     this contract; see docs/backend-integration.md for the mapping.
 */

export interface ApiEnvelope<T> {
  data: T;
  message?: string;
}

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  perPage: 0,
  total: 0,
  totalPages: 0,
};

/** Wire representation of money. */
export type MoneyDto = number | string;

export interface ApiErrorBody {
  message?: string;
  code?: string;
  errors?: Record<string, string | string[]>;
  detail?: string;
}

/* ------------------------------------------------------------------ */
/* Auth / user profile                                                 */
/* ------------------------------------------------------------------ */

/**
 * The profile the frontend needs. `role` is display/usability data — the
 * backend remains the only authorization boundary.
 */
export interface ApiUserDto {
  id: string;
  /** Full name or display name. */
  displayName: string;
  email: string;
  role: "SALES" | "FINANCE" | "HR" | "ADMIN";
  department?: string | null;
  accountStatus?: "ACTIVE" | "DISABLED" | null;
}

export interface ApiSessionDto {
  user: ApiUserDto;
  /** ISO timestamp. */
  signedInAt?: string;
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

/**
 * Attachment metadata. The upload endpoint is intentionally NOT fixed yet:
 * the backend team chooses direct multipart upload or a signed-URL flow.
 * Either way the frontend needs metadata in this shape once stored.
 */
export interface ApiAttachmentDto {
  id: string;
  fileName: string;
  /** Absolute or backend-relative download URL. */
  fileUrl: string;
  mimeType: string;
  fileSize: number;
}

/* ------------------------------------------------------------------ */
/* Expenses                                                            */
/* ------------------------------------------------------------------ */

export type ApiExpenseType = "STANDARD" | "CASUAL";
export type ApiExpenseSource = "FINANCE" | "ADMIN" | "LEGACY";
export type ApiExpenseReviewStatus =
  | "DRAFT"
  | "RECORDED"
  | "PENDING_FINANCE_REVIEW"
  | "APPROVED"
  | "REJECTED";
export type ApiExpenseLegacyStatus =
  | "DRAFT"
  | "PENDING_PAYMENT"
  | "DONE"
  | "UNVERIFIED";

export interface ApiExpenseStatusHistoryDto {
  status: string;
  at: string;
  actor?: string | null;
  note?: string | null;
}

export interface ApiExpenseDto {
  id: string;
  item: string;
  category?: string | null;
  /** Absent/omitted on legacy records means STANDARD. */
  expenseType?: ApiExpenseType | null;
  amountBeforeVat: MoneyDto;
  /** false = casual / VAT explicitly not applicable. */
  vatApplicable?: boolean | null;
  vatAmount: MoneyDto;
  whtEnabled: boolean;
  whtAmount: MoneyDto;
  totalTransferred: MoneyDto;
  /** Accounting expense amount (total / after VAT). */
  amount: MoneyDto;
  bank?: string | null;
  paymentReference?: string | null;
  paymentParty?: string | null;
  invoiceAttachment?: ApiAttachmentDto | null;
  whtAttachment?: ApiAttachmentDto | null;
  remark?: string | null;
  /** ISO timestamp of the expense transaction date. */
  expenseDate: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  expenseSource?: ApiExpenseSource | null;
  reviewStatus?: ApiExpenseReviewStatus | null;
  statusHistory?: ApiExpenseStatusHistoryDto[] | null;
  rejectionReason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  paymentStatus?: ApiExpenseLegacyStatus | null;
  submittedAt?: string | null;
  submittedBy?: string | null;
  paidAt?: string | null;
  paidBy?: string | null;
  paymentConfirmationNote?: string | null;
}

export interface ApiExpenseWriteDto {
  item: string;
  category?: string;
  expenseType: ApiExpenseType;
  amountBeforeVat: MoneyDto;
  whtEnabled: boolean;
  bank?: string | null;
  paymentReference?: string | null;
  paymentParty?: string | null;
  invoiceAttachment?: ApiAttachmentDto | null;
  whtAttachment?: ApiAttachmentDto | null;
  remark?: string | null;
  /** ISO timestamp. */
  expenseDate: string;
}

export interface ApiExpenseReviewSummaryDto {
  pendingReview: number;
  pendingAmount: MoneyDto;
  approved: number;
  rejected: number;
  drafts: number;
}

export interface ApiExpenseListQuery {
  source?: ApiExpenseSource;
  status?: ApiExpenseReviewStatus;
  expenseType?: ApiExpenseType;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  perPage?: number;
}
