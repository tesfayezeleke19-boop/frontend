/**
 * Admin service layer — read-only reporting aggregation.
 *
 * This module does NOT create or modify data. It reads from the same
 * shared repositories used by Sales, Finance, and HR.
 */
export { type AdminSalesReportData } from "./summaryTypes";
export {
  type AdminSalesOverview,
  type AdminFinanceOverview,
  type AdminHROverview,
  type AdminMonthlyFinancialRow,
  type AdminOverallSummary,
  type AdminFinancialReportData,
  type AdminHRReportData,
  type AdminOverallReportData,
  getAdminSalesOverview,
  getAdminFinanceOverview,
  getAdminHROverview,
  getAdminMonthlyFinancials,
  getAdminOverallSummary,
  getAdminSalesReport,
  getAdminFinancialReport,
  getAdminHRReport,
} from "./summary";
