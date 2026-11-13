
/**
 * Royalty batch tracking and Excel export.
 *
 * Report rows and batch records come from the Finance backend API.
 * Finalization is persisted in PostgreSQL.
 *
 * Partial exports do not consume the queue. Finalizing a batch associates
 * the selected report rows with a completed batch in the backend.
 *
 * Excel dates use the Ethiopian calendar exclusively.
 */

import * as XLSX from "xlsx";

import { salesInvoicesRepository } from "../sales/invoiceRepo";
import { ORDER_STATUS } from "../sales/types";
import type { SalesInvoice } from "../sales/invoice";

import {
  financeRoyaltyReportsApi,
  type FinanceRoyaltyBatch,
} from "./royaltyReport";

import { notifyFinanceChanged, subscribeFinance } from "./storage";
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

/**
 * Keep the existing page-facing batch shape.
 * The backend normalizes its stored FINAL status to FINALIZED.
 */
export interface RoyaltyBatch extends FinanceRoyaltyBatch {
  status: RoyaltyBatchStatus;
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export interface RoyaltyBatchesRepository {
  getBatches(): Promise<RoyaltyBatch[]>;
  getEligibleInvoices(): Promise<SalesInvoice[]>;
  getNextBatchNumber(): Promise<number>;
  finalizeBatch(batchKeys: string[], actor?: string): Promise<RoyaltyBatch>;
  subscribe(listener: () => void): () => void;
}

export class ApiRoyaltyBatchesRepository
  implements RoyaltyBatchesRepository
{
  /**
   * Load persisted batches from the backend.
   */
  async getBatches(): Promise<RoyaltyBatch[]> {
    const batches = await financeRoyaltyReportsApi.getBatches();

    return batches.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Return approved or payment-confirmed invoices that still have
   * unfinalized invoice rows.
   *
   * Batch membership is obtained from the backend. No batch data is read
   * from browser storage.
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
        .filter((batch) => batch.status === ROYALTY_BATCH_STATUS.FINALIZED)
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
        const hasUnfinalizedInvoiceRow = ![...finalizedKeys].some(
          (key) => key.startsWith(`${invoice.id}-`),
        );

        return hasUnfinalizedInvoiceRow;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Calculate the next display batch number from persisted backend batches.
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
   * Finalize selected report rows through the backend.
   *
   * The backend revalidates row eligibility and calculates the persisted
   * batch totals inside a database transaction. The frontend does not
   * create a local batch or calculate the authoritative batch totals.
   */
  async finalizeBatch(
    batchKeys: string[],
    _actor?: string,
  ): Promise<RoyaltyBatch> {
    const uniqueKeys = [...new Set(batchKeys)].filter(
      (key) => typeof key === "string" && key.trim().length > 0,
    );

    if (uniqueKeys.length === 0) {
      throw new Error("Select at least one royalty report row.");
    }

    if (uniqueKeys.length > ROYALTY_BATCH_SIZE) {
      throw new Error(
        `A royalty batch cannot contain more than ${ROYALTY_BATCH_SIZE} rows.`,
      );
    }

    const batch = await financeRoyaltyReportsApi.finalizeBatch(uniqueKeys);

    // Notify Finance subscribers only after backend success.
    notifyFinanceChanged();

    return batch;
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

/**
 * Exactly seven business columns.
 *
 * The screen table, Excel export, and totals row retain the existing
 * royalty report structure.
 */
export const ROYALTY_REPORT_COLUMNS = [
  "Date",
  "Royalty Invoice Number",
  "Aggregate Type",
  "Quantity (m³)",
  "Unit Price",
  "Total Price",
  "3%",
] as const;

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
}

/**
 * Calculate royalty on the VAT-exclusive amount.
 */
export function calculateRoyaltyAmount(
  lineTotalExclVat: number,
): number {
  return roundMoney(Math.max(0, lineTotalExclVat) * ROYALTY_RATE);
}

/**
 * Format a timestamp using the Ethiopian calendar.
 *
 * Examples of the resulting format:
 *   Meskerem 01, 2019
 *   Tikimt 15, 2019
 *
 * Uses Latin digits and Ethiopian month names.
 * The resulting value is exported as text, preventing Excel from
 * automatically interpreting it as a Gregorian date.
 */
function formatRoyaltyDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-ET-u-ca-ethiopic-nu-latn", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * Build worksheet rows with the exact seven-column layout.
 *
 * All dates in the worksheet are Ethiopian calendar strings.
 */
export function buildRoyaltyReportSheet(
  rows: RoyaltyExportRow[],
): (string | number)[][] {
  const sheet: (string | number)[][] = [];

  sheet.push([...ROYALTY_REPORT_COLUMNS]);

  for (const row of rows) {
    const total = roundMoney(row.lineTotalExclVat);

    sheet.push([
      formatRoyaltyDate(row.date),
      row.royaltyInvoiceNumber ?? "",
      row.aggregate,
      row.quantity,
      row.unitPrice,
      total,
      calculateRoyaltyAmount(total),
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

  // Calculate the total royalty from the rounded total sales amount.
  const totalRoyalty = calculateRoyaltyAmount(totalPrice);

  sheet.push([]);

  // Total row aligned with the seven columns:
  // Quantity, Unit Price, Total Price, 3%.
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
 *
 * The Date column is explicitly stored as text containing Ethiopian
 * calendar dates, not Excel Gregorian date serial values.
 */
export function exportRoyaltyRowsToExcel(
  rows: RoyaltyExportRow[],
  filename: string,
): void {
  const sheet = buildRoyaltyReportSheet(rows);

  const worksheet = XLSX.utils.aoa_to_sheet(sheet);

  worksheet["!cols"] = [
    { wch: 22 },
    { wch: 20 },
    { wch: 13 },
    { wch: 14 },
    { wch: 12 },
    { wch: 13 },
    { wch: 10 },
  ];

  // Force the Date column to remain text in Excel.
  // This prevents Excel from converting Ethiopian dates into Gregorian dates.
  for (let rowIndex = 1; rowIndex <= rows.length; rowIndex++) {
    const cellAddress = XLSX.utils.encode_cell({
      r: rowIndex,
      c: 0,
    });

    const cell = worksheet[cellAddress];

    if (cell) {
      cell.t = "s";
      cell.z = "@";
    }
  }

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
