import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import * as XLSX from "xlsx-js-style";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  TrendingUp,
  Banknote,
  Percent,
  Calculator,
  CalendarDays,
  Download,
  Play,
  Loader2,
  FileSpreadsheet,
  ReceiptText,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { useFinancialReports } from "@/hooks/use-finance-data";
import { formatCurrency } from "@/services/sales/format";
import { HR_API_BASE_URL } from "@/lib/api/config";
import { authRepository } from "@/services/auth/authRepository";

import {
  CHART_AXIS,
  CHART_GRID,
  CHART_HOVER,
  CHART_PIE_STROKE,
  CHART_SERIES_8,
  CHART_TICK_FILL,
  CHART_TOOLTIP_STYLE,
} from "@/lib/chartTheme";

/* ------------------------------------------------------------------ */
/* Existing chart configuration                                        */
/* ------------------------------------------------------------------ */

const PIE_COLORS = CHART_SERIES_8;
const tooltipStyle = CHART_TOOLTIP_STYLE;

const API_BASE = HR_API_BASE_URL.replace(/\/+$/, "");

const ETHIOPIAN_MONTHS = [
  "Meskerem",
  "Tikimt",
  "Hidar",
  "Tahsas",
  "Tir",
  "Yekatit",
  "Megabit",
  "Miazia",
  "Ginbot",
  "Sene",
  "Hamle",
  "Nehase",
  "Pagume",
];

const ETHIOPIAN_WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

/* ------------------------------------------------------------------ */
/* Report types                                                        */
/* ------------------------------------------------------------------ */

interface SalesReportRecord {
  id: string;
  invoice_id: string;
  invoice_number?: string | null;
  aggregate_type: string;
  quantity: number | string;
  invoice_date: string;
  status: string;
  subtotal_excl_vat: number | string;
  total_vat: number | string;
  total_price_incl_vat: number | string;
  withholding_amount: number | string;
}

interface ExpenseReportRecord {
  id: string;
  expense_number?: string | null;
  expense_date: string;
  expense_type: string;
  expense_category?: string | null;
  description: string;
  supplier_name?: string | null;
  supplier_tin?: string | null;
  amount_excl_vat: number | string;
  vat_enabled: boolean;
  vat_amount: number | string;
  wht_enabled: boolean;
  wht_amount: number | string;
  total_amount: number | string;
  total_transferred: number | string;
  status: string;
  review_status: string;
  bank?: string | null;
  payment_reference?: string | null;
  payment_party?: string | null;
  remark?: string | null;
}

interface ReportPeriod {
  start_date: string;
  end_date: string;
}

interface SalesReportData {
  period: ReportPeriod;
  records: SalesReportRecord[];
}

interface ExpenseReportData {
  period: ReportPeriod;
  records: ExpenseReportRecord[];
}

interface SummarySalesLine {
  aggregate_type: string;
  quantity: number | string;
  amount: number | string;
  amount_excl_vat: number | string;
  vat_amount: number | string;
}

interface SummaryExpenseLine {
  expense_type: string;
  amount: number | string;
  remark?: string | null;
}

interface SummaryDay {
  date: string;
  sales: SummarySalesLine[];
  expenses: SummaryExpenseLine[];
  totals: {
    sales_quantity: number | string;
    sales_amount_excl_vat: number | string;
    sales_vat: number | string;
    sales_amount: number | string;
    expense_amount: number | string;
  };
}

interface SummaryReportData {
  period: ReportPeriod;
  aggregate_types: Array<{ id: number; name: string }>;
  days: SummaryDay[];
  totals: {
    sales_quantity: number | string;
    sales_amount_excl_vat: number | string;
    sales_vat: number | string;
    sales_amount: number | string;
    expense_amount: number | string;
  };
  summary: {
    total_sales: number | string;
    vat_payable: number | string;
    gross_income: number | string;
    royalty_payable: number | string;
    expense: number | string;
    net_profit: number | string;
  };
}

interface ReportApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

/* ------------------------------------------------------------------ */
/* Ethiopian calendar helpers                                          */
/* ------------------------------------------------------------------ */

interface EthiopianDate {
  year: number;
  month: number;
  day: number;
}

function getEthiopianDate(date: Date): EthiopianDate {
  const formatter = new Intl.DateTimeFormat(
    "en-US-u-ca-ethiopic-nu-latn",
    {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      timeZone: "Africa/Addis_Ababa",
    },
  );

  const parts = formatter.formatToParts(date);

  const year = Number(
    parts.find((part) => part.type === "year")?.value,
  );

  const month = Number(
    parts.find((part) => part.type === "month")?.value,
  );

  const day = Number(
    parts.find((part) => part.type === "day")?.value,
  );

  return { year, month, day };
}

function getEthiopianDateFromISO(value: string): EthiopianDate | null {
  if (!value) return null;

  const parts = value.slice(0, 10).split("-").map(Number);

  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const date = new Date(
    Date.UTC(parts[0], parts[1] - 1, parts[2], 12),
  );

  if (Number.isNaN(date.getTime())) return null;

  return getEthiopianDate(date);
}

/**
 * Converts an Ethiopian calendar date into a Gregorian ISO date.
 *
 * Ethiopian New Year normally falls around September 11 or 12.
 * We locate the exact Ethiopian date using the Intl Ethiopic calendar.
 */
function ethiopianToGregorianISO(
  year: number,
  month: number,
  day: number,
): string {
  const approximateStart = Date.UTC(year + 7, 8, 11, 12);

  const approximateTarget =
    approximateStart + (month - 1) * 30 * 86400000 + (day - 1) * 86400000;

  for (let offset = -3; offset <= 3; offset++) {
    const candidate = new Date(
      approximateTarget + offset * 86400000,
    );

    const converted = getEthiopianDate(candidate);

    if (
      converted.year === year &&
      converted.month === month &&
      converted.day === day
    ) {
      return [
        candidate.getUTCFullYear(),
        String(candidate.getUTCMonth() + 1).padStart(2, "0"),
        String(candidate.getUTCDate()).padStart(2, "0"),
      ].join("-");
    }
  }

  throw new Error("Unable to convert the selected Ethiopian date.");
}

function formatEthiopianDate(value: string | null | undefined): string {
  if (!value) return "—";

  const ethiopianDate = getEthiopianDateFromISO(value);

  if (!ethiopianDate) return value;

  const monthName =
    ETHIOPIAN_MONTHS[ethiopianDate.month - 1] ?? "";

  return `${monthName} ${ethiopianDate.day}, ${ethiopianDate.year}`;
}

function getEthiopianToday(): EthiopianDate {
  return getEthiopianDate(new Date());
}

function getEthiopianMonthLength(
  year: number,
  month: number,
): number {
  if (month <= 12) return 30;

  const nextYearStart = ethiopianToGregorianISO(year + 1, 1, 1);
  const currentYearStart = ethiopianToGregorianISO(year, 1, 1);

  const difference =
    (new Date(`${nextYearStart}T12:00:00Z`).getTime() -
      new Date(`${currentYearStart}T12:00:00Z`).getTime()) /
    86400000;

  return difference - 360;
}

function getEthiopianMonthStartWeekday(
  year: number,
  month: number,
): number {
  const firstDay = ethiopianToGregorianISO(year, month, 1);
  const date = new Date(`${firstDay}T12:00:00Z`);

  return date.getUTCDay();
}

