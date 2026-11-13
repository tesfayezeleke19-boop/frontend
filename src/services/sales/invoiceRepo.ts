/** Public invoice repository. All invoice persistence is handled by the PHP API. */
import { ORDER_STATUS } from "./types";
import { calculateOrderTotals, calculateSalesInvoiceTotals } from "./invoice";
import type { SalesInvoice } from "./invoice";
import { apiSalesInvoicesRepository } from "./apiInvoiceRepo";

export const salesInvoicesRepository = apiSalesInvoicesRepository;

export function isRoyaltyEligibleInvoice(invoice: SalesInvoice): boolean {
  return invoice.status === ORDER_STATUS.FINANCE_APPROVED || invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED;
}

export function recalcInvoice(invoice: SalesInvoice): SalesInvoice {
  const financialSummary = calculateSalesInvoiceTotals({
    orders: invoice.orders,
    withholdingEnabled: invoice.financialSummary.withholdingEnabled,
  });
  const orders = invoice.orders.map((order) => ({ ...order, ...calculateOrderTotals(order) }));
  return { ...invoice, orders, financialSummary };
}

export type { InvoiceOrder, SalesInvoice, FileEvidence } from "./invoice";
