/**
 * Expense date-range + search filtering — ONE implementation shared by the
 * Finance Expenses page and the verification scripts, so the tested
 * behavior is exactly the UI behavior.
 *
 * Date ranges use local calendar boundaries (the expense transaction date),
 * weeks run Monday 00:00 → Sunday 23:59 — consistent with the Finance
 * Transactions date filters. Filters never modify records.
 */
import { EXPENSE_TYPE_LABELS, expenseTypeOf, type Expense } from "./types";

export type ExpenseRangeKind =
  | "ALL_TIME"
  | "TODAY"
  | "YESTERDAY"
  | "THIS_WEEK"
  | "LAST_WEEK"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "CUSTOM";

export interface ExpenseDateRange {
  start: number;
  end: number;
}

export const EXPENSE_RANGE_OPTIONS: {
  value: ExpenseRangeKind;
  label: string;
}[] = [
  { value: "ALL_TIME", label: "All time" },
  { value: "TODAY", label: "Today" },
  { value: "YESTERDAY", label: "Yesterday" },
  { value: "THIS_WEEK", label: "This week" },
  { value: "LAST_WEEK", label: "Last week" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "CUSTOM", label: "Custom range" },
];

export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Monday 00:00 → Sunday 23:59 (offset −1 = last week). */
export function localWeekRange(now: Date, offset: number): ExpenseDateRange {
  const mondayOffset = (now.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - mondayOffset + offset * 7,
  );
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: startOfLocalDay(monday.getTime()), end: endOfLocalDay(sunday.getTime()) };
}

function localMonthRange(now: Date, offset: number): ExpenseDateRange {
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { start: startOfLocalDay(first.getTime()), end: endOfLocalDay(last.getTime()) };
}

/**
 * Resolve a range selection. Returns `error` for an invalid custom range
 * (e.g. start after end) and `null` range when no date filter should apply.
 */
export function resolveExpenseDateRange(
  kind: ExpenseRangeKind,
  customFrom: string,
  customTo: string,
  now: Date = new Date(),
): { range: ExpenseDateRange | null; error?: string } {
  switch (kind) {
    case "ALL_TIME":
      return { range: null };
    case "TODAY":
      return {
        range: { start: startOfLocalDay(now.getTime()), end: endOfLocalDay(now.getTime()) },
      };
    case "YESTERDAY": {
      const y = startOfLocalDay(now.getTime()) - 24 * 60 * 60 * 1000;
      return { range: { start: y, end: endOfLocalDay(y) } };
    }
    case "THIS_WEEK":
      return { range: localWeekRange(now, 0) };
    case "LAST_WEEK":
      return { range: localWeekRange(now, -1) };
    case "THIS_MONTH":
      return { range: localMonthRange(now, 0) };
    case "LAST_MONTH":
      return { range: localMonthRange(now, -1) };
    case "CUSTOM": {
      const from = customFrom ? new Date(`${customFrom}T00:00:00`).getTime() : null;
      const to = customTo ? new Date(`${customTo}T23:59:59.999`).getTime() : null;
      if (customFrom && Number.isNaN(from as number))
        return { range: null, error: "Invalid start date" };
      if (customTo && Number.isNaN(to as number))
        return { range: null, error: "Invalid end date" };
      if (from !== null && to !== null && from > to) {
        return { range: null, error: "Start date must not be after the end date" };
      }
      if (from === null && to === null) return { range: null };
      return { range: { start: from ?? 0, end: to ?? Number.MAX_SAFE_INTEGER } };
    }
  }
}

/**
 * Search matches item, category, expense type, bank/payment reference, and
 * practical amount strings — used together with date filters.
 */
export function matchesExpenseSearch(
  expense: Expense,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    expense.item.toLowerCase().includes(q) ||
    (expense.category ?? "").toLowerCase().includes(q) ||
    EXPENSE_TYPE_LABELS[expenseTypeOf(expense)].toLowerCase().includes(q) ||
    (expense.bank ?? "").toLowerCase().includes(q) ||
    (expense.paymentReference ?? "").toLowerCase().includes(q) ||
    String(expense.amount ?? "").includes(q) ||
    String(expense.amountBeforeVat ?? "").includes(q) ||
    String(expense.totalTransferred ?? "").includes(q)
  );
}