function getEthiopianCalendarGrid(
  year: number,
  month: number,
): Array<number | null> {
  const firstWeekday = getEthiopianMonthStartWeekday(year, month);
  const monthLength = getEthiopianMonthLength(year, month);

  const days: Array<number | null> = [];

  for (let i = 0; i < firstWeekday; i++) {
    days.push(null);
  }

  for (let day = 1; day <= monthLength; day++) {
    days.push(day);
  }

  return days;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function numericValue(
  value: number | string | null | undefined,
): number {
  const result = Number(value ?? 0);

  return Number.isFinite(result) ? result : 0;
}

function currency(
  value: number | string | null | undefined,
): string {
  return formatCurrency(numericValue(value));
}

/**
 * Returns one row for every registered aggregate for a given day.
 * Aggregates without sales are included with zero values.
 */
function buildDailyAggregateSalesRows(
  aggregateTypes: SummaryReportData["aggregate_types"],
  dailySales: SummarySalesLine[],
): SummarySalesLine[] {
  const names = (aggregateTypes ?? [])
    .map((item) => String(item.name ?? "").trim())
    .filter(Boolean);

  // Keep any aggregate found in sales data even if it is missing from the master list.
  for (const sale of dailySales ?? []) {
    const name = String(sale.aggregate_type ?? "").trim();
    if (name && !names.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      names.push(name);
    }
  }

  const grouped = new Map<
    string,
    { quantity: number; amount: number; amountExclVat: number; vat: number }
  >();

  for (const sale of dailySales ?? []) {
    const name = String(sale.aggregate_type ?? "").trim();
    if (!name) continue;

    const key = name.toLowerCase();
    const current = grouped.get(key) ?? {
      quantity: 0,
      amount: 0,
      amountExclVat: 0,
      vat: 0,
    };

    current.quantity += numericValue(sale.quantity);
    current.amount += numericValue(sale.amount);
    current.amountExclVat += numericValue(sale.amount_excl_vat);
    current.vat += numericValue(sale.vat_amount);
    grouped.set(key, current);
  }

  return names.map((name) => {
    const values = grouped.get(name.toLowerCase());
    return {
      aggregate_type: name,
      quantity: values?.quantity ?? 0,
      amount: values?.amount ?? 0,
      amount_excl_vat: values?.amountExclVat ?? 0,
      vat_amount: values?.vat ?? 0,
    };
  });
}

function getAuthToken(): string | null {
  return authRepository.getSession()?.token ?? null;
}

function normalizeStatus(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

/* ------------------------------------------------------------------ */
/* Report filtering                                                    */
/* ------------------------------------------------------------------ */

function isIncludedSale(record: SalesReportRecord): boolean {
  const status = normalizeStatus(record.status);

  return (
    status === "FINANCE_APPROVED" ||
    status === "PAYMENT_CONFIRMED"
  );
}

function isApprovedExpense(record: ExpenseReportRecord): boolean {
  const status = normalizeStatus(record.status);
  const reviewStatus = normalizeStatus(record.review_status);

  return (
    status === "APPROVED" ||
    status === "FINANCE_APPROVED" ||
    reviewStatus === "APPROVED" ||
    reviewStatus === "FINANCE_APPROVED"
  );
}

/* ------------------------------------------------------------------ */
/* Report API                                                          */
/* ------------------------------------------------------------------ */

async function fetchReport<T>(
  endpoint: "sales" | "expenses",
  startDate: string,
  endDate: string,
): Promise<T> {
  const query = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
  });

  const token = getAuthToken();

  const headers = new Headers({
    Accept: "application/json",
  });

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(
      `${API_BASE}/api/finance/reports/${endpoint}?${query.toString()}`,
      {
        method: "GET",
        headers,
      },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Network error";

    throw new Error(
      `Unable to connect to the Finance API. ${detail}`,
    );
  }

  const responseText = await response.text();

  let body: unknown;

  if (responseText.trim()) {
    try {
      body = JSON.parse(responseText);
    } catch {
      throw new Error(
        `The Finance API returned an invalid response (HTTP ${response.status}).`,
      );
    }
  }

  if (!response.ok) {
    const parsed =
      body && typeof body === "object"
        ? (body as Record<string, unknown>)
        : {};

    throw new Error(
      String(
        parsed.message ??
          `Request failed with HTTP ${response.status}.`,
      ),
    );
  }

  if (!body || typeof body !== "object") {
    throw new Error("The Finance API returned an empty response.");
  }

  const parsed = body as ReportApiResponse<T>;

  if (parsed.success !== true || !parsed.data) {
    throw new Error(
      parsed.message ?? "The report could not be retrieved.",
    );
  }

  return parsed.data;
}

async function fetchSummaryReport(
  startDate: string,
  endDate: string,
): Promise<SummaryReportData> {
  const query = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
  });

  const headers = new Headers({ Accept: "application/json" });
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(
      `${API_BASE}/api/finance/reports/summary-report?${query.toString()}`,
      { method: "GET", headers },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Network error";
    throw new Error(`Unable to connect to the Finance API. ${detail}`);
  }

  const responseText = await response.text();
  let body: unknown;
  if (responseText.trim()) {
    try {
      body = JSON.parse(responseText);
    } catch {
      throw new Error(
        `The Finance API returned an invalid response (HTTP ${response.status}).`,
      );
    }
  }

  if (!response.ok) {
    const parsed = body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
    throw new Error(String(parsed.message ?? `Request failed with HTTP ${response.status}.`));
  }

  if (!body || typeof body !== "object") {
    throw new Error("The Finance API returned an empty response.");
  }

  const parsed = body as ReportApiResponse<SummaryReportData>;
  if (parsed.success !== true || !parsed.data) {
    throw new Error(parsed.message ?? "The summary report could not be retrieved.");
  }

  if (!Array.isArray(parsed.data.days) || !parsed.data.summary) {
    throw new Error("The backend returned an invalid summary report.");
  }

  return parsed.data;
}

/* ------------------------------------------------------------------ */
/* Summary report Excel export                                         */
/* ------------------------------------------------------------------ */

function setFormulaCell(
  worksheet: XLSX.WorkSheet,
  row: number,
  col: number,
  formula: string,
): void {
  const address = XLSX.utils.encode_cell({ r: row, c: col });
  worksheet[address] = { t: "n", f: formula };
}

function enableWorkbookRecalculation(workbook: XLSX.WorkBook): void {
  const workbookProps = (workbook.Workbook ?? {}) as NonNullable<XLSX.WorkBook["Workbook"]> & {
    CalcPr: {
      calcMode: "auto";
      fullCalcOnLoad: true;
      forceFullCalc: true;
    };
  };
  workbookProps.CalcPr = {
    calcMode: "auto",
    fullCalcOnLoad: true,
    forceFullCalc: true,
  };
  workbook.Workbook = workbookProps;
}

