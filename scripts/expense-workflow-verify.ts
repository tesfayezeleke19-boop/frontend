/**
 * Expense workflow verification (Tests A–H).
 *
 * Run: bun scripts/expense-workflow-verify.ts
 *
 * Exercises the repository/service layer the UI is built on — same storage
 * contract, same authorization, same calculation engine. bun has no
 * localStorage, so an in-memory shim is injected ONLY for this run.
 */
import {
  expensesRepository,
  ExpensePermissionError,
  isExpenseCounted,
  getExpenseAuditLog,
} from "../src/services/finance/expenses";
import { getFinanceSummary } from "../src/services/finance/summary";
import {
  getAdminFinanceOverview,
  getAdminMonthlyFinancials,
} from "../src/services/admin/summary";
import {
  resolveExpenseDateRange,
  matchesExpenseSearch,
  localWeekRange,
  type ExpenseRangeKind,
} from "../src/services/finance/expenseFilters";
import type { Expense } from "../src/services/finance/types";

/* ------------------------------------------------------------------ */
/* Environment: localStorage shim + session control                    */
/* ------------------------------------------------------------------ */

if (typeof (globalThis as Record<string, unknown>).localStorage === "undefined") {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

const EXPENSES_KEY = "nexerp.finance.expenses.v1";
const SESSION_KEY = "nexerp.auth.session.v1";

interface TestUser {
  id: string;
  email: string;
  role: string;
}

function setSession(user: TestUser): void {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      user: {
        id: user.id,
        name: user.email,
        email: user.email,
        role: user.role,
        department: user.role === "FINANCE" ? "Finance" : "Administration",
        accountStatus: "ACTIVE",
      },
      isGuest: false,
      signedInAt: Date.now(),
    }),
  );
}

function setGuestSession(): void {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      user: {
        id: "guest",
        name: "Guest",
        email: "",
        role: "SALES",
        department: "Demo",
      },
      isGuest: true,
      signedInAt: Date.now(),
    }),
  );
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

