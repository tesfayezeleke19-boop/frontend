/**
 * Expense classification verification — Standard vs Casual.
 *
 * Run: bun scripts/expense-casual-verify.ts
 *
 * Covers the acceptance criteria for casual expenses:
 *   - persisted classification (default STANDARD for new and legacy records)
 *   - no VAT, bank, reference, or payment evidence required
 *   - shared conditional validation (form + submission gate)
 *   - the normal Admin → Finance review lifecycle, with no auto-payment
 *   - standard expenses keep their existing VAT/bank/evidence rules
 *   - totals count each record exactly once and never fabricate values
 */
import {
  ExpensePermissionError,
  expensesRepository,
  getExpenseAuditLog,
  isExpenseCounted,
  validateExpenseForSubmission,
} from "../src/services/finance/expenses";
import { validateExpenseFields } from "../src/services/finance/expenseValidation";
import {
  EXPENSE_TYPE,
  expenseTypeOf,
  isVatApplicable,
  type Expense,
  type ExpenseInput,
} from "../src/services/finance/types";
import { matchesExpenseSearch } from "../src/services/finance/expenseFilters";
import { getFinanceSummary } from "../src/services/finance/summary";

/* ------------------------------------------------------------------ */
/* Environment                                                         */
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

const FINANCE = { id: "usr-finance-1", email: "finance@company.com", role: "FINANCE" } as const;
const ADMIN = { id: "usr-admin-1", email: "admin@company.com", role: "ADMIN" } as const;
const SALES = { id: "usr-sales-1", email: "sales@company.com", role: "SALES" } as const;

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