function exportSummaryReportToExcel(
  report: SummaryReportData,
  startDate: string,
  endDate: string,
): void {
  const rows: unknown[][] = [
    ["Day", "Sales", "", "", "Expense", "", ""],
    ["", "Aggregate Type", "Qty m³", "Amount", "Expense Item", "Amount", "Remark"],
  ];

  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [
    { s: { r: 0, c: 1 }, e: { r: 0, c: 3 } },
    { s: { r: 0, c: 4 }, e: { r: 0, c: 6 } },
  ];
  const dailyTotalRows: number[] = [];
  const formulaCells: Array<{ row: number; col: number; formula: string }> = [];
  const dailyDataRanges: Array<{ start: number; end: number }> = [];

  for (const day of report.days) {
    const sales = buildDailyAggregateSalesRows(
      report.aggregate_types,
      day.sales ?? [],
    );
    const expenses = [...(day.expenses ?? [])];
    // Keep each day's Sum on its own final row. This prevents an empty
    // expense list from placing "Sum" beside the first sales order.
    const dataRows = Math.max(sales.length, expenses.length);
    const groupRows = dataRows + 1;
    const firstRow = rows.length;

    for (let i = 0; i < groupRows; i++) {
      const isDailyTotal = i === dataRows;
      const sale = sales[i];
      const expense = expenses[i];

      rows.push([
        i === 0 ? formatEthiopianDate(day.date) : "",
        isDailyTotal ? "Sum" : sale?.aggregate_type ?? "",
        isDailyTotal ? "" : sale ? numericValue(sale.quantity) : 0,
        isDailyTotal ? "" : sale ? numericValue(sale.amount) : 0,
        isDailyTotal ? "Sum" : expense?.expense_type ?? "",
        isDailyTotal ? "" : expense ? numericValue(expense.amount) : 0,
        isDailyTotal ? "" : expense?.remark ?? "",
      ]);

      if (isDailyTotal) {
        const totalRow = rows.length - 1;
        const firstDataRow = firstRow;
        const lastDataRow = totalRow - 1;
        if (lastDataRow >= firstDataRow) {
          formulaCells.push({ row: totalRow, col: 2, formula: `SUM(C${firstDataRow + 1}:C${lastDataRow + 1})` });
          formulaCells.push({ row: totalRow, col: 3, formula: `SUM(D${firstDataRow + 1}:D${lastDataRow + 1})` });
          formulaCells.push({ row: totalRow, col: 5, formula: `SUM(F${firstDataRow + 1}:F${lastDataRow + 1})` });
        } else {
          rows[totalRow][2] = 0;
          rows[totalRow][3] = 0;
          rows[totalRow][5] = 0;
        }
        dailyTotalRows.push(totalRow);
      }
    }

    const lastRow = rows.length - 1;
    dailyDataRanges.push({ start: firstRow, end: lastRow });
    if (lastRow > firstRow) {
      merges.push({ s: { r: firstRow, c: 0 }, e: { r: lastRow, c: 0 } });
    }
  }

  const totalRowIndex = rows.length;
  rows.push([
    "Total",
    "",
    "",
    "",
    "",
    "",
    "",
  ]);

  rows.push([]);
  const summaryTitleRow = rows.length;
  rows.push(["", "", "Summary", "Amount", "", "", ""]);
  const summaryStartRow = rows.length;
  rows.push(["", "", "Total Sales", "", "", "", ""]);
  rows.push(["", "", "VAT (payable)", numericValue(report.summary.vat_payable), "", "", ""]);
  rows.push(["", "", "Gross Income", "", "", "", ""]);
  rows.push(["", "", "Royalty (payable)", numericValue(report.summary.royalty_payable), "", "", ""]);
  rows.push(["", "", "Expense", "", "", "", ""]);
  const netProfitRow = rows.length;
  rows.push(["", "", "Net Profit", "", "", "", ""]);

  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  // Daily Sum formulas, period totals, and linked financial summary formulas.
  for (const item of formulaCells) {
    setFormulaCell(worksheet, item.row, item.col, item.formula);
  }

  const dailyTotalExcelRows = dailyTotalRows.map((row) => row + 1);
  if (dailyTotalExcelRows.length) {
    setFormulaCell(worksheet, totalRowIndex, 2, `SUM(${dailyTotalExcelRows.map((row) => `C${row}`).join(",")})`);
    setFormulaCell(worksheet, totalRowIndex, 3, `SUM(${dailyTotalExcelRows.map((row) => `D${row}`).join(",")})`);
    setFormulaCell(worksheet, totalRowIndex, 5, `SUM(${dailyTotalExcelRows.map((row) => `F${row}`).join(",")})`);
  }

  const totalSalesExcelRow = summaryStartRow + 1;
  const vatExcelRow = summaryStartRow + 2;
  const grossIncomeExcelRow = summaryStartRow + 3;
  const royaltyExcelRow = summaryStartRow + 4;
  const expenseExcelRow = summaryStartRow + 5;
  setFormulaCell(worksheet, summaryStartRow, 3, `D${totalRowIndex + 1}`);
  setFormulaCell(worksheet, summaryStartRow + 2, 3, `D${totalSalesExcelRow}-D${vatExcelRow}`);
  setFormulaCell(worksheet, summaryStartRow + 4, 3, `F${totalRowIndex + 1}`);
  setFormulaCell(worksheet, netProfitRow, 3, `D${grossIncomeExcelRow}-D${royaltyExcelRow}-D${expenseExcelRow}`);

  merges.push({ s: { r: summaryTitleRow, c: 2 }, e: { r: summaryTitleRow, c: 3 } });
  worksheet["!merges"] = merges;
  worksheet["!cols"] = [
    { wch: 22 },
    { wch: 25 },
    { wch: 14 },
    { wch: 19 },
    { wch: 24 },
    { wch: 19 },
    { wch: 34 },
  ];
  worksheet["!rows"] = rows.map((_, index) => ({
    hpt: index === 0 ? 27 : index === 1 ? 24 : index === summaryTitleRow ? 27 : 21,
  }));
  worksheet["!autofilter"] = { ref: `A2:G${Math.max(totalRowIndex, 2)}` };
  worksheet["!freeze"] = { xSplit: 1, ySplit: 2, topLeftCell: "B3", activePane: "bottomRight", state: "frozen" };
  worksheet["!pageSetup"] = { orientation: "landscape", fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  worksheet["!margins"] = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };

  const border = {
    top: { style: "thin", color: { rgb: "D7DEE8" } },
    bottom: { style: "thin", color: { rgb: "D7DEE8" } },
    left: { style: "thin", color: { rgb: "D7DEE8" } },
    right: { style: "thin", color: { rgb: "D7DEE8" } },
  };
  const baseFont = { name: "Aptos", sz: 10, color: { rgb: "263445" } };
  const headerStyle = {
    font: { name: "Aptos Display", sz: 14, bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "17365D" } },
    alignment: { horizontal: "center", vertical: "center" },
    border,
  };
  const subHeaderStyle = {
    font: { name: "Aptos", sz: 10, bold: true, color: { rgb: "17365D" } },
    fill: { patternType: "solid", fgColor: { rgb: "DCE6F1" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border,
  };
  const dataRowStyle = {
    font: baseFont,
    fill: { patternType: "solid", fgColor: { rgb: "DDEBF7" } },
    alignment: { vertical: "center" },
    border,
  };
  const sumStyle = {
    font: { name: "Aptos", sz: 10, bold: true, color: { rgb: "9C0006" } },
    fill: { patternType: "solid", fgColor: { rgb: "F4CCCC" } },
    alignment: { vertical: "center" },
    border,
  };
  const totalStyle = {
    font: { name: "Aptos", sz: 11, bold: true, color: { rgb: "9C0006" } },
    fill: { patternType: "solid", fgColor: { rgb: "F4CCCC" } },
    alignment: { vertical: "center" },
    border,
  };
  const summaryHeaderStyle = {
    font: { name: "Aptos Display", sz: 14, bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "17365D" } },
    alignment: { horizontal: "center", vertical: "center" },
    border,
  };
  const summaryStyle = {
    font: { name: "Aptos", sz: 11, color: { rgb: "263445" } },
    fill: { patternType: "solid", fgColor: { rgb: "DDEBF7" } },
    alignment: { vertical: "center" },
    border,
  };
  const netProfitStyle = {
    font: { name: "Aptos", sz: 12, bold: true, color: { rgb: "9C0006" } },
    fill: { patternType: "solid", fgColor: { rgb: "F4CCCC" } },
    alignment: { vertical: "center" },
    border,
  };

  const setCellStyle = (row: number, col: number, style: Record<string, unknown>) => {
    const address = XLSX.utils.encode_cell({ r: row, c: col });
    const cell = worksheet[address] ?? { t: "s", v: "" };
    worksheet[address] = cell;
    cell.s = style;
  };

  // Every daily data row uses light blue, including otherwise empty cells.
  for (let r = 2; r <= totalRowIndex; r++) {
    for (let c = 0; c < 7; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[address] ?? { t: "s", v: "" };
      worksheet[address] = cell;
      cell.s = {
        ...dataRowStyle,
        alignment: { vertical: "center", wrapText: c === 6 },
      };
      if ([2, 3, 5].includes(c) && typeof cell.v === "number") {
        cell.z = '#,##0.00;[Red](#,##0.00);–';
        cell.s = { ...cell.s, alignment: { horizontal: "right", vertical: "center" } };
      }
      if (c === 2 && typeof cell.v === "number") cell.z = '#,##0.000;[Red](#,##0.000);–';
    }
  }

  // Main grouped headers and column labels.
  for (let c = 0; c < 7; c++) {
    setCellStyle(0, c, headerStyle);
    setCellStyle(1, c, subHeaderStyle);
  }
  setCellStyle(0, 0, { ...headerStyle, font: { ...headerStyle.font, sz: 11 } });

  // Date cells and daily Sum rows.
  for (const range of dailyDataRanges) {
    setCellStyle(range.start, 0, {
      ...dataRowStyle,
      font: { name: "Aptos", sz: 10, bold: true, color: { rgb: "17365D" } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
    });
  }
  for (const r of dailyTotalRows) {
    for (let c = 0; c < 7; c++) setCellStyle(r, c, sumStyle);
    for (const c of [2, 3, 5]) {
      const address = XLSX.utils.encode_cell({ r, c });
      if (worksheet[address]) {
        worksheet[address].z = c === 2
          ? '#,##0.000;[Red](#,##0.000);–'
          : '#,##0.00;[Red](#,##0.00);–';
      }
    }
  }

  // Period total row.
  for (let c = 0; c < 7; c++) setCellStyle(totalRowIndex, c, totalStyle);
  for (const c of [2, 3, 5]) {
    const address = XLSX.utils.encode_cell({ r: totalRowIndex, c });
    if (worksheet[address]) worksheet[address].z = c === 2 ? '#,##0.000;[Red](#,##0.000);–' : '#,##0.00;[Red](#,##0.00);–';
  }

  // Financial summary section, positioned in columns C:D like the reference.
  setCellStyle(summaryTitleRow, 2, summaryHeaderStyle);
  setCellStyle(summaryTitleRow, 3, summaryHeaderStyle);
  for (let r = summaryStartRow; r <= netProfitRow; r++) {
    setCellStyle(r, 2, summaryStyle);
    setCellStyle(r, 3, summaryStyle);
    const amountCell = worksheet[XLSX.utils.encode_cell({ r, c: 3 })];
    if (amountCell) {
      amountCell.z = '#,##0.00;[Red](#,##0.00);–';
      amountCell.s = { ...amountCell.s, alignment: { horizontal: "right", vertical: "center" } };
    }
  }
  setCellStyle(netProfitRow, 2, netProfitStyle);
  setCellStyle(netProfitRow, 3, netProfitStyle);
  const netAmountCell = worksheet[XLSX.utils.encode_cell({ r: netProfitRow, c: 3 })];
  if (netAmountCell) netAmountCell.z = '#,##0.00;[Red](#,##0.00);–';

  const workbook = XLSX.utils.book_new();
  enableWorkbookRecalculation(workbook);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Summary Report");
  XLSX.writeFile(
    workbook,
    `Finance_Summary_${startDate}_to_${endDate}.xlsx`,
  );
}

/* ------------------------------------------------------------------ */
/* Excel export helpers                                                */
/* ------------------------------------------------------------------ */

function exportSalesToExcel(
  records: SalesReportRecord[],
  startDate: string,
  endDate: string,
): void {
  const headers = [
    "Date",
    "Aggregate Type",
    "Quantity (m³)",
    "Subtotal Excl. VAT",
    "VAT",
    "Total Sales",
    "WHT",
  ];

  const rows: unknown[][] = [
    ["ETHIOPIAN CALENDAR REPORT PERIOD", `${formatEthiopianDate(startDate)} to ${formatEthiopianDate(endDate)}`],
    [],
    headers,
    ...records.map((record) => [
      formatEthiopianDate(record.invoice_date),
      record.aggregate_type,
      numericValue(record.quantity),
      numericValue(record.subtotal_excl_vat),
      numericValue(record.total_vat),
      numericValue(record.total_price_incl_vat),
      numericValue(record.withholding_amount),
    ]),
    [],
    [
      "REPORT TOTAL",
      "",
      records.reduce((sum, record) => sum + numericValue(record.quantity), 0),
      records.reduce((sum, record) => sum + numericValue(record.subtotal_excl_vat), 0),
      records.reduce((sum, record) => sum + numericValue(record.total_vat), 0),
      records.reduce((sum, record) => sum + numericValue(record.total_price_incl_vat), 0),
      records.reduce((sum, record) => sum + numericValue(record.withholding_amount), 0),
    ],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 22 }, { wch: 24 }, { wch: 16 }, { wch: 22 },
    { wch: 16 }, { wch: 20 }, { wch: 18 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sales Report");
  XLSX.writeFile(workbook, `Sales_Report_${startDate}_to_${endDate}.xlsx`);
}

function exportExpensesToExcel(
  records: ExpenseReportRecord[],
  startDate: string,
  endDate: string,
): void {
  const rows: unknown[][] = [
    ["ETHIOPIAN CALENDAR REPORT PERIOD", `${formatEthiopianDate(startDate)} to ${formatEthiopianDate(endDate)}`],
    [],
    ["Date", "Expense Type", "Remark", "Amount Excl. VAT", "VAT", "WHT", "Total Expenses"],
    ...records.map((record) => [
      formatEthiopianDate(record.expense_date),
      record.expense_type,
      record.remark || "",
      numericValue(record.amount_excl_vat),
      numericValue(record.vat_amount),
      numericValue(record.wht_amount),
      numericValue(record.total_amount),
    ]),
    [],
    [
      "REPORT TOTAL", "", "",
      records.reduce((sum, record) => sum + numericValue(record.amount_excl_vat), 0),
      records.reduce((sum, record) => sum + numericValue(record.vat_amount), 0),
      records.reduce((sum, record) => sum + numericValue(record.wht_amount), 0),
      records.reduce((sum, record) => sum + numericValue(record.total_amount), 0),
    ],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 22 }, { wch: 24 }, { wch: 34 }, { wch: 20 },
    { wch: 16 }, { wch: 16 }, { wch: 20 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Expenses Report");
  XLSX.writeFile(workbook, `Expenses_Report_${startDate}_to_${endDate}.xlsx`);
}

/* ------------------------------------------------------------------ */
/* Ethiopian calendar input                                           */
/* ------------------------------------------------------------------ */

function EthiopianDatePicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const selectedDate = getEthiopianDateFromISO(value);
  const today = getEthiopianToday();

  const [isOpen, setIsOpen] = useState(false);

  const [calendarYear, setCalendarYear] = useState(
    selectedDate?.year ?? today.year,
  );

  const [calendarMonth, setCalendarMonth] = useState(
    selectedDate?.month ?? today.month,
  );

  useEffect(() => {
    if (selectedDate) {
      setCalendarYear(selectedDate.year);
      setCalendarMonth(selectedDate.month);
    }
  }, [value]);

  const calendarDays = useMemo(
    () => getEthiopianCalendarGrid(calendarYear, calendarMonth),
    [calendarYear, calendarMonth],
  );

  function goToPreviousMonth() {
    if (calendarMonth === 1) {
      setCalendarMonth(13);
      setCalendarYear((year) => year - 1);
    } else {
      setCalendarMonth((month) => month - 1);
    }
  }

  function goToNextMonth() {
    if (calendarMonth === 13) {
      setCalendarMonth(1);
      setCalendarYear((year) => year + 1);
    } else {
      setCalendarMonth((month) => month + 1);
    }
  }

  function selectDay(day: number) {
    const gregorianDate = ethiopianToGregorianISO(
      calendarYear,
      calendarMonth,
      day,
    );

    onChange(gregorianDate);
    setIsOpen(false);
  }

  return (
    <div className="relative min-w-0">
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </label>

      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm text-foreground outline-none transition-colors hover:bg-accent focus:ring-2 focus:ring-ring"
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />

        <span className="truncate">
          {selectedDate
            ? `${ETHIOPIAN_MONTHS[selectedDate.month - 1]} ${selectedDate.day}, ${selectedDate.year}`
            : "Select Ethiopian date"}
        </span>
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            aria-label="Close calendar"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setIsOpen(false)}
          />

          <div className="absolute left-0 top-full z-50 mt-2 w-[min(320px,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={goToPreviousMonth}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Previous month"
              >
                <ChevronLeft className="size-4" />
              </button>

              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">
                  {ETHIOPIAN_MONTHS[calendarMonth - 1]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {calendarYear}
                </p>
              </div>

              <button
                type="button"
                onClick={goToNextMonth}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Next month"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {ETHIOPIAN_WEEKDAYS.map((weekday) => (
                <div
                  key={weekday}
                  className="flex h-8 items-center justify-center text-[10px] font-medium text-muted-foreground"
                >
                  {weekday}
                </div>
              ))}

              {calendarDays.map((day, index) => {
                if (day === null) {
                  return (
                    <div
                      key={`empty-${index}`}
                      className="h-9"
                    />
                  );
                }

                const isSelected =
                  selectedDate?.year === calendarYear &&
                  selectedDate?.month === calendarMonth &&
                  selectedDate?.day === day;

                const isToday =
                  today.year === calendarYear &&
                  today.month === calendarMonth &&
                  today.day === day;

                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => selectDay(day)}
                    className={[
                      "flex h-9 items-center justify-center rounded-md text-sm transition-colors",
                      isSelected
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "text-foreground hover:bg-accent",
                      isToday && !isSelected
                        ? "border border-primary text-primary"
                        : "",
                    ].join(" ")}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex justify-between border-t border-border pt-2">
              <button
                type="button"
                onClick={() => {
                  setCalendarYear(today.year);
                  setCalendarMonth(today.month);
                }}
                className="text-xs font-medium text-primary hover:underline"
              >
                Today
              </button>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reusable report components                                           */
/* ------------------------------------------------------------------ */

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-sidebar p-3">
      <p className="text-[11px] font-medium text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function ReportError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function ExportButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Download className="size-3.5" />
      Export Excel
    </button>
  );
}

function ProcessButton({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Play className="size-4" />
      )}
      {loading ? "Processing..." : "Process"}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Main page                                                           */
/* ------------------------------------------------------------------ */

export default function FinancialReports() {
  const today = getEthiopianToday();
  const [dashboardYear, setDashboardYear] = useState(today.year);
  // Open the dashboard on the current Ethiopian month. Selecting All Months
  // explicitly changes this value to null.
  const [dashboardMonth, setDashboardMonth] = useState<number | null>(today.month);
  const { data: reports } = useFinancialReports(dashboardYear, dashboardMonth);

  // Keep a full-year series available for the chart. The KPI cards and other
  // dashboard totals continue to use the selected month above.
  const { data: previousYearChartReports } = useFinancialReports(dashboardYear - 1, null);
  const { data: currentYearChartReports } = useFinancialReports(dashboardYear, null);
  const { data: nextYearChartReports } = useFinancialReports(dashboardYear + 1, null);

  const monthlyChartData = useMemo(() => {
    const getMonthValue = (year: number, month: number): number => {
      const yearReports =
        year === dashboardYear - 1
          ? previousYearChartReports
          : year === dashboardYear + 1
            ? nextYearChartReports
            : currentYearChartReports;
      return Number(yearReports?.byMonth?.[month - 1]?.value ?? 0);
    };

    if (dashboardMonth === null) {
      return ETHIOPIAN_MONTHS.map((name, index) => ({
        name,
        value: getMonthValue(dashboardYear, index + 1),
      }));
    }

    const previous =
      dashboardMonth === 1
        ? { year: dashboardYear - 1, month: 13 }
        : { year: dashboardYear, month: dashboardMonth - 1 };
    const next =
      dashboardMonth === 13
        ? { year: dashboardYear + 1, month: 1 }
        : { year: dashboardYear, month: dashboardMonth + 1 };

    return [previous, { year: dashboardYear, month: dashboardMonth }, next].map(
      ({ year, month }) => ({
        name: ETHIOPIAN_MONTHS[month - 1],
        value: getMonthValue(year, month),
      }),
    );
  }, [
    dashboardYear,
    dashboardMonth,
    previousYearChartReports,
    currentYearChartReports,
    nextYearChartReports,
  ]);

  /* -------------------------------------------------------------- */
  /* Independent sales report state                                  */
  /* -------------------------------------------------------------- */

  const currentMonthStart = ethiopianToGregorianISO(
    today.year,
    today.month,
    1,
  );
  const currentDay = ethiopianToGregorianISO(
    today.year,
    today.month,
    today.day,
  );

  const [salesStartDate, setSalesStartDate] =
    useState(currentMonthStart);

  const [salesEndDate, setSalesEndDate] =
    useState(currentDay);

  const [salesReport, setSalesReport] =
    useState<SalesReportData | null>(null);

  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState("");

  /* -------------------------------------------------------------- */
  /* Independent expense report state                                */
  /* -------------------------------------------------------------- */

  const [expenseStartDate, setExpenseStartDate] =
    useState(currentMonthStart);

  const [expenseEndDate, setExpenseEndDate] =
    useState(currentDay);

  const [expenseReport, setExpenseReport] =
    useState<ExpenseReportData | null>(null);

  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseError, setExpenseError] = useState("");

  /* -------------------------------------------------------------- */
  /* Independent daily summary report state                          */
  /* -------------------------------------------------------------- */

  const [summaryStartDate, setSummaryStartDate] = useState(currentMonthStart);
  const [summaryEndDate, setSummaryEndDate] = useState(currentDay);
  const [summaryReport, setSummaryReport] = useState<SummaryReportData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  /* -------------------------------------------------------------- */
  /* Filtered sales and expense records                              */
  /* -------------------------------------------------------------- */

  const approvedSales = useMemo(
    () =>
      salesReport
        ? salesReport.records.filter(isIncludedSale)
        : [],
    [salesReport],
  );

  const approvedExpenses = useMemo(
    () =>
      expenseReport
        ? expenseReport.records.filter(isApprovedExpense)
        : [],
    [expenseReport],
  );

  /* -------------------------------------------------------------- */
  /* Sales summary                                                   */
  /* -------------------------------------------------------------- */

  const salesSummary = useMemo(() => {
    return approvedSales.reduce(
      (summary, record) => ({
        record_count: summary.record_count + 1,
        quantity: summary.quantity + numericValue(record.quantity),
        subtotal_excl_vat:
          summary.subtotal_excl_vat +
          numericValue(record.subtotal_excl_vat),
        total_vat:
          summary.total_vat + numericValue(record.total_vat),
        total_price_incl_vat:
          summary.total_price_incl_vat +
          numericValue(record.total_price_incl_vat),
        withholding_amount:
          summary.withholding_amount +
          numericValue(record.withholding_amount),
      }),
      {
        record_count: 0,
        quantity: 0,
        subtotal_excl_vat: 0,
        total_vat: 0,
        total_price_incl_vat: 0,
        withholding_amount: 0,
      },
    );
  }, [approvedSales]);

  /* -------------------------------------------------------------- */
  /* Expense summary                                                 */
  /* -------------------------------------------------------------- */

  const expenseSummary = useMemo(() => {
    return approvedExpenses.reduce(
      (summary, record) => ({
        record_count: summary.record_count + 1,
        amount_excl_vat:
          summary.amount_excl_vat +
          numericValue(record.amount_excl_vat),
        vat_amount:
          summary.vat_amount + numericValue(record.vat_amount),
        wht_amount:
          summary.wht_amount + numericValue(record.wht_amount),
        total_amount:
          summary.total_amount + numericValue(record.total_amount),
        total_transferred:
          summary.total_transferred +
          numericValue(record.total_transferred),
      }),
      {
        record_count: 0,
        amount_excl_vat: 0,
        vat_amount: 0,
        wht_amount: 0,
        total_amount: 0,
        total_transferred: 0,
      },
    );
  }, [approvedExpenses]);

  /* -------------------------------------------------------------- */
  /* Process sales report                                            */
  /* -------------------------------------------------------------- */

  async function processSalesReport() {
    if (!salesStartDate || !salesEndDate) {
      setSalesError("Please select both Ethiopian dates.");
      return;
    }

    if (salesStartDate > salesEndDate) {
      setSalesError("The start date cannot be later than the end date.");
      return;
    }

    setSalesLoading(true);
    setSalesError("");

    try {
      const result = await fetchReport<SalesReportData>(
        "sales",
        salesStartDate,
        salesEndDate,
      );

      if (!Array.isArray(result.records)) {
        throw new Error("The backend returned an invalid sales report.");
      }

      setSalesReport(result);
    } catch (error) {
      setSalesReport(null);

      setSalesError(
        error instanceof Error
          ? error.message
          : "Unable to process the sales report.",
      );
    } finally {
      setSalesLoading(false);
    }
  }

  /* -------------------------------------------------------------- */
  /* Process expenses report                                         */
  /* -------------------------------------------------------------- */

  async function processExpenseReport() {
    if (!expenseStartDate || !expenseEndDate) {
      setExpenseError("Please select both Ethiopian dates.");
      return;
    }

    if (expenseStartDate > expenseEndDate) {
      setExpenseError("The start date cannot be later than the end date.");
      return;
    }

    setExpenseLoading(true);
    setExpenseError("");

    try {
      const result = await fetchReport<ExpenseReportData>(
        "expenses",
        expenseStartDate,
        expenseEndDate,
      );

      if (!Array.isArray(result.records)) {
        throw new Error("The backend returned an invalid expenses report.");
      }

      setExpenseReport(result);
    } catch (error) {
      setExpenseReport(null);

      setExpenseError(
        error instanceof Error
          ? error.message
          : "Unable to process the expenses report.",
      );
    } finally {
      setExpenseLoading(false);
    }
  }

  /* -------------------------------------------------------------- */
  /* Process daily summary report                                    */
  /* -------------------------------------------------------------- */

  async function processSummaryReport() {
    if (!summaryStartDate || !summaryEndDate) {
      setSummaryError("Please select both Ethiopian dates.");
      return;
    }

    if (summaryStartDate > summaryEndDate) {
      setSummaryError("The start date cannot be later than the end date.");
      return;
    }

    setSummaryLoading(true);
    setSummaryError("");

    try {
      const [summaryResult, salesResult] = await Promise.all([
        fetchSummaryReport(summaryStartDate, summaryEndDate),
        fetchReport<SalesReportData>("sales", summaryStartDate, summaryEndDate),
      ]);

      if (!Array.isArray(salesResult.records)) {
        throw new Error("The backend returned an invalid sales report.");
      }

      const daysByDate = new Map<string, SummaryDay>();

      for (const sourceDay of summaryResult.days ?? []) {
        const dateKey = String(sourceDay.date ?? "").slice(0, 10);
        if (!dateKey) continue;

        daysByDate.set(dateKey, {
          ...sourceDay,
          date: dateKey,
          sales: [],
          expenses: Array.isArray(sourceDay.expenses) ? [...sourceDay.expenses] : [],
          totals: {
            sales_quantity: numericValue(sourceDay.totals?.sales_quantity),
            sales_amount_excl_vat: numericValue(sourceDay.totals?.sales_amount_excl_vat),
            sales_vat: numericValue(sourceDay.totals?.sales_vat),
            sales_amount: numericValue(sourceDay.totals?.sales_amount),
            expense_amount: numericValue(sourceDay.totals?.expense_amount),
          },
        });
      }

      for (const record of salesResult.records.filter(isIncludedSale)) {
        const dateKey = String(record.invoice_date ?? "").slice(0, 10);
        if (!dateKey) continue;

        let day = daysByDate.get(dateKey);
        if (!day) {
          day = {
            date: dateKey,
            sales: [],
            expenses: [],
            totals: {
              sales_quantity: 0,
              sales_amount_excl_vat: 0,
              sales_vat: 0,
              sales_amount: 0,
              expense_amount: 0,
            },
          };
          daysByDate.set(dateKey, day);
        }

        day.sales.push({
          aggregate_type: record.aggregate_type,
          quantity: record.quantity,
          amount: record.total_price_incl_vat,
          amount_excl_vat: record.subtotal_excl_vat,
          vat_amount: record.total_vat,
        });
      }

      const mergedDays: SummaryDay[] = Array.from(daysByDate.values())
        .map((day): SummaryDay => {
          const salesQuantity = day.sales.reduce((sum, sale) => sum + numericValue(sale.quantity), 0);
          const salesExclVat = day.sales.reduce((sum, sale) => sum + numericValue(sale.amount_excl_vat), 0);
          const salesVat = day.sales.reduce((sum, sale) => sum + numericValue(sale.vat_amount), 0);
          const salesAmount = day.sales.reduce((sum, sale) => sum + numericValue(sale.amount), 0);
          const expenseAmount = day.expenses.reduce((sum, expense) => sum + numericValue(expense.amount), 0);

          return {
            ...day,
            totals: {
              sales_quantity: salesQuantity,
              sales_amount_excl_vat: salesExclVat,
              sales_vat: salesVat,
              sales_amount: salesAmount,
              expense_amount: expenseAmount,
            },
          };
        })
        .sort((a, b) => a.date.localeCompare(b.date));

      const totals = mergedDays.reduce(
        (acc, day) => ({
          sales_quantity: acc.sales_quantity + numericValue(day.totals.sales_quantity),
          sales_amount_excl_vat: acc.sales_amount_excl_vat + numericValue(day.totals.sales_amount_excl_vat),
          sales_vat: acc.sales_vat + numericValue(day.totals.sales_vat),
          sales_amount: acc.sales_amount + numericValue(day.totals.sales_amount),
          expense_amount: acc.expense_amount + numericValue(day.totals.expense_amount),
        }),
        { sales_quantity: 0, sales_amount_excl_vat: 0, sales_vat: 0, sales_amount: 0, expense_amount: 0 },
      );

      const royaltyPayable = numericValue(summaryResult.summary.royalty_payable);
      const grossIncome = totals.sales_amount_excl_vat;
      const netProfit = grossIncome - royaltyPayable - totals.expense_amount;

      const mergedReport: SummaryReportData = {
        ...summaryResult,
        days: mergedDays,
        totals,
        summary: {
          ...summaryResult.summary,
          total_sales: totals.sales_amount,
          vat_payable: totals.sales_vat,
          gross_income: grossIncome,
          expense: totals.expense_amount,
          net_profit: netProfit,
        },
      };

      setSummaryReport(mergedReport);
    } catch (error) {
      setSummaryReport(null);
      setSummaryError(
        error instanceof Error ? error.message : "Unable to process the daily summary report.",
      );
    } finally {
      setSummaryLoading(false);
    }
  }

  /* -------------------------------------------------------------- */
  /* Existing KPIs                                                   */
  /* -------------------------------------------------------------- */

  const kpis = [
    {
      label: "Total Sales",
      value: reports ? formatCurrency(reports.totals.totalSales) : "—",
      icon: Banknote,
      color: "text-info",
    },
    {
      label: "VAT",
      value: reports ? formatCurrency(reports.totals.vat) : "—",
      icon: Percent,
      color: "text-warning",
    },
    {
      label: "Gross Income",
      value: reports ? formatCurrency(reports.totals.grossIncome) : "—",
      icon: TrendingUp,
      color: "text-success",
    },
    {
      label: "Royalty",
      value: reports ? formatCurrency(reports.totals.royalty) : "—",
      icon: Calculator,
      color: "text-violet",
    },
  ];

  /* -------------------------------------------------------------- */
  /* Page                                                            */
  /* -------------------------------------------------------------- */

  return (
    <div className="space-y-6">
      {/* Page Header */}

      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Financial Reports
        </h1>
      </div>

      {/* Dashboard reporting period filters. These stop before Sales Orders Report. */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[150px] space-y-1.5">
            <label htmlFor="dashboard-ethiopian-year" className="text-xs font-medium text-muted-foreground">
              Ethiopian Year
            </label>
            <select
              id="dashboard-ethiopian-year"
              value={dashboardYear}
              onChange={(event) => setDashboardYear(Number(event.target.value))}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              {Array.from({ length: 21 }, (_, index) => today.year - index).map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[170px] space-y-1.5">
            <label htmlFor="dashboard-ethiopian-month" className="text-xs font-medium text-muted-foreground">
              Ethiopian Month
            </label>
            <select
              id="dashboard-ethiopian-month"
              value={dashboardMonth ?? "all"}
              onChange={(event) => setDashboardMonth(event.target.value === "all" ? null : Number(event.target.value))}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All Months</option>
              {ETHIOPIAN_MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>{month}</option>
              ))}
            </select>
          </div>
          <p className="pb-2 text-xs text-muted-foreground">
            Dashboard statistics and charts only. Sales Orders Report uses its own date range.
          </p>
        </CardContent>
      </Card>

      {/* Existing Totals */}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="border-border bg-card shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {kpi.label}
                </span>
                <kpi.icon className={`size-4 ${kpi.color}`} />
              </div>
              <div className="mt-2 text-lg font-semibold tabular-nums text-foreground">
                {kpi.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Revenue by Date + Aggregate */}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              Revenue by Date
            </CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyChartData.some((month) => month.value > 0) ? (
              <ResponsiveContainer width="100%" height={270}>
                <BarChart
                  data={monthlyChartData}
                  margin={{ top: 8, right: 8, left: 0, bottom: dashboardMonth === null ? 28 : 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis
                    dataKey="name"
                    orientation="bottom"
                    interval={0}
                    minTickGap={0}
                    height={dashboardMonth === null ? 62 : 36}
                    tickMargin={10}
                    angle={dashboardMonth === null ? -35 : 0}
                    textAnchor={dashboardMonth === null ? "end" : "middle"}
                    tick={{ fontSize: dashboardMonth === null ? 10 : 11, fill: CHART_TICK_FILL }}
                    axisLine={{ stroke: CHART_AXIS }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: CHART_TICK_FILL }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      v >= 1000000
                        ? `${(v / 1000000).toFixed(1)}M`
                        : v >= 1000
                          ? `${(v / 1000).toFixed(0)}K`
                          : v
                    }
                  />
                  <Tooltip
                    cursor={{ fill: CHART_HOVER }}
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={tooltipStyle}
                  />
                  <Bar
                    dataKey="value"
                    fill={PIE_COLORS[0]}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground/70">
                No revenue data yet
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              Revenue by Aggregate
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reports?.byAggregate && reports.byAggregate.length > 0 ? (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="50%" height={220}>
                  <PieChart>
                    <Pie
                      data={reports.byAggregate}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      nameKey="name"
                      stroke={CHART_PIE_STROKE}
                    >
                      {reports.byAggregate.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      contentStyle={tooltipStyle}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {reports.byAggregate.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-2">
                      <div
                        className="size-2.5 rounded-sm"
                        style={{
                          backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                        }}
                      />
                      <span className="font-mono text-xs text-muted-foreground">
                        {item.name}
                      </span>
                      <span className="ml-auto text-xs font-medium tabular-nums text-foreground">
                        {formatCurrency(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground/70">
                No aggregate data yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue by Bank + Customer */}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Revenue by Bank
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reports?.byBank && reports.byBank.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                      <th className="pb-2 font-medium">Bank</th>
                      <th className="pb-2 text-right font-medium">Revenue</th>
                      <th className="pb-2 text-right font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.byBank.map((item) => {
                      const share =
                        reports.totals.totalSales > 0
                          ? Math.round(
                              (item.value / reports.totals.totalSales) * 100,
                            )
                          : 0;

                      return (
                        <tr
                          key={item.name}
                          className="border-b border-border last:border-0"
                        >
                          <td className="py-2.5 text-foreground">
                            {item.name}
                          </td>
                          <td className="py-2.5 text-right font-medium tabular-nums text-foreground">
                            {formatCurrency(item.value)}
                          </td>
                          <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                            {share}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground/70">
                No bank data yet
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Revenue by Customer
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reports?.byCustomer && reports.byCustomer.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                      <th className="pb-2 font-medium">Customer</th>
                      <th className="pb-2 text-right font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.byCustomer.map((item) => (
                      <tr
                        key={item.name}
                        className="border-b border-border last:border-0"
                      >
                        <td className="py-2.5 text-foreground">
                          {item.name}
                        </td>
                        <td className="py-2.5 text-right font-medium tabular-nums text-foreground">
                          {formatCurrency(item.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground/70">
                No customer data yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Existing Payment Totals */}

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Payment Totals
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reports ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <div className="rounded-lg border border-border bg-sidebar p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                  Pending Payments
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-warning">
                  {formatCurrency(reports.payments.pendingAmount)}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                  {reports.payments.pendingCount} orders
                </div>
              </div>

              <div className="rounded-lg border border-border bg-sidebar p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                  Confirmed Payments
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-success">
                  {formatCurrency(reports.payments.confirmedAmount)}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                  {reports.payments.confirmedCount} orders
                </div>
              </div>

              <div className="rounded-lg border border-border bg-sidebar p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                  Total Sales
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {formatCurrency(reports.totals.totalSales)}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                  VAT-inclusive approved
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-[120px] items-center justify-center text-sm text-muted-foreground/70">
              Loading payment totals...
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================ */}
      {/* SALES INVOICE REPORT                                         */}
      {/* ============================================================ */}

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <ReceiptText className="size-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-foreground">
                Sales Orders Report
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Approved and payment-confirmed sales only
              </p>
            </div>
          </div>

          {salesReport && (
            <ExportButton
              onClick={() =>
                exportSalesToExcel(
                  approvedSales,
                  salesStartDate,
                  salesEndDate,
                )
              }
              disabled={salesLoading || approvedSales.length === 0}
            />
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EthiopianDatePicker
              label="Start Date"
              value={salesStartDate}
              onChange={setSalesStartDate}
            />

            <EthiopianDatePicker
              label="End Date"
              value={salesEndDate}
              onChange={setSalesEndDate}
            />
          </div>

          <div className="flex justify-end">
            <ProcessButton
              onClick={processSalesReport}
              loading={salesLoading}
            />
          </div>

          {salesError && <ReportError message={salesError} />}

          {salesReport && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Sales Report Results
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatEthiopianDate(salesStartDate)} –{" "}
                    {formatEthiopianDate(salesEndDate)}
                  </p>
                </div>

                <span className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                  {salesSummary.record_count} orders
                </span>
              </div>

              {/* Sales summary */}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <SummaryMetric
                  label="Orders"
                  value={String(salesSummary.record_count)}
                />
                <SummaryMetric
                  label="Subtotal Excl. VAT"
                  value={currency(salesSummary.subtotal_excl_vat)}
                />
                <SummaryMetric
                  label="Total VAT"
                  value={currency(salesSummary.total_vat)}
                />
                <SummaryMetric
                  label="Total Sales"
                  value={currency(salesSummary.total_price_incl_vat)}
                />
                <SummaryMetric
                  label="Withholding"
                  value={currency(salesSummary.withholding_amount)}
                />
              </div>

              {/* Sales order lines table */}

              {approvedSales.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[1000px] text-sm">
                    <thead className="bg-sidebar">
                      <tr className="border-b border-border text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-3">Date</th>
                        <th className="px-3 py-3">Aggregate Type</th>
                        <th className="px-3 py-3 text-right">Quantity (m³)</th>
                        <th className="px-3 py-3 text-right">Subtotal Excl. VAT</th>
                        <th className="px-3 py-3 text-right">VAT</th>
                        <th className="px-3 py-3 text-right">Total Sales</th>
                        <th className="px-3 py-3 text-right">WHT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvedSales.map((record) => (
                        <tr key={record.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                          <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatEthiopianDate(record.invoice_date)}</td>
                          <td className="px-3 py-3 font-medium text-foreground">{record.aggregate_type}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-foreground">{numericValue(record.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-foreground">{currency(record.subtotal_excl_vat)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-foreground">{currency(record.total_vat)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums text-foreground">{currency(record.total_price_incl_vat)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-foreground">{currency(record.withholding_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-sidebar">
                      <tr className="font-semibold text-foreground">
                        <td colSpan={2} className="px-3 py-3">Report Total</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{numericValue(salesSummary.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{currency(salesSummary.subtotal_excl_vat)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{currency(salesSummary.total_vat)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{currency(salesSummary.total_price_incl_vat)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{currency(salesSummary.withholding_amount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center">
                  <FileSpreadsheet className="size-7 text-muted-foreground/50" />
                  <p className="text-sm font-medium text-foreground">
                    No approved sales found
                  </p>
                  <p className="text-xs text-muted-foreground">
                    No approved or payment-confirmed sales were found within
                    the selected date range.
                  </p>
                </div>
              )}

              <div className="flex justify-end">
                <ExportButton
                  onClick={() =>
                    exportSalesToExcel(
                      approvedSales,
                      salesStartDate,
                      salesEndDate,
                    )
                  }
                  disabled={salesLoading || approvedSales.length === 0}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================ */}
      {/* EXPENSE REPORT                                               */}
      {/* ============================================================ */}

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-warning/10">
              <FileSpreadsheet className="size-5 text-warning" />
            </div>

            <div>
              <CardTitle className="text-sm font-semibold text-foreground">
                Expenses Report
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Approved expenses only
              </p>
            </div>
          </div>

          {expenseReport && (
            <ExportButton
              onClick={() =>
                exportExpensesToExcel(
                  approvedExpenses,
                  expenseStartDate,
                  expenseEndDate,
                )
              }
              disabled={expenseLoading || approvedExpenses.length === 0}
            />
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EthiopianDatePicker
              label="Start Date"
              value={expenseStartDate}
              onChange={setExpenseStartDate}
            />

            <EthiopianDatePicker
              label="End Date"
              value={expenseEndDate}
              onChange={setExpenseEndDate}
            />
          </div>

          <div className="flex justify-end">
            <ProcessButton
              onClick={processExpenseReport}
              loading={expenseLoading}
            />
          </div>

          {expenseError && <ReportError message={expenseError} />}

          {expenseReport && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Expenses Report Results
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatEthiopianDate(expenseStartDate)} –{" "}
                    {formatEthiopianDate(expenseEndDate)}
                  </p>
                </div>

                <span className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                  {expenseSummary.record_count} expenses
                </span>
              </div>

              {/* Expense summary */}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <SummaryMetric
                  label="Expenses"
                  value={String(expenseSummary.record_count)}
                />

                <SummaryMetric
                  label="Amount Excl. VAT"
                  value={currency(expenseSummary.amount_excl_vat)}
                />

                <SummaryMetric
                  label="Total VAT"
                  value={currency(expenseSummary.vat_amount)}
                />

                <SummaryMetric
                  label="Total WHT"
                  value={currency(expenseSummary.wht_amount)}
                />

                <SummaryMetric
                  label="Total Expenses"
                  value={currency(expenseSummary.total_amount)}
                />
              </div>

              {/* Expense table */}

              {approvedExpenses.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[1050px] text-sm">
                    <thead className="bg-sidebar">
                      <tr className="border-b border-border text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-3">Date</th>
                        <th className="px-3 py-3">Expense Type</th>
                        <th className="px-3 py-3">Remark</th>
                        <th className="px-3 py-3 text-right">
                          Amount Excl. VAT
                        </th>
                        <th className="px-3 py-3 text-right">VAT</th>
                        <th className="px-3 py-3 text-right">WHT</th>
                        <th className="px-3 py-3 text-right">Total Expenses</th>
                      </tr>
                    </thead>

                    <tbody>
                      {approvedExpenses.map((record) => (
                        <tr
                          key={record.id}
                          className="border-b border-border last:border-0 hover:bg-accent/40"
                        >
                          <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                            {formatEthiopianDate(record.expense_date)}
                          </td>

                          <td className="px-3 py-3 text-foreground">
                            {record.expense_type}
                          </td>

                          <td className="max-w-[240px] px-3 py-3 text-muted-foreground">
                            {record.remark || "—"}
                          </td>

                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-foreground">
                            {currency(record.amount_excl_vat)}
                          </td>

                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-foreground">
                            {currency(record.vat_amount)}
                          </td>

                          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-foreground">
                            {currency(record.wht_amount)}
                          </td>

                          <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums text-foreground">
                            {currency(record.total_amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>

                    <tfoot className="bg-sidebar">
                      <tr className="font-semibold text-foreground">
                        <td colSpan={3} className="px-3 py-3">
                          Report Total
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                          {currency(expenseSummary.amount_excl_vat)}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                          {currency(expenseSummary.vat_amount)}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                          {currency(expenseSummary.wht_amount)}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                          {currency(expenseSummary.total_amount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center">
                  <FileSpreadsheet className="size-7 text-muted-foreground/50" />
                  <p className="text-sm font-medium text-foreground">
                    No approved expenses found
                  </p>
                  <p className="text-xs text-muted-foreground">
                    No approved expenses were found within the selected date
                    range.
                  </p>
                </div>
              )}

              <div className="flex justify-end">
                <ExportButton
                  onClick={() =>
                    exportExpensesToExcel(
                      approvedExpenses,
                      expenseStartDate,
                      expenseEndDate,
                    )
                  }
                  disabled={
                    expenseLoading || approvedExpenses.length === 0
                  }
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================ */}
      {/* DAILY FINANCIAL SUMMARY REPORT                               */}
      {/* ============================================================ */}

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-success/10">
              <Calculator className="size-5 text-success" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-foreground">
                Daily Financial Summary
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Daily aggregate sales, approved expenses and net profit
              </p>
            </div>
          </div>

          {summaryReport && (
            <ExportButton
              onClick={() => exportSummaryReportToExcel(
                summaryReport,
                summaryStartDate,
                summaryEndDate,
              )}
              disabled={summaryLoading}
            />
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <EthiopianDatePicker
              label="Start Date"
              value={summaryStartDate}
              onChange={setSummaryStartDate}
            />
            <EthiopianDatePicker
              label="End Date"
              value={summaryEndDate}
              onChange={setSummaryEndDate}
            />
          </div>

          <div className="flex justify-end">
            <ProcessButton
              onClick={processSummaryReport}
              loading={summaryLoading}
            />
          </div>

          {summaryError && <ReportError message={summaryError} />}

          {summaryReport && (
            <div className="space-y-5 border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Daily Summary Results
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatEthiopianDate(summaryStartDate)} – {formatEthiopianDate(summaryEndDate)}
                  </p>
                </div>
                <span className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                  {summaryReport.days.length} days
                </span>
              </div>

              {summaryReport.days.length > 0 ? (
                <div className="space-y-4">
                  {summaryReport.days.map((day) => (
                    <div key={day.date} className="overflow-hidden rounded-lg border border-border">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-sidebar px-4 py-3">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="size-4 text-primary" />
                          <h4 className="text-sm font-semibold text-foreground">
                            {formatEthiopianDate(day.date)}
                          </h4>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Daily sales {currency(day.totals.sales_amount)}
                          <span className="mx-2">·</span>
                          Expenses {currency(day.totals.expense_amount)}
                        </span>
                      </div>

                      <div className="grid gap-4 p-3 lg:grid-cols-2 lg:p-4">
                        <section className="min-w-0">
                          <div className="mb-2 flex items-center justify-between">
                            <h5 className="text-xs font-semibold uppercase tracking-wide text-foreground">Sales</h5>
                            <span className="text-xs text-muted-foreground">Aggregate · Qty m³ · Amount</span>
                          </div>
                          <div className="overflow-x-auto rounded-md border border-border">
                            <table className="w-full min-w-[390px] text-xs">
                              <thead className="bg-sidebar text-muted-foreground">
                                <tr>
                                  <th className="px-3 py-2 text-left font-medium">Aggregate Type</th>
                                  <th className="px-3 py-2 text-right font-medium">Qty m³</th>
                                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(day.sales ?? []).map((sale, index) => (
                                  <tr key={`${sale.aggregate_type}-${index}`} className="border-t border-border">
                                    <td className="px-3 py-2 text-foreground">{sale.aggregate_type}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{numericValue(sale.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{currency(sale.amount)}</td>
                                  </tr>
                                ))}
                                <tr className="border-t-2 border-border bg-sidebar font-semibold text-foreground">
                                  <td className="px-3 py-2">Sum</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{numericValue(day.totals.sales_quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{currency(day.totals.sales_amount)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </section>

                        <section className="min-w-0">
                          <div className="mb-2 flex items-center justify-between">
                            <h5 className="text-xs font-semibold uppercase tracking-wide text-foreground">Expenses</h5>
                            <span className="text-xs text-muted-foreground">Item · Amount · Remark</span>
                          </div>
                          <div className="overflow-x-auto rounded-md border border-border">
                            <table className="w-full min-w-[390px] text-xs">
                              <thead className="bg-sidebar text-muted-foreground">
                                <tr>
                                  <th className="px-3 py-2 text-left font-medium">Expense Item</th>
                                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                                  <th className="px-3 py-2 text-left font-medium">Remark</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(day.expenses ?? []).length > 0 ? (day.expenses ?? []).map((expense, index) => (
                                  <tr key={`${expense.expense_type}-${index}`} className="border-t border-border">
                                    <td className="px-3 py-2 text-foreground">{expense.expense_type}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{currency(expense.amount)}</td>
                                    <td className="max-w-[180px] px-3 py-2 text-muted-foreground">{expense.remark || "—"}</td>
                                  </tr>
                                )) : (
                                  <tr className="border-t border-border">
                                    <td colSpan={3} className="px-3 py-3 text-center text-muted-foreground">No approved expenses</td>
                                  </tr>
                                )}
                                <tr className="border-t-2 border-border bg-sidebar font-semibold text-foreground">
                                  <td className="px-3 py-2">Sum</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{currency(day.totals.expense_amount)}</td>
                                  <td className="px-3 py-2">—</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </section>
                      </div>
                    </div>
                  ))}

                  <div className="overflow-x-auto rounded-lg border-2 border-primary/20 bg-sidebar">
                    <table className="w-full min-w-[620px] text-sm">
                      <tbody>
                        <tr className="font-semibold text-foreground">
                          <td className="px-4 py-3">Total</td>
                          <td className="px-4 py-3 text-right tabular-nums">{numericValue(summaryReport.totals.sales_quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })} m³</td>
                          <td className="px-4 py-3 text-right tabular-nums">Sales: {currency(summaryReport.totals.sales_amount)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">Expenses: {currency(summaryReport.totals.expense_amount)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No daily records were returned for this period.
                </div>
              )}

              <div className="space-y-3 border-t border-border pt-5">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Financial Summary</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Calculated for the complete selected period</p>
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-sidebar">
                      <tr className="text-left text-xs font-semibold text-muted-foreground">
                        <th className="px-4 py-3">Summary</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {([
                        ["Total Sales", summaryReport.summary.total_sales],
                        ["VAT (payable)", summaryReport.summary.vat_payable],
                        ["Gross Income", summaryReport.summary.gross_income],
                        ["Royalty (payable)", summaryReport.summary.royalty_payable],
                        ["Expense", summaryReport.summary.expense],
                        ["Net Profit", summaryReport.summary.net_profit],
                      ] as Array<[string, number | string]>).map(([label, value]) => (
                        <tr key={label} className={`border-t border-border ${label === "Net Profit" ? "bg-primary/5 font-bold" : ""}`}>
                          <td className="px-4 py-3 text-foreground">{label}</td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">{currency(value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end">
                <ExportButton
                  onClick={() => exportSummaryReportToExcel(summaryReport, summaryStartDate, summaryEndDate)}
                  disabled={summaryLoading}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
