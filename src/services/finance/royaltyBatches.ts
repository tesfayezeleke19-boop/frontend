/**
 * Royalty batch tracking and Excel export.
 *
 * Report rows and completed batch records come from the Finance backend API.
 * PostgreSQL automatically creates and finalizes batches when 50 eligible
 * invoice lines have been staged.
 *
 * Exporting waiting records or historical batches does not modify the queue.
 */

import * as XLSX from "xlsx";

import { salesInvoicesRepository } from "../sales/invoiceRepo";
import { ORDER_STATUS } from "../sales/types";
import type { SalesInvoice } from "../sales/invoice";

import {
  financeRoyaltyReportsApi,
  type FinanceRoyaltyBatch,
} from "./royaltyReport";

import { subscribeFinance } from "./storage";
import { roundMoney } from "../sales/calc";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const ROYALTY_BATCH_SIZE = 50;
export const ROYALTY_RATE = 0.03;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export const ROYALTY_BATCH_STATUS = {
  PENDING: "PENDING",
  FINALIZED: "FINALIZED",
} as const;

export type RoyaltyBatchStatus =
  (typeof ROYALTY_BATCH_STATUS)[keyof typeof ROYALTY_BATCH_STATUS];

export interface RoyaltyBatch extends FinanceRoyaltyBatch {
  status: RoyaltyBatchStatus;
}

/* ------------------------------------------------------------------ */
/* Export Row Type                                                     */
/* ------------------------------------------------------------------ */

export interface RoyaltyExportRow {
  /** Business date of the source invoice/order, in milliseconds. */
  date: number;

  /** Royalty Invoice Number belonging to the specific child order. */
  royaltyInvoiceNumber?: string;

  /** Aggregate code preserved as a string, e.g. "00", "01", "02". */
  aggregate: string;

  quantity: number;
  unitPrice: number;

  /** VAT-exclusive total price. */
  lineTotalExclVat: number;

