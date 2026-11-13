/**
 * AdminSalesReportData type definition. Kept in its own module so both the
 * summary service and the admin index can import it without cycles.
 */
import type { SalesInvoice } from "../sales/invoice";

export interface AdminSalesReportData {
  byMonth: { name: string; value: number }[];
  byAggregate: { name: string; value: number }[];
  byStatus: { name: string; value: number }[];
  totalSales: number;
  approvedSales: number;
  rejectedSales: number;
  pendingReview: number;
  totalQuantity: number;
  /** Revenue invoices (pending/approved/payment-confirmed) for the table. */
  invoices: SalesInvoice[];
}
