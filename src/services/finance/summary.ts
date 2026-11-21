
/**
 * Finance analytics — dashboards and reporting views.
 *
 * Dashboard period filtering uses the Ethiopian calendar:
 *   - Year: Ethiopian calendar year.
 *   - Month: Ethiopian calendar month (1–13).
 *   - null month: all 13 months within the selected year.
 *   - Missing year/month: current Ethiopian year and month by default.
 *
 * Accounting definitions:
 *   - Total Sales = FINANCE_APPROVED + PAYMENT_CONFIRMED invoices.
 *   - Both sales statuses use invoice.createdAt for period filtering.
 *   - Each invoice is counted exactly once.
 *   - VAT = Total Sales - (Total Sales / 1.15).
 *   - Gross Income = Total Sales - VAT.
 *   - Royalty = 3% of eligible VAT-exclusive order-line totals.
 *   - Net Profit = Gross Income - Expenses - Royalty.
 *
 * Date rules:
 *   - Sales and review metrics use invoice creation date.
 *   - Confirmed payment activity uses payment confirmation date.
 *   - Expense metrics use the expense's recorded date.
 */

import { salesInvoicesRepository } from "../sales/invoiceRepo";

import {
  INVOICE_ROYALTY_RATE as ROYALTY_RATE,
  type SalesInvoice,
} from "../sales/invoice";

import { roundMoney } from "../sales/calc";
import { ORDER_STATUS } from "../sales/types";

import {
  calculateVat,
  calculateGrossIncome,
} from "./calculations";

import {
  expensesRepository,
  isExpenseCounted,
} from "./expenses";

import { financialRecordsRepository } from "./records";

import type {
  FinancialReportsData,
  FinancePaymentSummary,
  FinanceSummary,
} from "./types";

/* ------------------------------------------------------------------ */
/* Ethiopian calendar helpers                                         */
/* ------------------------------------------------------------------ */

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

const ethiopianDateFormatter = new Intl.DateTimeFormat(
  "en-US-u-ca-ethiopic-nu-latn",
  {
    year: "numeric",
    month: "numeric",
    timeZone: "Africa/Addis_Ababa",
  },
);

function getEthiopianPeriod(date: Date): {
  year: number;
  month: number;
  key: string;
} {
  const parts = ethiopianDateFormatter.formatToParts(date);

  const year = Number(
    parts.find((part) => part.type === "year")?.value,
  );

  const month = Number(
    parts.find((part) => part.type === "month")?.value,
  );

  return {
    year,
    month,
    key: `${year}-${String(month).padStart(2, "0")}`,
  };
}

/**
 * Resolve the dashboard period.
 *
 * Missing year  -> current Ethiopian year.
 * Missing month -> current Ethiopian month.
 * Null month    -> all 13 months of the selected year.
 */
function resolveDashboardPeriod(
  year?: number,
  month?: number | null,
): {
  year: number;
  month: number | null;
} {
  const current = getEthiopianPeriod(new Date());

  return {
    year: year ?? current.year,
    month: month === undefined ? current.month : month,
  };
}

function getDateForPeriod(
  value: string | number | Date,
): Date | null {
  let date: Date;

  if (value instanceof Date) {
    date = value;
  } else if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    // Treat date-only values as Ethiopian-local calendar dates.
    date = new Date(`${value}T12:00:00+03:00`);
  } else {
    date = new Date(value);
  }

  return Number.isNaN(date.getTime()) ? null : date;
}

function matchesPeriod(
  value: string | number | Date | undefined,
  year?: number,
  month?: number | null,
): boolean {
  if (year === undefined) {
    return true;
  }

  if (value === undefined || value === null) {
    return false;
  }

  const date = getDateForPeriod(value);

  if (!date) {
    return false;
  }

  const period = getEthiopianPeriod(date);

  return (
    period.year === year &&
    (month == null || period.month === month)
  );
}

/**
 * Build the Ethiopian month series for the selected dashboard period.
 *
 * Specific month: one month.
 * All months: all 13 months of the selected year.
 * No selected year: preserve the previous last-six-month behavior.
 *
 * Missing months are represented by zero.
 */
