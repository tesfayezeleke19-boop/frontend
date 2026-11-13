/**
 * Shared expense validation — ONE implementation for the form and the
 * repository submission gate, so the browser cannot submit a record the
 * trusted data layer would reject (and vice versa).
 *
 * Conditional rules:
 *   STANDARD — date, category, item, amount, bank/payment information, and
 *              the supplier invoice attachment are required; WHT attachment
 *              is required whenever WHT is enabled (unchanged behavior).
 *   CASUAL   — date, category, item, and amount are required. VAT does not
 *              apply. Bank details, payment reference, and payment evidence
 *              are optional and are never invented to satisfy validation.
 *
 * The eventual backend must enforce the same rules — see
 * docs/api-contracts.md. Amount arithmetic itself stays in
 * expenseCalculations.ts; this module only validates presence/format.
 */
import {
  EXPENSE_TYPE,
  type ExpenseAttachment,
  type ExpenseType,
} from "./types";

export interface ExpenseValidationInput {
  date: number;
  category?: string;
  item?: string;
  amountBeforeVat: number;
  expenseType?: ExpenseType;
  bank?: string;
  invoiceAttachment?: ExpenseAttachment;
  whtEnabled?: boolean;
  whtAttachment?: ExpenseAttachment;
}

export interface ExpenseFieldRequirements {
  vatApplicable: boolean;
  bank: boolean;
  invoiceAttachment: boolean;
  whtAttachmentWhenEnabled: boolean;
}

/** Machine-readable requirements for a given classification. */
export function expenseFieldRequirements(
  expenseType?: ExpenseType,
): ExpenseFieldRequirements {
  const casual = expenseType === EXPENSE_TYPE.CASUAL;
  return {
    vatApplicable: !casual,
    bank: !casual,
    invoiceAttachment: !casual,
    whtAttachmentWhenEnabled: true,
  };
}

/** Validate the fields required to record an expense of either type. */
export function validateExpenseFields(
  input: ExpenseValidationInput,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const requirements = expenseFieldRequirements(input.expenseType);

  if (
    !input.date ||
    Number.isNaN(new Date(input.date).getTime())
  ) {
    errors.date = "A valid date is required";
  }
  if (!input.category?.trim()) {
    errors.category = "Expense Category is required";
  }
  if (!input.item?.trim()) {
    errors.item = "Equipment / Item is required";
  }
  if (
    !Number.isFinite(input.amountBeforeVat) ||
    input.amountBeforeVat < 0
  ) {
    errors.amountBeforeVat = "Enter a valid Amount Before VAT";
  }
  if (requirements.bank && !input.bank?.trim()) {
    errors.bank = "Bank / Payment Information is required";
  }
  if (requirements.invoiceAttachment && !input.invoiceAttachment) {
    errors.invoiceAttachment = "Invoice Attachment is required";
  }
  if (input.whtEnabled && !input.whtAttachment) {
    errors.whtAttachment = "WHT Attachment is required when WHT applies";
  }
  return errors;
}

export function isExpenseComplete(input: ExpenseValidationInput): boolean {
  return Object.keys(validateExpenseFields(input)).length === 0;
}
