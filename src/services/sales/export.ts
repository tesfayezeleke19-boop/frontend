/**
 * Report export preparation.
 *
 * Generates a CSV representation of a Sales Report (no extra dependency).
 * When the PHP backend arrives, this module can be swapped for a server-side
 * PDF/Excel generation call without touching the report UI — the UI only
 * calls `downloadReportCsv`.
 */
import type { SalesReportDetail } from "./types";

function escapeCell(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(escapeCell).join(",");
}

/** Build a CSV document (transactions + grand totals) for a report. */
export function buildReportCsv(report: SalesReportDetail): string {
  const lines: string[] = [];
  lines.push(csvRow(["HATI PLC — Sales Report", report.reportNumber]));
  lines.push(
    csvRow([
      "Created",
      new Date(report.createdAt).toISOString(),
      "Transactions",
      report.transactionCount,
    ]),
  );
  lines.push("");
  lines.push(
    csvRow([
      "Order",
      "Customer",
      "Reff.no",
      "Aggregate",
      "Quantity",
      "Unit",
      "Unit Price",
      "Total Price",
      "Bank",
    ]),
  );
  for (const order of report.orders) {
    lines.push(
      csvRow([
        order.orderNumber,
        order.customerName,
        order.reffNo,
        order.aggregate,
        order.quantity,
        order.unit,
        order.unitPrice,
        order.totalPriceInclVat,
        order.bank,
      ]),
    );
  }
  lines.push("");
  lines.push(
    csvRow([
      "Total Quantity",
      report.totalQuantity,
      "Total Amount",
      report.totalAmount,
    ]),
  );
  return lines.join("\r\n");
}

/** Trigger a browser download of the report as a CSV file. */
export function downloadReportCsv(report: SalesReportDetail): void {
  const csv = buildReportCsv(report);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.reportNumber}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
