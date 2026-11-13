/**
 * Sales service layer — the only way the UI reads and writes sales data.
 *
 * Exposes the shared types, calculations, formatters, and repository
 * singletons. Swapping the local persistence for the PHP REST API later means
 * replacing the repository implementations, not the pages.
 */
export * from "./types";
export {
  calculateTotalPrice,
  calculateTotalPriceExclVat,
  calculateTotalPriceInclVat,
  computeNextOrderNumber,
  computeNextReportNumber,
  normalizeNumber,
  roundMoney,
} from "./calc";
export { formatCurrency, formatDate, formatQuantity } from "./format";
export { salesOrdersRepository, type SalesOrdersRepository } from "./orders";
export {
  salesReportsRepository,
  type SalesReportsRepository,
} from "./reports";
