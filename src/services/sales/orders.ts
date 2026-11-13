/**
 * Compatibility read-model for legacy SalesOrder screens.
 * Each row is derived from a child line on a backend Sales Invoice. There is
 * intentionally no standalone-order persistence because no such API exists.
 */
import { salesInvoicesRepository } from "./invoiceRepo";
import { calculateTotalPriceExclVat, calculateTotalPriceInclVat, computeNextOrderNumber } from "./calc";
import { notifySalesChanged, subscribeSales } from "./storage";
import { ORDER_STATUS, isEditableStatus, type OrderInput, type OrderStatus, type SalesOrder, type SalesSummary } from "./types";
import type { SalesInvoice } from "./invoice";

export interface SalesOrdersRepository {
  getOrders(): Promise<SalesOrder[]>;
  getOrderById(id: string): Promise<SalesOrder | null>;
  getOrderByNumber(orderNumber: string): Promise<SalesOrder | null>;
  getOrdersByStatus(status: OrderStatus): Promise<SalesOrder[]>;
  getSalesSummary(): Promise<SalesSummary>;
  getNextOrderNumber(): Promise<string>;
  createOrder(input: OrderInput, options?: { status?: OrderStatus; actor?: string }): Promise<SalesOrder>;
  updateOrder(id: string, input: Partial<OrderInput>, actor?: string): Promise<SalesOrder>;
  saveDraft(id: string, input: Partial<OrderInput>, actor?: string): Promise<SalesOrder>;
  submitOrder(id: string, actor?: string): Promise<SalesOrder>;
  rejectOrder(id: string, reason: string, actor?: string): Promise<SalesOrder>;
  approveOrder(id: string, actor?: string): Promise<SalesOrder>;
  confirmPayment(id: string, actor?: string): Promise<SalesOrder>;
  subscribe(listener: () => void): () => void;
}

export const REVENUE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  ORDER_STATUS.PENDING_FINANCE_REVIEW, ORDER_STATUS.FINANCE_APPROVED, ORDER_STATUS.PAYMENT_CONFIRMED,
]);

function lineToOrder(invoice: SalesInvoice, line: SalesInvoice["orders"][number]): SalesOrder {
  const orderNumber = `${invoice.invoiceNumber}-${String(line.orderNumber).padStart(2, "0")}`;
  const totalPriceExclVat = calculateTotalPriceExclVat(line.unitPrice, line.quantity);
  const totalPriceInclVat = calculateTotalPriceInclVat(line.unitPrice, line.quantity);
  return {
    id: line.id, orderNumber, customerName: invoice.customer.name, tin: invoice.customer.tin,
    reffNo: invoice.fsNo, aggregate: line.aggregate, quantity: line.quantity, unit: line.unit || "m³",
    unitPrice: line.unitPrice, totalPriceExclVat, totalPriceInclVat, bank: invoice.payment.bank,
    senderName: invoice.payment.paymentSender, transactionNumber: invoice.payment.paymentReferenceNumber,
    remark: invoice.remark, status: invoice.status, orderDate: line.orderDate ?? invoice.date,
    createdAt: invoice.createdAt, updatedAt: invoice.updatedAt, submittedAt: invoice.submittedAt,
    financeReviewedAt: invoice.financeReviewedAt, approvedAt: invoice.approvedAt,
    rejectedAt: invoice.rejectedAt, paymentConfirmedAt: invoice.paymentConfirmedAt,
    rejectionReason: invoice.rejectionReason, createdBy: invoice.createdBy, submittedBy: invoice.submittedBy,
    approvedBy: invoice.approvedBy, paymentConfirmedBy: invoice.paymentConfirmedBy,
  };
}
export function invoicesToSalesOrders(invoices: SalesInvoice[]): SalesOrder[] {
  return invoices.flatMap((invoice) => invoice.orders.map((line) => lineToOrder(invoice, line)))
    .sort((a, b) => b.createdAt - a.createdAt);
}
function unsupported(): never { throw new Error("Standalone Sales Orders are not supported by the current backend. Create and manage orders as lines within a Sales Invoice."); }

export const salesOrdersRepository: SalesOrdersRepository = {
  async getOrders() { return invoicesToSalesOrders(await salesInvoicesRepository.getInvoices()); },
  async getOrderById(id) { return (await this.getOrders()).find((o) => o.id === id) ?? null; },
  async getOrderByNumber(n) { return (await this.getOrders()).find((o) => o.orderNumber === n) ?? null; },
  async getOrdersByStatus(status) { return (await this.getOrders()).filter((o) => o.status === status); },
  async getNextOrderNumber() { return computeNextOrderNumber(await this.getOrders()); },
  async getSalesSummary() {
    const orders = await this.getOrders();
    const invoices = await salesInvoicesRepository.getInvoices();
    const aggregateTotals = new Map<string, number>();
    for (const order of orders) aggregateTotals.set(order.aggregate, (aggregateTotals.get(order.aggregate) ?? 0) + order.totalPriceInclVat);
    const months = new Map<string, number>();
    for (const invoice of invoices) {
      if (!REVENUE_STATUSES.has(invoice.status)) continue;
      const date = new Date(invoice.date);
      const key = date.toLocaleString("en-US", { month: "short", year: "numeric" });
      months.set(key, (months.get(key) ?? 0) + invoice.financialSummary.totalPriceInclVat);
    }
    return {
      totalOrders: orders.length,
      totalRevenue: invoices.filter((i) => REVENUE_STATUSES.has(i.status)).reduce((sum, i) => sum + i.financialSummary.totalPriceInclVat, 0),
      draft: orders.filter((o) => o.status === ORDER_STATUS.DRAFT).length,
      pendingReview: orders.filter((o) => o.status === ORDER_STATUS.PENDING_FINANCE_REVIEW).length,
      approved: orders.filter((o) => o.status === ORDER_STATUS.FINANCE_APPROVED).length,
      rejected: orders.filter((o) => o.status === ORDER_STATUS.REJECTED).length,
      paymentConfirmed: orders.filter((o) => o.status === ORDER_STATUS.PAYMENT_CONFIRMED).length,
      byAggregate: [...aggregateTotals].map(([name, value]) => ({ name, value })),
      byMonth: [...months].map(([name, value]) => ({ name, value })), recent: orders.slice(0, 8),
    };
  },
  async createOrder() { return unsupported(); }, async updateOrder() { return unsupported(); },
  async saveDraft() { return unsupported(); }, async submitOrder() { return unsupported(); },
  async rejectOrder() { return unsupported(); }, async approveOrder() { return unsupported(); },
  async confirmPayment() { return unsupported(); },
  subscribe(listener) { return subscribeSales(listener); },
};
