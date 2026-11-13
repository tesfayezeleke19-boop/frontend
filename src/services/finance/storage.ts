/**
 * Temporary persistence for Finance financial records.
 *
 * Until the PHP backend exists, financial records live in localStorage so
 * they survive refreshes. UI components never touch this module directly —
 * they go through the finance repository layer (src/services/finance/records.ts),
 * which will later be replaced by the PHP REST API.
 */
import { loadOrders } from "../sales/storage";
import {
  FINANCIAL_RECORD_STATUS,
  PAYROLL_RECORD_STATUS,
  type Expense,
  type ExpenseInput,
  type FinancialRecord,
  type PayrollFinancialRecord,
} from "./types";

const RECORDS_KEY = "nexerp.finance.records.v1";

function readStorage<T>(key: string, fallback: T | null): T | null {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota/private-mode failures; data just won't persist.
  }
}

/* ------------------------------------------------------------------ */
/* Change notification — lets Finance pages refresh after mutations.    */
/* ------------------------------------------------------------------ */

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeFinance(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyFinanceChanged(): void {
  listeners.forEach((listener) => listener());
}

/* ------------------------------------------------------------------ */
/* Seed data — one record for the seeded Payment-Confirmed order.       */
/* ------------------------------------------------------------------ */

const DAY = 24 * 60 * 60 * 1000;

export function buildSeedRecords(): FinancialRecord[] {
  const now = Date.now();
  return [
    {
      id: "fin-rec-0001",
      recordNumber: "FIN-REC-0001",
      sourceOrderId: "ord-0005",
      sourceOrderNumber: "ORDER-0005",
      customerName: "MNO Contractors",
      aggregate: "01",
      quantity: 25,
      unit: "m³",
      unitPrice: 2000,
      totalPrice: 50000,
      bank: "Awash Bank",
      status: FINANCIAL_RECORD_STATUS.POSTED,
      postedAt: now - 7 * DAY,
      postedBy: "finance@company.com",
      createdAt: now - 7 * DAY,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Records persistence                                                 */
/* ------------------------------------------------------------------ */

export function loadRecords(): FinancialRecord[] {
  const stored = readStorage<FinancialRecord[]>(RECORDS_KEY, null);
  if (stored && Array.isArray(stored) && stored.length > 0) {
    return stored;
  }
  // First run — seed the record only if the matching confirmed order exists
  // in the shared orders storage (avoids orphaned records on older data).
  const hasSeedOrder = loadOrders().some(
    (order: { id: string }) => order.id === "ord-0005",
  );
  const seeds = hasSeedOrder ? buildSeedRecords() : [];
  writeStorage(RECORDS_KEY, seeds);
  return seeds;
}

export function persistRecords(records: FinancialRecord[]): void {
  writeStorage(RECORDS_KEY, records);
}

/* ------------------------------------------------------------------ */
/* Expenses persistence                                                */
/* ------------------------------------------------------------------ */

const EXPENSES_KEY = "nexerp.finance.expenses.v1";

export function loadExpenses(): Expense[] {
  return readStorage<Expense[]>(EXPENSES_KEY, []) ?? [];
}

export function persistExpenses(expenses: Expense[]): void {
  writeStorage(EXPENSES_KEY, expenses);
}

/* ------------------------------------------------------------------ */
/* Payroll Financial Records persistence                               */
/* ------------------------------------------------------------------ */

const PAYROLL_RECORDS_KEY = "nexerp.finance.payroll-records.v1";

export function loadPayrollRecords(): PayrollFinancialRecord[] {
  return readStorage<PayrollFinancialRecord[]>(PAYROLL_RECORDS_KEY, []) ?? [];
}

export function persistPayrollRecords(records: PayrollFinancialRecord[]): void {
  writeStorage(PAYROLL_RECORDS_KEY, records);
}
