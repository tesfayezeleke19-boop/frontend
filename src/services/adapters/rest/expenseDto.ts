/**
 * Expense DTO <-> domain mapping.
 *
 * All wire-format concerns live here: ISO dates, nullable strings, money
 * parsing, attachment metadata, and legacy status fields. The UI and the
 * repository interface only ever see the domain `Expense` type.
 *
 * Unknown/malformed values throw a typed ApiError (parse) instead of leaking
 * `undefined`/`NaN` into the expense tables.
 */
import { ApiError } from "@/lib/api/errors";
import type {
  ApiAttachmentDto,
  ApiExpenseDto,
  ApiExpenseReviewStatus,
  ApiExpenseSource,
  ApiExpenseStatusHistoryDto,
  ApiExpenseType,
  ApiExpenseWriteDto,
  MoneyDto,
} from "@/lib/api/types";
import {
  EXPENSE_PAYMENT_STATUS,
  EXPENSE_REVIEW_STATUS,
  EXPENSE_SOURCE,
  EXPENSE_TYPE,
  type Expense,
  type ExpenseAttachment,
  type ExpenseInput,
  type ExpensePaymentStatus,
  type ExpenseSource,
  type ExpenseType,
} from "@/services/finance/types";

function parseMoney(value: MoneyDto | null | undefined, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new ApiError({
    kind: "parse",
    message: `The server returned an invalid ${field} for an expense.`,
  });
}

function parseDate(value: string | null | undefined, field: string): number;
function parseDate(value: string | null | undefined, field: string, optional: true): number | undefined;
function parseDate(
  value: string | null | undefined,
  field: string,
  optional = false,
): number | undefined {
  if (!value) {
    if (optional) return undefined;
    throw new ApiError({
      kind: "parse",
      message: `The server response is missing the expense ${field}.`,
    });
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new ApiError({
      kind: "parse",
      message: `The server returned an invalid expense ${field}.`,
    });
  }
  return parsed;
}

function optionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toAttachment(
  dto: ApiAttachmentDto | null | undefined,
): ExpenseAttachment | undefined {
  if (!dto) return undefined;
  return {
    id: dto.id,
    fileName: dto.fileName,
    fileUrl: dto.fileUrl,
    mimeType: dto.mimeType,
    fileSize: Number.isFinite(dto.fileSize) ? dto.fileSize : 0,
  };
}

function toAttachmentDto(
  attachment: ExpenseAttachment | null | undefined,
): ApiAttachmentDto | null | undefined {
  if (attachment === undefined) return undefined;
  if (attachment === null) return null;
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    fileUrl: attachment.fileUrl,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
  };
}

function normalizeExpenseType(value: ApiExpenseType | null | undefined): ExpenseType {
  return value === EXPENSE_TYPE.CASUAL ? EXPENSE_TYPE.CASUAL : EXPENSE_TYPE.STANDARD;
}

function normalizeSource(value: ApiExpenseSource | null | undefined): ExpenseSource | undefined {
  if (value === EXPENSE_SOURCE.FINANCE) return EXPENSE_SOURCE.FINANCE;
  if (value === EXPENSE_SOURCE.ADMIN) return EXPENSE_SOURCE.ADMIN;
  if (value === EXPENSE_SOURCE.LEGACY) return EXPENSE_SOURCE.LEGACY;
  return undefined;
}

function normalizeReviewStatus(
  value: ApiExpenseReviewStatus | null | undefined,
): Expense["reviewStatus"] {
  if (
    value === EXPENSE_REVIEW_STATUS.DRAFT ||
    value === EXPENSE_REVIEW_STATUS.RECORDED ||
    value === EXPENSE_REVIEW_STATUS.PENDING_FINANCE_REVIEW ||
    value === EXPENSE_REVIEW_STATUS.APPROVED ||
    value === EXPENSE_REVIEW_STATUS.REJECTED
  ) {
    return value;
  }
  return undefined;
}

function normalizePaymentStatus(
  value: string | null | undefined,
): ExpensePaymentStatus | undefined {
  if (
    value === EXPENSE_PAYMENT_STATUS.DRAFT ||
    value === EXPENSE_PAYMENT_STATUS.PENDING_PAYMENT ||
    value === EXPENSE_PAYMENT_STATUS.DONE ||
    value === EXPENSE_PAYMENT_STATUS.UNVERIFIED
  ) {
    return value;
  }
  return undefined;
}

function toStatusHistory(
  rows: ApiExpenseStatusHistoryDto[] | null | undefined,
): Expense["statusHistory"] {
  if (!rows) return undefined;
  return rows.map((row) => ({
    status: row.status,
    at: parseDate(row.at, "status timestamp"),
    actor: optionalString(row.actor),
    note: optionalString(row.note),
  }));
}

