/** Read-only Sales report adapter. The current backend has no report endpoints. */
import { salesInvoicesRepository } from "./invoiceRepo";
import { invoicesToSalesOrders } from "./orders";
import { ORDER_STATUS, REPORT_STATUS, type SalesOrder, type SalesReport, type SalesReportDetail } from "./types";
import { subscribeSales } from "./storage";

export interface SalesReportsRepository {
  getReports(): Promise<SalesReport[]>;
  getReportById(id: string): Promise<SalesReportDetail | null>;
  getAvailableConfirmedOrders(): Promise<SalesOrder[]>;
  createReport(orderIds: string[], actor?: string): Promise<SalesReportDetail>;
  subscribe(listener: () => void): () => void;
}
const noReportEndpoint = (): never => { throw new Error("Sales report creation is unavailable because the backend currently exposes no Sales Reports API. Invoice-based analytics are available instead."); };
export const salesReportsRepository: SalesReportsRepository = {
  async getReports() { return []; },
  async getReportById(_id) { return null; },
  async getAvailableConfirmedOrders() {
    const invoices = await salesInvoicesRepository.getInvoices();
    return invoicesToSalesOrders(invoices.filter((i) => i.status === ORDER_STATUS.PAYMENT_CONFIRMED));
  },
  async createReport(_orderIds, _actor) { return noReportEndpoint(); },
  subscribe(listener) { return subscribeSales(listener); },
};
