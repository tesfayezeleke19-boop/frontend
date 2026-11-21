
/**
 * Public invoice repository.
 *
 * All invoice persistence is handled by the PHP API.
 */
import { ORDER_STATUS } from "./types";
import {
  calculateOrderTotals,
  calculateSalesInvoiceTotals,
} from "./invoice";
import type { SalesInvoice } from "./invoice";
import { apiSalesInvoicesRepository } from "./apiInvoiceRepo";

export const salesInvoicesRepository = apiSalesInvoicesRepository;

/**
 * Determines whether an invoice is eligible for royalty processing.
 */
export function isRoyaltyEligibleInvoice(
  invoice: SalesInvoice,
): boolean {
  return (
    invoice.status === ORDER_STATUS.FINANCE_APPROVED ||
    invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED
  );
}

/**
 * Recalculates individual order totals first, then recalculates
 * the invoice financial summary using the updated orders.
 */
export function recalcInvoice(
  invoice: SalesInvoice,
): SalesInvoice {
  const orders = invoice.orders.map((order) => ({
    ...order,
    ...calculateOrderTotals(order),
  }));

  const financialSummary = calculateSalesInvoiceTotals({
    orders,
    withholdingEnabled:
      invoice.financialSummary.withholdingEnabled,
  });

  return {
    ...invoice,
    orders,
    financialSummary,
  };
}

export type {
  InvoiceOrder,
  SalesInvoice,
  FileEvidence,
} from "./invoice";
