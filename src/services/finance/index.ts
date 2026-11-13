/**
 * Finance service layer — the only way the Finance UI reads and writes
 * finance data. Finance reads the SAME Sales orders through the shared
 * repository (src/services/sales) — there is no second copy of sales data.
 * Swapping the local persistence for the PHP REST API later means replacing
 * the repository implementations, not the pages.
 */
export * from "./types";
export {
  calculateVat,
  calculateGrossIncome,
  calculateRoyalty,
  calculateNetProfit,
  VAT_DIVISOR,
  ROYALTY_RATE,
} from "./calculations";
export {
  financialRecordsRepository,
  computeNextFinancialRecordNumber,
  type FinancialRecordsRepository,
} from "./records";
export {
  expensesRepository,
  ExpensePermissionError,
  isExpenseCounted,
  expenseSourceOf,
  validateExpenseForSubmission,
  getExpenseAuditLog,
  type ExpensesRepository,
} from "./expenses";
export {
  validateExpenseFields,
  expenseFieldRequirements,
  isExpenseComplete,
  type ExpenseValidationInput,
  type ExpenseFieldRequirements,
} from "./expenseValidation";
export {
  calculateExpenseTotals,
  EXPENSE_VAT_RATE,
  EXPENSE_WHT_RATE,
} from "./expenseCalculations";
export {
  payrollFinancialRecordsRepository,
  type PayrollFinancialRecordsRepository,
} from "./payrollRecords";
export {
  getFinanceSummary,
  getFinancialReports,
  getConfirmedRecordTotals,
} from "./summary";
export { subscribeFinance, notifyFinanceChanged } from "./storage";