function buildMonthSeries(
  byMonth: Record<string, number>,
  year?: number,
  month?: number | null,
): {
  name: string;
  value: number;
}[] {
  const series: { name: string; value: number }[] = [];

  if (year !== undefined) {
    const months =
      month == null
        ? Array.from({ length: 13 }, (_, index) => index + 1)
        : [month];

    for (const selectedMonth of months) {
      const key = `${year}-${String(selectedMonth).padStart(2, "0")}`;

      series.push({
        name: `${ETHIOPIAN_MONTHS[selectedMonth - 1]} ${year}`,
        value: byMonth[key] ?? 0,
      });
    }

    return series;
  }

  const current = getEthiopianPeriod(new Date());
  const currentIndex = current.year * 13 + current.month - 1;

  for (let i = 5; i >= 0; i--) {
    const index = currentIndex - i;

    const selectedYear = Math.floor(index / 13);
    const selectedMonth = (index % 13) + 1;

    const key = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;

    series.push({
      name: `${ETHIOPIAN_MONTHS[selectedMonth - 1]} ${selectedYear}`,
      value: byMonth[key] ?? 0,
    });
  }

  return series;
}

/* ------------------------------------------------------------------ */
/* Revenue helpers                                                     */
/* ------------------------------------------------------------------ */

function isRevenueStatus(invoice: SalesInvoice): boolean {
  return (
    invoice.status === ORDER_STATUS.FINANCE_APPROVED ||
    invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED
  );
}

/**
 * Select revenue invoices from one already-period-filtered dataset.
 *
 * A Map keyed by invoice ID ensures each invoice is counted once.
 */
function getRevenueInvoices(
  invoices: SalesInvoice[],
): SalesInvoice[] {
  const uniqueInvoices = new Map<string, SalesInvoice>();

  for (const invoice of invoices) {
    if (!isRevenueStatus(invoice)) {
      continue;
    }

    uniqueInvoices.set(invoice.id, invoice);
  }

  return Array.from(uniqueInvoices.values());
}

function invoiceTotalSales(invoices: SalesInvoice[]): number {
  return roundMoney(
    invoices.reduce(
      (sum, invoice) =>
        sum + invoice.financialSummary.totalPriceInclVat,
      0,
    ),
  );
}

/**
 * Royalty is calculated from eligible VAT-exclusive order-line totals.
 */
function invoiceRoyalty(invoices: SalesInvoice[]): number {
  const royaltyBase = invoices.reduce(
    (sum, invoice) =>
      sum +
      invoice.orders.reduce(
        (lineSum, order) =>
          lineSum + order.lineTotalExclVat,
        0,
      ),
    0,
  );

  return roundMoney(royaltyBase * ROYALTY_RATE);
}

/* ------------------------------------------------------------------ */
/* Grouping helpers                                                    */
/* ------------------------------------------------------------------ */

function groupBy(
  invoices: SalesInvoice[],
  keyOf: (invoice: SalesInvoice) => string,
): {
  name: string;
  value: number;
}[] {
  const groups: Record<string, number> = {};

  for (const invoice of invoices) {
    const value = invoice.financialSummary.totalPriceInclVat;
    const key = keyOf(invoice);

    groups[key] = (groups[key] ?? 0) + value;
  }

  return Object.entries(groups)
    .map(([name, value]) => ({
      name,
      value: roundMoney(value),
    }))
    .sort((a, b) => b.value - a.value);
}

/* ------------------------------------------------------------------ */
/* Finance dashboard summary                                          */
/* ------------------------------------------------------------------ */