async function expectRejected(
  label: string,
  fn: () => Promise<unknown>,
  permissionError = false,
): Promise<void> {
  try {
    await fn();
    console.log(`FAIL  ${label} — expected an error, none thrown`);
    failures++;
  } catch (error) {
    const ok = permissionError
      ? error instanceof ExpensePermissionError
      : error instanceof Error;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${label}${ok ? ` — ${(error as Error).message.slice(0, 80)}` : " — wrong error type"}`,
    );
    if (!ok) failures++;
  }
}

function attachment(name: string) {
  return {
    id: `att-${name}`,
    fileName: name,
    fileUrl: "",
    mimeType: "application/pdf",
    fileSize: 2048,
  };
}

const NOW = Date.now();

function standardInput(overrides: Partial<ExpenseInput> = {}): ExpenseInput {
  return {
    item: "Loader rental",
    category: "Equipment",
    amountBeforeVat: 10_000,
    whtEnabled: true,
    bank: "CBE",
    paymentReference: "TXN-0001",
    invoiceAttachment: attachment("invoice.pdf"),
    whtAttachment: attachment("wht.pdf"),
    date: NOW,
    ...overrides,
  };
}

function casualInput(overrides: Partial<ExpenseInput> = {}): ExpenseInput {
  return {
    item: "Taxi fare to supplier",
    category: "Fuel & Transport",
    expenseType: EXPENSE_TYPE.CASUAL,
    amountBeforeVat: 500,
    whtEnabled: false,
    date: NOW,
    ...overrides,
  };
}

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* A — Defaults and standard behavior                                  */
/* ------------------------------------------------------------------ */

localStorage.removeItem(EXPENSES_KEY);
setSession(FINANCE);

console.log("\nA — Standard expense behavior is unchanged");
const standard = await expensesRepository.createExpense(
  standardInput({ item: "Standard diesel" }),
  FINANCE.email,
);
expect("A: new expenses default to STANDARD", standard.expenseType, EXPENSE_TYPE.STANDARD);
expect("A: standard VAT is still 15%", standard.vatAmount, 1500);
expect("A: standard total / after VAT unchanged", standard.amount, 11_500);
expect("A: standard WHT unchanged", standard.whtAmount, 300);
expect("A: standard total transferred unchanged", standard.totalTransferred, 11_200);
expect("A: standard remains VAT-applicable", isVatApplicable(standard), true);
expect("A: standard submission validation accepts the full record", validateExpenseForSubmission(standard).valid, true);

/* ------------------------------------------------------------------ */
/* B — Casual Finance expense                                          */
/* ------------------------------------------------------------------ */

console.log("\nB — Finance records a casual expense with no payment details");
const casual = await expensesRepository.createExpense(
  casualInput(),
  FINANCE.email,
);
expect("B: classification persisted", casual.expenseType, EXPENSE_TYPE.CASUAL);
expect("B: VAT not applied", casual.vatAmount, 0);
expect("B: accounting amount = entered amount", casual.amount, 500);
expect("B: total transferred = entered amount", casual.totalTransferred, 500);
expect("B: no VAT applicability inferred from a blank field", isVatApplicable(casual), false);
expect("B: bank not fabricated", casual.bank, undefined);
expect("B: payment reference not fabricated", casual.paymentReference, undefined);
expect("B: payment party not fabricated", casual.paymentParty, undefined);
expect("B: no attachment record fabricated", casual.invoiceAttachment, undefined);
expect("B: no WHT attachment fabricated", casual.whtAttachment, undefined);
expect("B: saved as a real Finance record", casual.reviewStatus, "RECORDED");
expect("B: counted once in accounting totals", isExpenseCounted(casual), true);
expect("B: not marked paid", casual.paidAt, undefined);
expect("B: no legacy DONE status", casual.paymentStatus, undefined);
expect("B: audit entry exists", getExpenseAuditLog(casual.id).length > 0, true);
expect(
  "B: casual submission validation passes without bank/evidence",
  validateExpenseForSubmission(casual).valid,
  true,
);

const persisted = await expensesRepository.getExpenseById(casual.id);
expect("B: classification is persisted, not component state", persisted?.expenseType, EXPENSE_TYPE.CASUAL);
expect("B: persisted amount survives reload", persisted?.amount, 500);

/* ------------------------------------------------------------------ */
/* C — Required business fields still apply                            */
/* ------------------------------------------------------------------ */

console.log("\nC — Basic information and amount validation still apply");
const invalid = validateExpenseFields({
  date: NaN,
  item: " ",
  category: "",
  amountBeforeVat: Number.NaN,
  expenseType: EXPENSE_TYPE.CASUAL,
});
expect(
  "C: casual still requires date/category/item/amount",
  [!!invalid.date, !!invalid.category, !!invalid.item, !!invalid.amountBeforeVat],
  [true, true, true, true],
);
expect(
  "C: casual does NOT report bank/attachment errors",
  [invalid.bank, invalid.invoiceAttachment],
  [undefined, undefined],
);
const negative = validateExpenseFields({
  date: NOW,
  item: "Taxi",
  category: "Fuel & Transport",
  amountBeforeVat: -1,
  expenseType: EXPENSE_TYPE.CASUAL,
});
expect("C: negative amount rejected", !!negative.amountBeforeVat, true);
const casualWht = validateExpenseFields({
  date: NOW,
  item: "Taxi",
  category: "Fuel & Transport",
  amountBeforeVat: 500,
  expenseType: EXPENSE_TYPE.CASUAL,
  whtEnabled: true,
});
expect(
  "C: WHT still requires its document when explicitly enabled",
  !!casualWht.whtAttachment,
  true,
);

/* ------------------------------------------------------------------ */
/* D — Standard validation remains strict                              */
/* ------------------------------------------------------------------ */

console.log("\nD — Standard expenses keep bank/evidence requirements");
setSession(ADMIN);
const incompleteStandard = await expensesRepository.createAdminExpense(
  standardInput({
    item: "Incomplete standard",
    bank: undefined,
    paymentReference: undefined,
    invoiceAttachment: undefined,
    whtEnabled: false,
    whtAttachment: undefined,
  }),
  ADMIN.email,
);
const incompleteErrors = validateExpenseForSubmission(incompleteStandard).errors;
expect("D: standard draft missing bank is invalid", !!incompleteErrors.bank, true);
expect(
  "D: standard draft missing invoice is invalid",
  !!incompleteErrors.invoiceAttachment,
  true,
);
await expectRejected(
  "D: an incomplete standard draft cannot be submitted",
  () => expensesRepository.submitAdminExpense(incompleteStandard.id, ADMIN.email),
);

/* ------------------------------------------------------------------ */
/* E — Casual Admin lifecycle                                          */
/* ------------------------------------------------------------------ */

console.log("\nE — Casual Admin draft → Finance review → approval");
setSession(ADMIN);
const casualDraft = await expensesRepository.createAdminExpense(
  casualInput({ item: "Casual site lunch", amountBeforeVat: 300 }),
  ADMIN.email,
);
expect("E: casual Admin record starts as DRAFT", casualDraft.reviewStatus, "DRAFT");
expect("E: casual draft not counted yet", isExpenseCounted(casualDraft), false);
const submittedCasual = await expensesRepository.submitAdminExpense(
  casualDraft.id,
  ADMIN.email,
);
expect("E: casual draft submits without bank/evidence", submittedCasual.reviewStatus, "PENDING_FINANCE_REVIEW");
expect("E: submission keeps the same record ID", submittedCasual.id, casualDraft.id);
expect("E: pending casual not counted yet", isExpenseCounted(submittedCasual), false);

setSession(ADMIN);
await expectRejected(
  "E: casual does not bypass Finance review",
  () => expensesRepository.approveAdminExpense(casualDraft.id, ADMIN.email),
  true,
);

setSession(FINANCE);
const approvedCasual = await expensesRepository.approveAdminExpense(
  casualDraft.id,
  FINANCE.email,
);
expect("E: Finance approves the casual expense", approvedCasual.reviewStatus, "APPROVED");
expect("E: approved casual counted exactly once", isExpenseCounted(approvedCasual), true);
expect("E: approval does not mark it paid", approvedCasual.paidAt, undefined);

/* ------------------------------------------------------------------ */
/* F — Editing: same ID, explicit reclassification                     */
/* ------------------------------------------------------------------ */

console.log("\nF — Editing keeps one record and recalculates deliberately");
const editedCasual = await expensesRepository.updateExpense(
  casual.id,
  { amountBeforeVat: 750, remark: "Corrected meter reading" },
  FINANCE.email,
);
expect("F: edit keeps the ID", editedCasual.id, casual.id);
expect("F: edit keeps casual classification", editedCasual.expenseType, EXPENSE_TYPE.CASUAL);
expect("F: casual VAT stays 0 after edit", editedCasual.vatAmount, 0);
expect("F: amount updated from the entered value", editedCasual.amount, 750);

const reclassified = await expensesRepository.updateExpense(
  casual.id,
  { expenseType: EXPENSE_TYPE.STANDARD },
  FINANCE.email,
);
expect("F: explicit reclassification to standard is persisted", reclassified.expenseType, EXPENSE_TYPE.STANDARD);
expect("F: VAT computed once standard is chosen", reclassified.vatAmount, 112.5);
expect("F: reclassification did not create a duplicate", (await expensesRepository.getExpenses()).filter((e) => e.id === casual.id).length, 1);

const backToCasual = await expensesRepository.updateExpense(
  casual.id,
  { expenseType: EXPENSE_TYPE.CASUAL },
  FINANCE.email,
);
expect("F: switching back to casual removes VAT explicitly", backToCasual.vatAmount, 0);
expect("F: total returns to the entered amount", backToCasual.amount, 750);

/* ------------------------------------------------------------------ */
/* G — Search / filters / totals                                       */
/* ------------------------------------------------------------------ */

console.log("\nG — Lists, search, and totals include casual exactly once");
expect("G: casual is searchable by type label", matchesExpenseSearch(backToCasual, "casual"), true);
expect("G: standard is searchable by type label", matchesExpenseSearch(standard, "standard"), true);
expect("G: casual is not returned by a standard type filter", expenseTypeOf(backToCasual), EXPENSE_TYPE.CASUAL);

const all = await expensesRepository.getExpenses();
const counted = all.filter(isExpenseCounted);
expect(
  "G: no duplicate casual records after save/edit/approve",
  all.filter((e) => e.id === casual.id).length,
  1,
);
const summary = await getFinanceSummary();
const expectedTotal = round2(counted.reduce((sum, e) => sum + e.amount, 0));
expect("G: Finance totalExpenses includes each counted record once", round2(summary.totalExpenses), expectedTotal);
expect(
  "G: casual contributes no VAT to the expense VAT total",
  round2(summary.expenseVat),
  round2(counted.reduce((sum, e) => sum + (Number.isFinite(e.vatAmount) ? e.vatAmount : 0), 0)),
);
expect("G: Net Profit formula unchanged", round2(summary.netProfit), round2(summary.grossIncome - summary.totalExpenses - summary.royalty));

/* ------------------------------------------------------------------ */
/* H — Legacy compatibility                                           */
/* ------------------------------------------------------------------ */

console.log("\nH — Historical records are never reinterpreted as casual");
const legacy = {
  id: "legacy-casual-test",
  item: "Historical office supplies",
  category: "Office Supplies",
  amount: 230,
  amountBeforeVat: 200,
  vatAmount: 30,
  whtEnabled: false,
  whtAmount: 0,
  totalTransferred: 230,
  bank: "CBE",
  date: NOW - 90 * 24 * 60 * 60 * 1000,
  createdBy: FINANCE.email,
  createdAt: NOW - 90 * 24 * 60 * 60 * 1000,
  updatedAt: NOW - 90 * 24 * 60 * 60 * 1000,
  paymentStatus: "DONE",
} as unknown as Expense;
localStorage.setItem(EXPENSES_KEY, JSON.stringify([...all, legacy]));
const loadedLegacy = (await expensesRepository.getExpenses()).find((e) => e.id === legacy.id);
expect("H: legacy record has no stored classification", loadedLegacy?.expenseType, undefined);
expect("H: legacy record reads as STANDARD", expenseTypeOf(loadedLegacy as Expense), EXPENSE_TYPE.STANDARD);
expect("H: legacy VAT treatment preserved", loadedLegacy?.vatAmount, 30);
expect("H: legacy status preserved", loadedLegacy?.paymentStatus, "DONE");

/* ------------------------------------------------------------------ */
/* I — Authorization                                                   */
/* ------------------------------------------------------------------ */

console.log("\nI — Casual creation does not bypass role checks");
setSession(SALES);
await expectRejected(
  "I: Sales cannot record a casual Finance expense",
  () => expensesRepository.createExpense(casualInput(), SALES.email),
  true,
);

/* ------------------------------------------------------------------ */

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