/** API response -> domain record. */
export function toExpense(dto: ApiExpenseDto): Expense {
  if (!dto.id || !dto.item) {
    throw new ApiError({
      kind: "parse",
      message: "The server returned an expense without an id or item.",
    });
  }
  return {
    id: dto.id,
    item: dto.item,
    category: optionalString(dto.category),
    expenseType: normalizeExpenseType(dto.expenseType),
    amount: parseMoney(dto.amount, "amount"),
    amountBeforeVat: parseMoney(dto.amountBeforeVat, "amount before VAT"),
    vatAmount: parseMoney(dto.vatAmount, "VAT amount"),
    whtEnabled: !!dto.whtEnabled,
    whtAmount: parseMoney(dto.whtAmount, "WHT amount"),
    totalTransferred: parseMoney(dto.totalTransferred, "total transferred"),
    bank: optionalString(dto.bank),
    paymentReference: optionalString(dto.paymentReference),
    paymentParty: optionalString(dto.paymentParty),
    invoiceAttachment: toAttachment(dto.invoiceAttachment),
    whtAttachment: toAttachment(dto.whtAttachment),
    remark: optionalString(dto.remark),
    date: parseDate(dto.expenseDate, "date"),
    createdBy: optionalString(dto.createdBy),
    createdAt: parseDate(dto.createdAt, "createdAt"),
    updatedAt: parseDate(dto.updatedAt, "updatedAt"),
    expenseSource: normalizeSource(dto.expenseSource),
    reviewStatus: normalizeReviewStatus(dto.reviewStatus),
    statusHistory: toStatusHistory(dto.statusHistory),
    rejectionReason: optionalString(dto.rejectionReason),
    reviewedBy: optionalString(dto.reviewedBy),
    reviewedAt: parseDate(dto.reviewedAt, "reviewedAt", true),
    paymentStatus: normalizePaymentStatus(dto.paymentStatus),
    submittedAt: parseDate(dto.submittedAt, "submittedAt", true),
    submittedBy: optionalString(dto.submittedBy),
    paidAt: parseDate(dto.paidAt, "paidAt", true),
    paidBy: optionalString(dto.paidBy),
    paymentConfirmationNote: optionalString(dto.paymentConfirmationNote),
  };
}

function isoDate(epochMs: number, field: string): string {
  const date = new Date(epochMs);
  if (!Number.isFinite(epochMs) || Number.isNaN(date.getTime())) {
    throw new ApiError({
      kind: "validation",
      message: `Enter a valid expense ${field}.`,
      status: 422,
    });
  }
  return date.toISOString();
}

/** Create/update payload shared by both write endpoints. */
export function toExpenseWriteDto(input: ExpenseInput): ApiExpenseWriteDto {
  return {
    item: input.item.trim(),
    category: optionalString(input.category),
    expenseType: input.expenseType ?? EXPENSE_TYPE.STANDARD,
    amountBeforeVat: input.amountBeforeVat ?? input.amount ?? 0,
    whtEnabled: !!input.whtEnabled,
    bank: optionalString(input.bank) ?? null,
    paymentReference: optionalString(input.paymentReference) ?? null,
    paymentParty: optionalString(input.paymentParty) ?? null,
    invoiceAttachment: toAttachmentDto(input.invoiceAttachment) ?? null,
    whtAttachment: toAttachmentDto(input.whtAttachment) ?? null,
    remark: optionalString(input.remark) ?? null,
    expenseDate: isoDate(input.date, "date"),
  };
}

/**
 * PATCH payload: only fields the caller actually provided are sent, so an
 * edit cannot silently overwrite fields the backend already holds.
 */
export function toExpenseUpdateDto(
  input: Partial<ExpenseInput>,
): Partial<ApiExpenseWriteDto> {
  const patch: Partial<ApiExpenseWriteDto> = {};
  if (input.item !== undefined) patch.item = input.item.trim();
  if (input.category !== undefined) patch.category = optionalString(input.category);
  if (input.expenseType !== undefined) patch.expenseType = input.expenseType;
  if (input.amountBeforeVat !== undefined) patch.amountBeforeVat = input.amountBeforeVat;
  else if (input.amount !== undefined) patch.amountBeforeVat = input.amount;
  if (input.whtEnabled !== undefined) patch.whtEnabled = input.whtEnabled;
  if (input.bank !== undefined) patch.bank = optionalString(input.bank) ?? null;
  if (input.paymentReference !== undefined) {
    patch.paymentReference = optionalString(input.paymentReference) ?? null;
  }
  if (input.paymentParty !== undefined) {
    patch.paymentParty = optionalString(input.paymentParty) ?? null;
  }
  if (input.invoiceAttachment !== undefined) {
    patch.invoiceAttachment = toAttachmentDto(input.invoiceAttachment) ?? null;
  }
  if (input.whtAttachment !== undefined) {
    patch.whtAttachment = toAttachmentDto(input.whtAttachment) ?? null;
  }
  if (input.remark !== undefined) patch.remark = optionalString(input.remark) ?? null;
  if (input.date !== undefined) patch.expenseDate = isoDate(input.date, "date");
  return patch;
}