export async function getFinanceSummary(
  year?: number,
  month?: number | null,
): Promise<FinanceSummary> {
  // Default to the current Ethiopian year and month.
  const period = resolveDashboardPeriod(year, month);

  const [allInvoices, allExpenses] = await Promise.all([
    salesInvoicesRepository.getInvoices(),
    expensesRepository.getExpenses(),
  ]);

  /* -------------------------------------------------------------- */
  /* Ethiopian reporting-period filtering                            */
  /* -------------------------------------------------------------- */

  /**
   * All sales statuses are filtered using invoice.createdAt.
   *
   * This ensures approved and payment-confirmed invoices are
   * included in the same Ethiopian reporting period.
   */
  const invoices = allInvoices.filter((invoice) =>
    matchesPeriod(
      invoice.createdAt,
      period.year,
      period.month,
    ),
  );

  /**
   * Revenue includes exactly:
   *   FINANCE_APPROVED
   *   PAYMENT_CONFIRMED
   *
   * Both come from the same period-filtered invoice dataset.
   */
  const revenueInvoices = getRevenueInvoices(invoices);

  /**
   * Payment activity is separate from sales reporting.
   * Payment confirmation date determines its reporting period.
   */
  const confirmedPayments = allInvoices.filter(
    (invoice) =>
      invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED &&
      matchesPeriod(
        invoice.paymentConfirmedAt ?? invoice.createdAt,
        period.year,
        period.month,
      ),
  );

  // Expenses use their recorded date.
  const expenses = allExpenses
    .filter(isExpenseCounted)
    .filter((expense) =>
      matchesPeriod(
        expense.date,
        period.year,
        period.month,
      ),
    );

  /* -------------------------------------------------------------- */
  /* Expense calculations                                            */
  /* -------------------------------------------------------------- */

  const totalExpenses = roundMoney(
    expenses.reduce(
      (sum, expense) =>
        sum +
        (Number.isFinite(expense.amount) ? expense.amount : 0),
      0,
    ),
  );

  const expenseVat = roundMoney(
    expenses.reduce(
      (sum, expense) =>
        sum +
        (Number.isFinite(expense.vatAmount)
          ? expense.vatAmount
          : 0),
      0,
    ),
  );

  const expenseWht = roundMoney(
    expenses.reduce(
      (sum, expense) =>
        sum +
        (Number.isFinite(expense.whtAmount)
          ? expense.whtAmount
          : 0),
      0,
    ),
  );

  /* -------------------------------------------------------------- */
  /* Sales review statuses                                           */
  /* -------------------------------------------------------------- */

  const pending = invoices.filter(
    (invoice) =>
      invoice.status === ORDER_STATUS.PENDING_FINANCE_REVIEW,
  );

  const approved = invoices.filter(
    (invoice) =>
      invoice.status === ORDER_STATUS.FINANCE_APPROVED,
  );

  const rejected = invoices.filter(
    (invoice) =>
      invoice.status === ORDER_STATUS.REJECTED,
  );

  /* -------------------------------------------------------------- */
  /* Total sales and revenue calculations                            */
  /* -------------------------------------------------------------- */

  // Approved + payment-confirmed invoices, filtered by createdAt.
  const totalSales = invoiceTotalSales(revenueInvoices);

  // VAT is extracted from VAT-inclusive Total Sales.
  const vat = roundMoney(calculateVat(totalSales));

  // Gross Income = Total Sales - VAT.
  const grossIncome = roundMoney(
    calculateGrossIncome(totalSales),
  );

  /* -------------------------------------------------------------- */
  /* Payment calculations                                            */
  /* -------------------------------------------------------------- */

  // Approved sales awaiting payment confirmation.
  const pendingAmount = invoiceTotalSales(approved);

  // Confirmed payment activity uses payment confirmation date.
  const confirmedRevenue = invoiceTotalSales(confirmedPayments);

  /* -------------------------------------------------------------- */
  /* Royalty and net profit                                           */
  /* -------------------------------------------------------------- */

  const royalty = invoiceRoyalty(revenueInvoices);

  // Expenses are deducted once using expense.amount.
  const netProfit = roundMoney(
    grossIncome - totalExpenses - royalty,
  );

  /* -------------------------------------------------------------- */
  /* Review metrics                                                  */
  /* -------------------------------------------------------------- */

  const reviewed = approved.length + rejected.length;

  const approvalRate =
    reviewed > 0
      ? Math.round((approved.length / reviewed) * 100)
      : 0;

  /* -------------------------------------------------------------- */
  /* Recent pending reviews                                          */
  /* -------------------------------------------------------------- */

  const recentPending = [...pending]
    .sort(
      (a, b) =>
        (b.submittedAt ?? b.createdAt) -
        (a.submittedAt ?? a.createdAt),
    )
    .slice(0, 5);

  /* -------------------------------------------------------------- */
  /* Payment summary                                                 */
  /* -------------------------------------------------------------- */

  const payments: FinancePaymentSummary = {
    pendingCount: approved.length,
    pendingAmount,
    confirmedCount: confirmedPayments.length,
    confirmedAmount: confirmedRevenue,
  };

  /* -------------------------------------------------------------- */
  /* Return dashboard summary                                        */
  /* -------------------------------------------------------------- */

  return {
    totalSales,
    vat,
    grossIncome,
    royalty,
    totalExpenses,
    expenseVat,
    expenseWht,

    netProfit,

    pendingApprovals: pending.length,
    approved: approved.length,
    rejected: rejected.length,
    pendingPayments: approved.length,
    confirmedPayments: confirmedPayments.length,
    confirmedRevenue,

    review: {
      pending: pending.length,
      approved: approved.length,
      rejected: rejected.length,
      approvalRate,
    },

    payments,
    recentPending,
  };
}