function storedExpenses(): Expense[] {
  return JSON.parse(localStorage.getItem(EXPENSES_KEY) ?? "[]") as Expense[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
  if (!ok) failures++;
}

async function expectRejected(label: string, fn: () => Promise<unknown>, permissionError: boolean): Promise<void> {
  try {
    await fn();
    console.log(`FAIL  ${label} — expected an error, none thrown`);
    failures++;
  } catch (e) {
    const ok = permissionError ? e instanceof ExpensePermissionError : e instanceof Error;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${label}${ok ? " — " + (e as Error).message.slice(0, 70) : " — wrong error type"}`,
    );
    if (!ok) failures++;
  }
}

const DAY = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function attachment(name: string) {
  return {
    id: `att-${name}`,
    fileName: name,
    fileUrl: "",
    mimeType: "application/pdf",
    fileSize: 1234,
  };
}

type ExpenseInputArg = Parameters<typeof expensesRepository.createExpense>[0];

/** Full valid input — same required fields the submission validator enforces. */
function baseInput(overrides: Partial<ExpenseInputArg> = {}): ExpenseInputArg {
  return {
    item: "Loader rental",
    category: "Equipment",
    amountBeforeVat: 10000,
    whtEnabled: true,
    bank: "CBE",
    paymentReference: "TXN-0001",
    invoiceAttachment: attachment("invoice.pdf"),
    whtAttachment: attachment("wht-certificate.pdf"),
    date: Date.now(),
    ...overrides,
  };
}

/** Apply the page's filter pipeline (date range + search, never mutation). */
function applyFilters(
  records: Expense[],
  kind: ExpenseRangeKind,
  from: string,
  to: string,
  search: string,
): Expense[] {
  const { range } = resolveExpenseDateRange(kind, from, to);
  return records.filter(
    (e) =>
      (!range || (e.date >= range.start && e.date <= range.end)) &&
      matchesExpenseSearch(e, search),
  );
}

function assertFiniteAmounts(label: string, records: Expense[]): void {
  const allFinite = records.every(
    (e) =>
      Number.isFinite(e.amount) &&
      Number.isFinite(e.amountBeforeVat) &&
      Number.isFinite(e.vatAmount) &&
      Number.isFinite(e.totalTransferred) &&
      Number.isFinite(e.whtAmount),
  );
  expect(label, allFinite, true);
}

const FINANCE = { id: "usr-finance-1", email: "finance@company.com", role: "FINANCE" } as const;
const ADMIN = { id: "usr-admin-1", email: "admin@company.com", role: "ADMIN" } as const;

/* ------------------------------------------------------------------ */
/* Test A — Finance creates an expense (Workflow A, direct record)     */
/* ------------------------------------------------------------------ */

clearSession();
localStorage.removeItem(EXPENSES_KEY);
setSession(FINANCE);

console.log("\nTest A — Finance creates an expense");
const financeExpense = await expensesRepository.createExpense(
  baseInput({ item: "Loader rental", whtEnabled: true }),
  FINANCE.email,
);
expect("A: amountBeforeVat = 10,000", financeExpense.amountBeforeVat, 10000);
expect("A: VAT = 1,500 (15%)", financeExpense.vatAmount, 1500);
expect("A: WHT = 300 (3%, enabled)", financeExpense.whtAmount, 300);
expect("A: Total/After VAT = 11,500", financeExpense.amount, 11500);
expect("A: Total Transferred = 11,200", financeExpense.totalTransferred, 11200);
expect("A: source assigned FINANCE by role", financeExpense.expenseSource, "FINANCE");
expect("A: status RECORDED (no approval step)", financeExpense.reviewStatus, "RECORDED");
expect(
  "A: appears in Finance Expenses",
  (await expensesRepository.getFinanceExpenses()).some((e) => e.id === financeExpense.id),
  true,
);
expect(
  "A: NOT in any Admin/Finance review queue",
  (await expensesRepository.getFinanceReviewQueue()).length,
  0,
);
expect("A: counts in accounting totals immediately", isExpenseCounted(financeExpense), true);
expect("A: audit entry exists", getExpenseAuditLog(financeExpense.id).length > 0, true);

/* ------------------------------------------------------------------ */
/* Test B — Finance date filters + search                              */
/* ------------------------------------------------------------------ */

console.log("\nTest B — Finance filters (today/yesterday/weeks/months/custom/all)");
const now = new Date();
const lastWeek = localWeekRange(now, -1);

const dateCases: { tag: string; item: string; date: number }[] = [
  { tag: "thisWeekMonday", item: "Diesel purchase", date: localWeekRange(now, 0).start + 60_000 },
  { tag: "today", item: "Loader fuel", date: now.getTime() - 5_000 },
  { tag: "yesterday", item: "Office supplies", date: new Date(now.getTime() - DAY).getTime() - 60_000 },
  { tag: "lastWeekMonday", item: "Spare parts", date: lastWeek.start + 3_600_000 },
  { tag: "firstOfMonth", item: "Utilities", date: new Date(now.getFullYear(), now.getMonth(), 1, 12).getTime() },
  { tag: "firstOfLastMonth", item: "Rent", date: new Date(now.getFullYear(), now.getMonth() - 1, 1, 12).getTime() },
];

const recordIdByTag: Record<string, string> = {};
for (const c of dateCases) {
  const created = await expensesRepository.createExpense(
    baseInput({ item: c.item, whtEnabled: false, whtAttachment: undefined, date: c.date }),
    FINANCE.email,
  );
  recordIdByTag[c.tag] = created.id;
}

const allRecords = await expensesRepository.getFinanceExpenses();

const rangeCases: {
  kind: ExpenseRangeKind;
  include: string[];
  exclude: string[];
}[] = [
  { kind: "TODAY", include: ["today"], exclude: ["yesterday", "lastWeekMonday"] },
  { kind: "YESTERDAY", include: ["yesterday"], exclude: ["today", "lastWeekMonday"] },
  { kind: "THIS_WEEK", include: ["today", "thisWeekMonday"], exclude: ["lastWeekMonday", "firstOfLastMonth"] },
  { kind: "LAST_WEEK", include: ["lastWeekMonday"], exclude: ["today", "thisWeekMonday", "firstOfLastMonth"] },
  { kind: "THIS_MONTH", include: ["today", "firstOfMonth"], exclude: ["firstOfLastMonth"] },
  { kind: "LAST_MONTH", include: ["firstOfLastMonth"], exclude: ["today", "firstOfMonth"] },
  {
    kind: "ALL_TIME",
    include: ["today", "yesterday", "thisWeekMonday", "lastWeekMonday", "firstOfMonth", "firstOfLastMonth"],
    exclude: [],
  },
];
for (const c of rangeCases) {
  const resultIds = new Set(applyFilters(allRecords, c.kind, "", "", "").map((e) => e.id));
  const ok =
    c.include.every((tag) => resultIds.has(recordIdByTag[tag])) &&
    c.exclude.every((tag) => !resultIds.has(recordIdByTag[tag]));
  expect(`B: ${c.kind} includes/excludes correctly`, ok, true);
}

const todayIso = toInputDate(now.getTime());
const weekStartIso = toInputDate(localWeekRange(now, 0).start);
const customIds = new Set(applyFilters(allRecords, "CUSTOM", weekStartIso, todayIso, "").map((e) => e.id));
expect(
  "B: custom range covers this week, excludes last week",
  customIds.has(recordIdByTag.today) &&
    customIds.has(recordIdByTag.thisWeekMonday) &&
    !customIds.has(recordIdByTag.lastWeekMonday),
  true,
);
expect(
  "B: custom start-after-end is rejected",
  resolveExpenseDateRange("CUSTOM", todayIso, weekStartIso).error,
  "Start date must not be after the end date",
);
expect(
  "B: ALL_TIME with empty custom inputs applies no date filter",
  resolveExpenseDateRange("ALL_TIME", "", "").range,
  null,
);

const searchOnly = applyFilters(allRecords, "ALL_TIME", "", "", "diesel");
expect(
  "B: search by item matches",
  searchOnly.length === 1 && searchOnly[0].id === recordIdByTag.thisWeekMonday,
  true,
);
const monthlyDiesel = applyFilters(allRecords, "THIS_MONTH", "", "", "Diesel");
expect(
  "B: search + date filter work together",
  monthlyDiesel.length >= 1 && monthlyDiesel.every((e) => e.item === "Diesel purchase"),
  true,
);
const amountSearch = applyFilters(allRecords, "LAST_MONTH", "", "", "10000");
expect(
  "B: search by amount finds the legacy-pattern amount",
  amountSearch.length >= 1 && amountSearch.every((e) => e.amount === 11500 || e.amountBeforeVat === 10000),
  true,
);
assertFiniteAmounts("B: all records have finite numeric amounts", allRecords);

function toInputDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ------------------------------------------------------------------ */
/* Test C — Admin creates a draft, submits it                          */
/* ------------------------------------------------------------------ */

console.log("\nTest C — Admin expense draft → submit");
setSession(ADMIN);
const adminDraft = await expensesRepository.createAdminExpense(
  baseInput({
    item: "Company car service",
    category: "Maintenance",
    whtEnabled: false,
    whtAttachment: undefined,
  }),
  ADMIN.email,
);
expect("C: saved as DRAFT", adminDraft.reviewStatus, "DRAFT");
expect("C: source ADMIN assigned by role", adminDraft.expenseSource, "ADMIN");
expect(
  "C: appears in Admin Expenses",
  (await expensesRepository.getAdminExpenses()).some((e) => e.id === adminDraft.id),
  true,
);
expect("C: draft NOT in Finance review queue", (await expensesRepository.getFinanceReviewQueue()).length, 0);
expect("C: draft NOT counted in approved totals", isExpenseCounted(adminDraft), false);

const submitted = await expensesRepository.submitAdminExpense(adminDraft.id, ADMIN.email);
expect("C: submitted → PENDING_FINANCE_REVIEW", submitted.reviewStatus, "PENDING_FINANCE_REVIEW");
expect("C: same record ID preserved on submit", submitted.id, adminDraft.id);
expect(
  "C: enters Finance review queue",
  (await expensesRepository.getFinanceReviewQueue()).some((e) => e.id === adminDraft.id),
  true,
);
expect("C: still NOT counted before approval", isExpenseCounted(submitted), false);

/* ------------------------------------------------------------------ */
/* Test D — Finance approves                                           */
/* ------------------------------------------------------------------ */

console.log("\nTest D — Finance approves an Admin expense");
setSession(FINANCE);
const approved = await expensesRepository.approveAdminExpense(adminDraft.id, FINANCE.email);
expect("D: status persisted APPROVED", approved.reviewStatus, "APPROVED");
expect("D: reviewer recorded", approved.reviewedBy, FINANCE.email);
expect(
  "D: review timestamp recorded",
  typeof approved.reviewedAt === "number" && approved.reviewedAt > 0,
  true,
);
expect(
  "D: leaves the review queue",
  (await expensesRepository.getFinanceReviewQueue()).some((e) => e.id === adminDraft.id),
  false,
);
expect("D: counted in approved expense totals", isExpenseCounted(approved), true);
await expectRejected(
  "D: duplicate approval prevented",
  () => expensesRepository.approveAdminExpense(adminDraft.id, FINANCE.email),
  false,
);

/* ------------------------------------------------------------------ */
/* Test E — Finance rejects; Admin corrects and resubmits              */
/* ------------------------------------------------------------------ */

console.log("\nTest E — rejection, correction, resubmission");
setSession(ADMIN);
const rejectedDraft = await expensesRepository.createAdminExpense(
  baseInput({
    item: "Generator fuel",
    category: "Fuel & Transport",
    whtEnabled: false,
    whtAttachment: undefined,
  }),
  ADMIN.email,
);
const setupSubmitted = await expensesRepository.submitAdminExpense(rejectedDraft.id, ADMIN.email);
expect("E: setup — pending for review", setupSubmitted.reviewStatus, "PENDING_FINANCE_REVIEW");

setSession(FINANCE);
await expectRejected(
  "E: rejection without a reason is refused",
  () => expensesRepository.rejectAdminExpense(rejectedDraft.id, "   ", FINANCE.email),
  false,
);
const rejected = await expensesRepository.rejectAdminExpense(
  rejectedDraft.id,
  "Missing fuel-purchase receipt — attach the supplier invoice.",
  FINANCE.email,
);
expect("E: rejected", rejected.reviewStatus, "REJECTED");
expect(
  "E: reason persisted for Admin",
  rejected.rejectionReason,
  "Missing fuel-purchase receipt — attach the supplier invoice.",
);
expect("E: rejected expense excluded from approved totals", isExpenseCounted(rejected), false);

setSession(ADMIN);
const corrected = await expensesRepository.updateAdminExpense(
  rejectedDraft.id,
  { item: "Generator fuel — corrected", remark: "Attached supplier invoice" },
  ADMIN.email,
);
expect("E: same expense ID retained when corrected", corrected.id, rejectedDraft.id);
expect("E: correction applied", corrected.item, "Generator fuel — corrected");
const resubmitted = await expensesRepository.submitAdminExpense(rejectedDraft.id, ADMIN.email);
expect("E: resubmission keeps the ID", resubmitted.id, rejectedDraft.id);
expect(
  "E: resubmission → Pending Finance Review again",
  resubmitted.reviewStatus,
  "PENDING_FINANCE_REVIEW",
);
expect(
  "E: status history recorded",
  (resubmitted.statusHistory ?? []).length >= 4,
  true,
);
expect(
  "E: history includes the earlier rejection",
  (resubmitted.statusHistory ?? []).some((h) => h.status === "REJECTED"),
  true,
);
expect("E: resubmitted record still excluded from totals", isExpenseCounted(resubmitted), false);

/* ------------------------------------------------------------------ */
/* Test F — Authorization                                              */
/* ------------------------------------------------------------------ */

console.log("\nTest F — role authorization");
const SALES = { id: "usr-sales-1", email: "sales@company.com", role: "SALES" } as const;
const HR = { id: "usr-hr-1", email: "hr@company.com", role: "HR" } as const;

setSession(SALES);
await expectRejected(
  "F: Sales cannot create Finance expenses",
  () => expensesRepository.createExpense(baseInput(), SALES.email),
  true,
);
setSession(HR);
await expectRejected(
  "F: HR cannot create expenses",
  () => expensesRepository.createExpense(baseInput(), HR.email),
  true,
);
setGuestSession();
await expectRejected(
  "F: guests cannot perform privileged operations",
  () => expensesRepository.createAdminExpense(baseInput(), undefined),
  true,
);
setSession(ADMIN);
await expectRejected(
  "F: Admin cannot approve its own expense (Finance-only action)",
  () => expensesRepository.approveAdminExpense(adminDraft.id, ADMIN.email),
  true,
);
setSession(ADMIN);
await expectRejected(
  "F: Admin cannot call privileged Finance review on non-Admin workflow",
  () => expensesRepository.updateExpense(financeExpense.id, { item: "x" }, ADMIN.email),
  true,
);
setSession(FINANCE);
await expectRejected(
  "F: Finance cannot edit Admin workflow records",
  () => expensesRepository.updateExpense(adminDraft.id, { item: "hijack" }, FINANCE.email),
  true,
);
const adminOwnedAfter = await expensesRepository.getExpenseById(adminDraft.id);
expect("F: Admin expense ownership unchanged", adminOwnedAfter?.expenseSource, "ADMIN");
await expectRejected(
  "F: Finance cannot submit its own expense to Admin review",
  () => expensesRepository.submitAdminExpense(financeExpense.id, FINANCE.email),
  true,
);
const financeOwnedAfter = await expensesRepository.getExpenseById(financeExpense.id);
expect("F: Finance expense ownership unchanged", financeOwnedAfter?.expenseSource, "FINANCE");

/* ------------------------------------------------------------------ */
/* Test G — Financial reports & accounting integrity                   */
/* ------------------------------------------------------------------ */

console.log("\nTest G — reporting, no double counting");
const countedRecords = (await expensesRepository.getExpenses()).filter(isExpenseCounted);
// Finance-owned: A + 6 filter-seeded records. Approved Admin expense: D.
// Pending resubmission (E) stays excluded — exactly-once per record.
const expectedTotalBeforeLegacy = round2(
  countedRecords.reduce((s, e) => s + (Number.isFinite(e.amount) ? e.amount : 0), 0),
);
expect(
  "G: approved Admin + Finance records counted; pending excluded",
  countedRecords.some((e) => e.id === adminDraft.id) &&
    countedRecords.some((e) => e.id === financeExpense.id) &&
    !countedRecords.some((e) => e.id === rejectedDraft.id),
  true,
);

const financeSummary = await getFinanceSummary();
expect("G: Finance summary totalExpenses = counted sum", round2(financeSummary.totalExpenses), expectedTotalBeforeLegacy);
expect(
  "G: no NaN in Finance summary figures",
  [financeSummary.totalSales, financeSummary.vat, financeSummary.grossIncome, financeSummary.royalty, financeSummary.netProfit, financeSummary.totalExpenses].every(Number.isFinite),
  true,
);
expect(
  "G: Net Profit = Gross Income − Total Expenses − Royalty (once)",
  round2(financeSummary.netProfit),
  round2(financeSummary.grossIncome - financeSummary.totalExpenses - financeSummary.royalty),
);

const adminFinance = await getAdminFinanceOverview();
expect("G: Admin summary totalExpenses identical", round2(adminFinance.totalExpenses), expectedTotalBeforeLegacy);
expect(
  "G: VAT and WHT remain separate informational components",
  round2(adminFinance.expenseVat) === round2(countedRecords.reduce((s, e) => s + e.vatAmount, 0)) &&
    round2(adminFinance.expenseWht) === round2(countedRecords.reduce((s, e) => s + e.whtAmount, 0)),
  true,
);

const monthly = await getAdminMonthlyFinancials(now.getFullYear());
const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const thisMonthRow = monthly.find((r) => r.monthKey === monthKey);
const monthCounted = round2(
  countedRecords
    .filter((e) => {
      const d = new Date(e.date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .reduce((s, e) => s + e.amount, 0),
);
expect(
  "G: monthly grouping uses the expense transaction date",
  round2(thisMonthRow?.expenses ?? NaN),
  monthCounted,
);
expect(
  "G: no NaN/undefined in monthly rows",
  monthly.every((r) => [r.totalSales, r.vat, r.grossIncome, r.expenses, r.royalty, r.netProfit].every(Number.isFinite)),
  true,
);

/* ------------------------------------------------------------------ */
/* Test H — Legacy migration (idempotent, preserves everything)        */
/* ------------------------------------------------------------------ */

console.log("\nTest H — legacy migration");
// Seed pre-split records with NO expenseSource — as old data would exist.
const legacyPre = [
  {
    id: "legacy-done-1",
    item: "Historical loader rental",
    category: "Equipment",
    amount: 7000,
    amountBeforeVat: 7000,
    vatAmount: 0,
    whtEnabled: false,
    whtAmount: 0,
    totalTransferred: 7000,
    bank: "CBE",
    invoiceAttachment: attachment("old-invoice.pdf"),
    date: now.getTime() - 30 * DAY,
    createdBy: "finance@company.com",
    createdAt: now.getTime() - 30 * DAY,
    updatedAt: now.getTime() - 30 * DAY,
    paymentStatus: "DONE",
    paidBy: "admin@company.com",
    paidAt: now.getTime() - 29 * DAY,
  },
  {
    id: "legacy-unknown-1",
    item: "Historical office supplies",
    category: "Office Supplies",
    amount: 300,
    amountBeforeVat: 300,
    vatAmount: 0,
    whtEnabled: false,
    whtAmount: 0,
    totalTransferred: 300,
    bank: "Awash",
    date: now.getTime() - 250 * DAY,
    createdBy: "ghost@somewhere.com",
    createdAt: now.getTime() - 250 * DAY,
    updatedAt: now.getTime() - 250 * DAY,
  },
] as unknown as Expense[];
// Snapshot the audit key too — migration must leave history untouched.
const auditKey = "nexerp.finance.expenseAudit.v1";
const recordCountBeforeLegacy = storedExpenses().length;
// APPEND the legacy records to existing storage — the same situation as a
// real browser's localStorage gaining the new source-aware loader.
localStorage.setItem(
  EXPENSES_KEY,
  JSON.stringify([...storedExpenses(), ...legacyPre]),
);
const auditBefore = JSON.parse(localStorage.getItem(auditKey) ?? "null");

const migrated = await expensesRepository.getExpenses();
expect(
  "H: no records deleted, no duplicates appended",
  migrated.length,
  recordCountBeforeLegacy + 2,
);
const legacyDone = migrated.find((e) => e.id === "legacy-done-1");
const legacyUnknown = migrated.find((e) => e.id === "legacy-unknown-1");
expect("H: finance-creator legacy record → FINANCE", legacyDone?.expenseSource, "FINANCE");
expect(
  "H: unknown-creator record → LEGACY (ownership not invented)",
  legacyUnknown?.expenseSource,
  "LEGACY",
);
expect("H: legacy DONE keeps its historical meaning", legacyDone?.paymentStatus, "DONE");
expect("H: no canonical review status invented for legacy records", legacyDone?.reviewStatus ?? "unset", "unset");
expect("H: legacy UNVERIFIED historical flag assigned", legacyUnknown?.paymentStatus, "UNVERIFIED");
expect("H: monetary values preserved", [legacyDone?.amount, legacyUnknown?.amount], [7000, 300]);
expect("H: attachment metadata preserved", legacyDone?.invoiceAttachment?.fileName, "old-invoice.pdf");
expect(
  "H: unknown-source legacy record counted once (existing policy)",
  isExpenseCounted(legacyUnknown as Expense),
  true,
);
expect(
  "H: audit history untouched by migration",
  JSON.stringify(JSON.parse(localStorage.getItem(auditKey) ?? "null")),
  JSON.stringify(auditBefore),
);

// Idempotency — running again must not change anything.
const fingerprint = (rows: Expense[]) =>
  JSON.stringify(rows.map((e) => `${e.id}|${e.expenseSource}|${e.paymentStatus}|${e.reviewStatus}|${e.amount}`));
const firstRun = fingerprint(storedExpenses());
await expensesRepository.getExpenses();
await expensesRepository.getAdminExpenses();
expect("H: repeated loads produce identical migration state", fingerprint(storedExpenses()), firstRun);
expect(
  "H: record count unchanged after repeated loads",
  storedExpenses().length,
  recordCountBeforeLegacy + 2,
);

// Legacy records counted exactly once in the financial totals.
const totalsAfterLegacy = await getFinanceSummary();
expect(
  "H: totals = previous counted sum + legacy amounts (each once)",
  round2(totalsAfterLegacy.totalExpenses),
  round2(expectedTotalBeforeLegacy + 7000 + 300),
);

/* ------------------------------------------------------------------ */

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
