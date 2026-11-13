/**
 * Central Expense calculation service.
 *
 * All expense money math lives HERE — the Expenses form, Finance reports,
 * and Admin summaries all import from this module. No UI component
 * computes expense values independently.
 *
 * Rules:
 *   amountBeforeVat          — user-entered numeric ≥ 0
 *   vatAmount                — amountBeforeVat × EXPENSE_VAT_RATE (15%)
 *                              (0 when VAT is explicitly not applicable)
 *   totalAfterVat            — amountBeforeVat + vatAmount
 *   whtAmount (WHT enabled)  — whtBase × EXPENSE_WHT_RATE (default base =
 *                              amountBeforeVat, default rate 3%)
 *   whtAmount (WHT disabled) — 0
 *   totalTransferred         — totalAfterVat − whtAmount
 *
 * NOTE: this default 3% WHT rule is deliberately separate from the Sales
 * Invoice withholding rule (which applies 3% to the VAT-inclusive total).
 * Both rates are centralized here and easy to adjust once accounting
 * confirms the official treatment. This is a configured business rule, not
 * a legally verified tax treatment.
 */
import { normalizeNumber, roundMoney } from "../sales/calc";

/** Expense VAT rate (15%) — centralized, configurable in one place. */
export const EXPENSE_VAT_RATE = 0.15;
/** Default expense WHT rate (3%) — pending accounting confirmation. */
export const EXPENSE_WHT_RATE = 0.03;
/** Default expense WHT calculation base. */
export const EXPENSE_WHT_BASE: "amountBeforeVat" | "totalAfterVat" =
  "amountBeforeVat";

export interface ExpenseCalculations {
  amountBeforeVat: number;
  /** false = VAT does not apply (casual expense); vatAmount is then 0. */
  vatApplicable: boolean;
  vatAmount: number;
  totalAfterVat: number;
  whtEnabled: boolean;
  whtRate: number;
  whtBase: string;
  whtAmount: number;
  totalTransferred: number;
}

/**
 * THE one expense calculation function.
 *
 * `vatApplicable` defaults to true, which keeps every existing STANDARD
 * calculation byte-for-byte identical. A CASUAL expense passes false: VAT is
 * explicitly not computed (0) and the accounting amount is the entered
 * amount. This is NOT "VAT inferred as zero because the field was blank" —
 * the caller must classify the expense first.
 */
export function calculateExpenseTotals(input: {
  amountBeforeVat: unknown;
  vatApplicable?: boolean;
  vatRate?: number;
  whtEnabled: boolean;
  whtRate?: number;
  whtBase?: "amountBeforeVat" | "totalAfterVat";
}): ExpenseCalculations {
  const amountBeforeVat = Math.max(0, roundMoney(normalizeNumber(input.amountBeforeVat)));
  const vatApplicable = input.vatApplicable !== false;
  const vatRate = input.vatRate ?? EXPENSE_VAT_RATE;
  const whtRate = input.whtRate ?? EXPENSE_WHT_RATE;
  const whtBase = input.whtBase ?? EXPENSE_WHT_BASE;

  const vatAmount = vatApplicable
    ? roundMoney(amountBeforeVat * vatRate)
    : 0;
  const totalAfterVat = roundMoney(amountBeforeVat + vatAmount);

  const effectiveWhtRate = input.whtEnabled ? whtRate : 0;
  const whtBaseValue = whtBase === "totalAfterVat" ? totalAfterVat : amountBeforeVat;
  const whtAmount = input.whtEnabled
    ? roundMoney(whtBaseValue * whtRate)
    : 0;
  const totalTransferred = roundMoney(totalAfterVat - whtAmount);

  return {
    amountBeforeVat,
    vatApplicable,
    vatAmount,
    totalAfterVat,
    whtEnabled: input.whtEnabled,
    whtRate: effectiveWhtRate,
    whtBase,
    whtAmount,
    totalTransferred,
  };
}