/* ------------------------------------------------------------------ */
/* Financial reports                                                   */
/* ------------------------------------------------------------------ */

export async function getFinancialReports(
  year?: number,
  month?: number | null,
): Promise<FinancialReportsData> {
  // Default to the current Ethiopian year and month.
  const period = resolveDashboardPeriod(year, month);

  const allInvoices = await salesInvoicesRepository.getInvoices();

  /**
   * Sales reporting uses invoice creation date.
   * This keeps the financial report consistent with the dashboard.
   */
  const invoices = allInvoices.filter((invoice) =>
    matchesPeriod(
      invoice.createdAt,
      period.year,
      period.month,
    ),
  );

  // Same approved + confirmed sales definition as the dashboard.
  const revenueInvoices = getRevenueInvoices(invoices);

  // Approved sales awaiting payment confirmation.
  const approved = invoices.filter(
    (invoice) =>
      invoice.status === ORDER_STATUS.FINANCE_APPROVED,
  );

  /**
   * Confirmed payment activity is filtered by payment confirmation
   * date rather than invoice creation date.
   */
  const confirmedPayments = allInvoices.filter(
    (invoice) =>
      invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED &&
      matchesPeriod(
        invoice.paymentConfirmedAt ?? invoice.createdAt,
        period.year,
        period.month,
      ),
  );

  /* -------------------------------------------------------------- */
  /* Revenue by Ethiopian month                                      */
  /* -------------------------------------------------------------- */

  const byMonth: Record<string, number> = {};

  for (const invoice of revenueInvoices) {
    const date = getDateForPeriod(invoice.createdAt);

    if (!date) continue;

    const invoicePeriod = getEthiopianPeriod(date);

    byMonth[invoicePeriod.key] =
      (byMonth[invoicePeriod.key] ?? 0) +
      invoice.financialSummary.totalPriceInclVat;
  }

  /* -------------------------------------------------------------- */
  /* Financial totals                                                */
  /* -------------------------------------------------------------- */

  const totalSales = invoiceTotalSales(revenueInvoices);

  const vat = roundMoney(calculateVat(totalSales));

  const grossIncome = roundMoney(
    calculateGrossIncome(totalSales),
  );

  const royalty = invoiceRoyalty(revenueInvoices);

  const confirmedRevenue = invoiceTotalSales(confirmedPayments);

  /* -------------------------------------------------------------- */
  /* Return reports                                                  */
  /* -------------------------------------------------------------- */

  return {
    byMonth: buildMonthSeries(
      byMonth,
      period.year,
      period.month,
    ),

    byAggregate: Object.entries(
      revenueInvoices
        .flatMap((invoice) => invoice.orders)
        .reduce<Record<string, number>>((acc, order) => {
          acc[order.aggregate] =
            (acc[order.aggregate] ?? 0) +
            order.lineTotalExclVat;

          return acc;
        }, {}),
    )
      .map(([name, value]) => ({
        name,
        value: roundMoney(value),
      }))
      .sort((a, b) => b.value - a.value),

    byBank: groupBy(
      revenueInvoices,
      (invoice) => invoice.payment.bank,
    ),

    byCustomer: groupBy(
      revenueInvoices,
      (invoice) => invoice.customer.name,
    ).slice(0, 8),

    totals: {
      totalSales,
      vat,
      grossIncome,
      royalty,
    },

    payments: {
      pendingCount: approved.length,
      pendingAmount: invoiceTotalSales(approved),
      confirmedCount: confirmedPayments.length,
      confirmedAmount: confirmedRevenue,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Confirmed financial record totals                                  */
/* ------------------------------------------------------------------ */

export async function getConfirmedRecordTotals(): Promise<{
  count: number;
  totalAmount: number;
}> {
  const records = await financialRecordsRepository.getRecords();

  return {
    count: records.length,

    totalAmount: roundMoney(
      records.reduce(
        (sum, record) => sum + record.totalPrice,
        0,
      ),
    ),
  };
}