  /** Persisted royalty snapshot, when available. */
  royalty?: number;
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export interface RoyaltyBatchesRepository {
  getBatches(): Promise<RoyaltyBatch[]>;
  getEligibleInvoices(): Promise<SalesInvoice[]>;
  getNextBatchNumber(): Promise<number>;

  /**
   * Load the persisted rows belonging to one completed batch.
   * These rows must come from the selected batch's saved database records.
   */
  getBatchRows(batchId: string): Promise<RoyaltyExportRow[]>;

  subscribe(listener: () => void): () => void;
}

export class ApiRoyaltyBatchesRepository
  implements RoyaltyBatchesRepository
{
  /**
   * Load completed batches persisted in PostgreSQL.
   */
  async getBatches(): Promise<RoyaltyBatch[]> {
    const batches = await financeRoyaltyReportsApi.getBatches();

    return [...batches].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  /**
   * Return approved or payment-confirmed invoices that still have
   * unbatched invoice rows.
   *
   * This method is retained for compatibility with existing callers.
   */
  async getEligibleInvoices(): Promise<SalesInvoice[]> {
    const [invoices, batches] = await Promise.all([
      salesInvoicesRepository.getInvoices(),
      financeRoyaltyReportsApi.getBatches(),
    ]);

    const finalizedKeys = new Set(
      batches
        .filter(
          (batch) =>
            batch.status === ROYALTY_BATCH_STATUS.FINALIZED,
        )
        .flatMap((batch) => batch.orderIds),
    );

    return invoices
      .filter((invoice) => {
        const eligibleStatus =
          invoice.status === ORDER_STATUS.FINANCE_APPROVED ||
          invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED;

        if (!eligibleStatus) return false;

        // Report keys are `${invoiceId}-${invoiceLineId}`.
        // Match the complete invoice ID prefix without parsing UUID hyphens.
        const hasUnbatchedInvoiceRow = ![...finalizedKeys].some(
          (key) => key.startsWith(`${invoice.id}-`),
        );

        return hasUnbatchedInvoiceRow;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Calculate the next display batch number.
   * PostgreSQL generates the actual batch numbers automatically.
   */
  async getNextBatchNumber(): Promise<number> {
    const batches = await financeRoyaltyReportsApi.getBatches();

    return (
      batches.reduce(
        (maximum, batch) => Math.max(maximum, batch.batchNumber),
        0,
      ) + 1
    );
  }

  /**
   * Load one completed batch's persisted snapshot.
   *
   * Never derive historical records from the live report rows.
   */
  async getBatchRows(batchId: string): Promise<RoyaltyExportRow[]> {
    if (!batchId?.trim()) {
      throw new Error("A batch id is required to export a batch.");
    }

    const { batch, rows } =
      await financeRoyaltyReportsApi.getBatch(batchId);

    if (!batch) {
      throw new Error(
        "The selected batch metadata is unavailable. The historical export cannot be verified.",
      );
    }

    const expectedCount = Number(batch.recordCount);

    if (!Number.isInteger(expectedCount) || expectedCount < 1) {
      throw new Error(
        "The selected batch has no valid persisted record count.",
      );
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(
        "The selected batch has no stored records available for export.",
      );
    }

    if (rows.length !== expectedCount) {
      throw new Error(
        `The historical batch data is incomplete: ${rows.length} of ${expectedCount} records were returned. No file was exported.`,
      );
    }

    return rows.map((row) => ({
      date: row.date ?? 0,
      royaltyInvoiceNumber:
        row.royaltyInvoiceNumber ?? undefined,
      aggregate: row.aggregate,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      lineTotalExclVat: row.lineTotalExclVat,
      royalty: row.royalty,
    }));
  }

  subscribe(listener: () => void): () => void {
    return subscribeFinance(listener);
  }
}

export const royaltyBatchesRepository: RoyaltyBatchesRepository =
  new ApiRoyaltyBatchesRepository();

/* ------------------------------------------------------------------ */
/* Excel Export                                                        */
/* ------------------------------------------------------------------ */

export const ROYALTY_REPORT_COLUMNS = [
  "Date",
  "Royalty Invoice Number",
  "Aggregate Type",
  "Quantity (m³)",
  "Unit Price",
  "Total Price",
  "3%",
] as const;

/**
 * Calculate royalty on the VAT-exclusive amount.
 */
export function calculateRoyaltyAmount(
  lineTotalExclVat: number,
): number {
  return roundMoney(
    Math.max(0, lineTotalExclVat) * ROYALTY_RATE,
  );
}

/**
 * Prefer the persisted royalty snapshot when available.
 */
export function resolveRoyaltyAmount(
  row: Pick<RoyaltyExportRow, "lineTotalExclVat" | "royalty">,
): number {
  const total = roundMoney(row.lineTotalExclVat);

  return typeof row.royalty === "number" &&
    Number.isFinite(row.royalty)
    ? roundMoney(row.royalty)
    : calculateRoyaltyAmount(total);
}

function formatRoyaltyDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Build worksheet rows with the exact seven-column layout.
 */
export function buildRoyaltyReportSheet(
  rows: RoyaltyExportRow[],
): (string | number)[][] {
  const sheet: (string | number)[][] = [];
  const exportedRoyaltyValues: number[] = [];

  sheet.push([...ROYALTY_REPORT_COLUMNS]);

  for (const row of rows) {
    const total = roundMoney(row.lineTotalExclVat);
    const royalty = resolveRoyaltyAmount(row);

    exportedRoyaltyValues.push(royalty);

    sheet.push([
      formatRoyaltyDate(row.date),
      row.royaltyInvoiceNumber ?? "",
      row.aggregate,
      row.quantity,
      row.unitPrice,
      total,
      royalty,
    ]);
  }

  const totalQuantity = rows.reduce(
    (sum, row) => sum + row.quantity,
    0,
  );

  const totalPrice = roundMoney(
    rows.reduce(
      (sum, row) => sum + roundMoney(row.lineTotalExclVat),
      0,
    ),
  );

  const totalRoyalty = roundMoney(
    exportedRoyaltyValues.reduce(
      (sum, royalty) => sum + royalty,
      0,
    ),
  );

  sheet.push([]);

  sheet.push([
    "TOTAL",
    "",
    "",
    totalQuantity,
    "",
    totalPrice,
    totalRoyalty,
  ]);

  return sheet;
}

/**
 * Build and download an Excel file from royalty rows.
 */
export function exportRoyaltyRowsToExcel(
  rows: RoyaltyExportRow[],
  filename: string,
): void {
  const sheet = buildRoyaltyReportSheet(rows);
  const worksheet = XLSX.utils.aoa_to_sheet(sheet);

  worksheet["!cols"] = [
    { wch: 12 },
    { wch: 20 },
    { wch: 13 },
    { wch: 14 },
    { wch: 12 },
    { wch: 13 },
    { wch: 10 },
  ];

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    "Royalty Report",
  );

  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

/**
 * Generate the royalty report filename.
 */
export function getRoyaltyFilename(
  batchNumber: number,
  isPartial: boolean,
): string {
  const padded = String(batchNumber).padStart(3, "0");

  return isPartial
    ? `HATI_PLC_Royalty_Report_Partial_${padded}`
    : `HATI_PLC_Royalty_Report_${padded}`;
}