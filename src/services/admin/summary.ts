
/**
 * Admin Reporting Service — read-only aggregation layer.
 *
 * This module reads from the SAME shared repositories used by Sales,
 * Finance, and HR. It never creates or modifies any data. Admin is an
 * executive reporting/oversight layer only.
 *
 * Synchronized with the Sales Invoice model:
 *   - Approved Sales Total = Σ approved invoice totalPriceInclVat (each
 *     invoice counted exactly once — child orders are never re-added).
 *   - VAT  = Total Sales − (Total Sales / 1.15)
 *   - Gross Income = Total Sales − VAT
 *   - Royalty = Σ approved order lineTotalExclVat × 0.03 (VAT-exclusive,
 *     order-level — never the invoice total, never gross income)
 *   - Net Profit = Gross Income − Total Expenses − Royalty
 *     (withholding is never subtracted here)
 *
 * Financial formulas are imported from the centralized calculation service
 * (src/services/finance/calculations.ts) — no alternative formulas.
 *
 * Dashboard period filters use Ethiopian calendar years and months.
 * Ethiopian months are numbered 1–13.
 */
import { salesInvoicesRepository } from "../sales/invoiceRepo";
import {
  INVOICE_REVENUE_STATUSES,
  type SalesInvoice,
} from "../sales/invoice";
import { ORDER_STATUS } from "../sales/types";
import {
  expensesRepository,
  isExpenseCounted,
} from "../finance/expenses";
import { financialRecordsRepository } from "../finance/records";
import { payrollFinancialRecordsRepository } from "../finance/payrollRecords";
import {
  calculateVat,
  calculateGrossIncome,
  calculateNetProfit,
} from "../finance/calculations";
import { payrollRepository } from "../hr/payrollRepository";
import { leaveRepository } from "../hr/leaveRepository";
import type { AdminSalesReportData } from "./summaryTypes";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface AdminPeriodFilters {
  year?: number;
  month?: number;
}

export interface AdminSalesOverview {
  totalInvoices: number;
  totalOrders: number;
  draft: number;
  pendingReview: number;
  approved: number;
  rejected: number;
  paymentConfirmed: number;
  /** Σ approved+confirmed invoice totalPriceInclVat — one per invoice. */
  totalSalesRevenue: number;
  totalQuantity: number;
  byMonth: { name: string; value: number }[];
  byAggregate: { name: string; value: number }[];
  byStatus: { name: string; value: number }[];
}

export interface AdminFinanceOverview {
  totalSales: number;
  vat: number;
  grossIncome: number;
  totalExpenses: number;
  /** Expense VAT component (input VAT) — informational. */
  expenseVat: number;
  /** Expense WHT withheld — payment measure, never a second deduction. */
  expenseWht: number;
  royalty: number;
  netProfit: number;
}

export interface AdminHROverview {
  totalEmployees: number;
  activeEmployees: number;
  inactiveEmployees: number;
  presentToday: number;
  absentToday: number;
  lateToday: number;
  onLeave: number;
  pendingLeave: number;
  payrollStatus: string;
}

export interface AdminMonthlyFinancialRow {
  month: string;
  monthKey: string;
  totalSales: number;
  vat: number;
  grossIncome: number;
  /** Total / After VAT — the accounting expense amount (deducted once). */
  expenses: number;
  /** Expense VAT component. */
  expenseVat: number;
  /** Expense WHT component (payment measure). */
  expenseWht: number;
  royalty: number;
  netProfit: number;
}

export interface AdminOverallSummary {
  totalSales: number;
  vat: number;
  grossIncome: number;
  royalty: number;
  totalExpenses: number;
  netProfit: number;
  totalEmployees: number;
  activeEmployees: number;
  sales: AdminSalesOverview;
  finance: AdminFinanceOverview;
  hr: AdminHROverview;
  monthlyFinancials: AdminMonthlyFinancialRow[];
}

export interface AdminFinancialReportData {
  byMonth: AdminMonthlyFinancialRow[];
  totals: AdminFinanceOverview;
  records: {
    id: string;
    recordNumber: string;
    customerName: string;
    totalPrice: number;
    bank: string;
    postedAt: number;
  }[];
  payrollRecords: {
    id: string;
    recordNumber: string;
    payrollPeriod: string;
    totalNet: number;
    paidAt: number;
  }[];
}

export interface AdminHRReportData {
  employees: {
    total: number;
    active: number;
    inactive: number;
    byPosition: { name: string; value: number }[];
  };
  attendance: {
    present: number;
    absent: number;
    late: number;
    leave: number;
  };
  payroll: {
    runs: number;
    totalGross: number;
    totalDeductions: number;
    totalNet: number;
    statuses: Record<string, number>;
  };
  pendingLeave: number;
}

export interface AdminOverallReportData {
  month: string;
  year: number;
  sales: {
    totalSales: number;
    invoices: number;
    orders: number;
    quantity: number;
  };
  finance: AdminFinanceOverview;
  hr: {
    employees: number;
    attendance: { present: number; absent: number };
    payroll: string;
  };
}

/* ------------------------------------------------------------------ */
/* Ethiopian Calendar Helpers                                          */
/* ------------------------------------------------------------------ */

const ETHIOPIAN_MONTH_NAMES = [
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

/**
 * Use en-US with explicit Ethiopic calendar and Latin numerals.
 */
const ethiopianDateFormatter = new Intl.DateTimeFormat(
  "en-US-u-ca-ethiopic-nu-latn",
  {
    year: "numeric",
    month: "numeric",
    timeZone: "Africa/Addis_Ababa",
  },
);

function getEthiopianPeriod(
  value: string | number | Date,
): {
  year: number;
  month: number;
  key: string;
} {
  let date: Date;

  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    // Avoid UTC shifting date-only values into another calendar day.
    date = new Date(`${value}T12:00:00+03:00`);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Invalid reporting date: ${String(value)}`,
    );
  }

  const parts = ethiopianDateFormatter.formatToParts(date);

  const yearPart = parts.find(
    (part) => part.type === "year",
  )?.value;

  const monthPart = parts.find(
    (part) => part.type === "month",
  )?.value;

  const yearDigits =
    yearPart?.replace(/[^\d]/g, "") ?? "";

  const monthDigits =
    monthPart?.replace(/[^\d]/g, "") ?? "";

  const year = Number.parseInt(yearDigits, 10);
  const month = Number.parseInt(monthDigits, 10);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 13
  ) {
    throw new Error(
      `Unable to determine Ethiopian reporting period for: ${String(value)}`,
    );
  }

  return {
    year,
    month,
    key: `${year}-${String(month).padStart(2, "0")}`,
  };
}

function getCurrentEthiopianYear(): number {
  return getEthiopianPeriod(new Date()).year;
}

/**
 * Checks whether a date belongs to the selected Ethiopian year/month.
 * Missing filters do not restrict the date.
 */
function matchesEthiopianPeriod(
  value: string | number | Date,
  filters?: AdminPeriodFilters,
): boolean {
  if (
    filters?.year === undefined &&
    filters?.month === undefined
  ) {
    return true;
  }

  const period = getEthiopianPeriod(value);

  if (
    filters?.year !== undefined &&
    period.year !== filters.year
  ) {
    return false;
  }

  if (
    filters?.month !== undefined &&
    period.month !== filters.month
  ) {
    return false;
  }

  return true;
}

/**
 * Filter invoices by their createdAt Ethiopian reporting period.
 */
function filterInvoicesByPeriod(
  invoices: SalesInvoice[],
  filters?: AdminPeriodFilters,
): SalesInvoice[] {
  if (
    filters?.year === undefined &&
    filters?.month === undefined
  ) {
    return invoices;
  }

  return invoices.filter((invoice) =>
    matchesEthiopianPeriod(invoice.createdAt, filters),
  );
}

/* ------------------------------------------------------------------ */
/* Ethiopian Sales Month Series                                        */
/* ------------------------------------------------------------------ */

/**
 * When a year is selected, return all 13 months.
 * When a month is selected too, return only that month.
 * When only a month is selected, aggregate that month across years.
 * Without filters, return the latest 6 Ethiopian months.
 */
function buildEthiopianSalesMonthSeries(
  data: Record<string, number>,
  selectedYear?: number,
  selectedMonth?: number,
): { name: string; value: number }[] {
  if (
    selectedYear !== undefined &&
    selectedMonth !== undefined
  ) {
    const key = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;

    return [
      {
        name: ETHIOPIAN_MONTH_NAMES[selectedMonth - 1],
        value: data[key] ?? 0,
      },
    ];
  }

  if (selectedYear !== undefined) {
    const series: { name: string; value: number }[] = [];

    for (let month = 1; month <= 13; month++) {
      const key = `${selectedYear}-${String(month).padStart(2, "0")}`;

      series.push({
        name: ETHIOPIAN_MONTH_NAMES[month - 1],
        value: data[key] ?? 0,
      });
    }

    return series;
  }

  if (selectedMonth !== undefined) {
    const total = Object.entries(data).reduce(
      (sum, [key, value]) => {
        const month = Number(key.split("-")[1]);

        return month === selectedMonth
          ? sum + value
          : sum;
      },
      0,
    );

    return [
      {
        name: ETHIOPIAN_MONTH_NAMES[selectedMonth - 1],
        value: total,
      },
    ];
  }

  const series: { name: string; value: number }[] = [];
  const current = getEthiopianPeriod(new Date());

  const currentIndex =
    current.year * 13 + current.month - 1;

  for (let offset = 5; offset >= 0; offset--) {
    const absoluteMonth = currentIndex - offset;
    const year = Math.floor(absoluteMonth / 13);
    const month = (absoluteMonth % 13) + 1;

    const key = `${year}-${String(month).padStart(2, "0")}`;

    series.push({
      name: `${ETHIOPIAN_MONTH_NAMES[month - 1]} ${year}`,
      value: data[key] ?? 0,
    });
  }

  return series;
}

/* ------------------------------------------------------------------ */
/* Financial Helpers                                                   */
/* ------------------------------------------------------------------ */

/** Royalty = Σ approved order lineTotalExclVat × 0.03 (VAT-exclusive). */
function invoiceRoyalty(invoices: SalesInvoice[]): number {
  return invoices.reduce(
    (sum, invoice) =>
      sum +
      invoice.orders.reduce(
        (lineSum, order) =>
          lineSum + order.lineTotalExclVat * 0.03,
        0,
      ),
    0,
  );
}

/* ------------------------------------------------------------------ */
/* Sales Overview                                                      */
/* ------------------------------------------------------------------ */

export async function getAdminSalesOverview(
  filters?: AdminPeriodFilters,
): Promise<AdminSalesOverview> {
  const allInvoices =
    await salesInvoicesRepository.getInvoices();

  // Apply the selected Ethiopian year/month before calculating statistics.
  const invoices = filterInvoicesByPeriod(
    allInvoices,
    filters,
  );

  const draft = invoices.filter(
    (i) => i.status === ORDER_STATUS.DRAFT,
  );

  const pending = invoices.filter(
    (i) => i.status === ORDER_STATUS.PENDING_FINANCE_REVIEW,
  );

  const approved = invoices.filter(
    (i) => i.status === ORDER_STATUS.FINANCE_APPROVED,
  );

  const rejected = invoices.filter(
    (i) => i.status === ORDER_STATUS.REJECTED,
  );

  const confirmed = invoices.filter(
    (i) => i.status === ORDER_STATUS.PAYMENT_CONFIRMED,
  );

  const revenueInvoices = [
    ...approved,
    ...confirmed,
  ];

  const totalSalesRevenue = revenueInvoices.reduce(
    (sum, invoice) =>
      sum + invoice.financialSummary.totalPriceInclVat,
    0,
  );

  const totalQuantity = revenueInvoices.reduce(
    (sum, invoice) =>
      sum +
      invoice.orders.reduce(
        (s, order) => s + order.quantity,
        0,
      ),
    0,
  );

  const totalOrders = invoices.reduce(
    (sum, invoice) =>
      sum + invoice.orders.length,
    0,
  );

  // Group sales by Ethiopian reporting month.
  const byMonthData: Record<string, number> = {};

  for (const invoice of revenueInvoices) {
    const period = getEthiopianPeriod(invoice.createdAt);
    const key = period.key;

    byMonthData[key] =
      (byMonthData[key] ?? 0) +
      invoice.financialSummary.totalPriceInclVat;
  }

  // By aggregate — order level, VAT-exclusive.
  const byAggregateData: Record<string, number> = {};

  for (const invoice of revenueInvoices) {
    for (const order of invoice.orders) {
      byAggregateData[order.aggregate] =
        (byAggregateData[order.aggregate] ?? 0) +
        order.lineTotalExclVat;
    }
  }

  const byStatusData: Record<string, number> = {
    Draft: draft.length,
    "Pending Review": pending.length,
    Approved: approved.length,
    Rejected: rejected.length,
    "Payment Confirmed": confirmed.length,
  };

  return {
    totalInvoices: invoices.length,
    totalOrders,
    draft: draft.length,
    pendingReview: pending.length,
    approved: approved.length,
    rejected: rejected.length,
    paymentConfirmed: confirmed.length,
    totalSalesRevenue,
    totalQuantity,

    byMonth: buildEthiopianSalesMonthSeries(
      byMonthData,
      filters?.year,
      filters?.month,
    ),

    byAggregate: Object.entries(byAggregateData).map(
      ([name, value]) => ({
        name,
        value,
      }),
    ),

    byStatus: Object.entries(byStatusData).map(
      ([name, value]) => ({
        name,
        value,
      }),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Finance Overview                                                    */
/* ------------------------------------------------------------------ */

export async function getAdminFinanceOverview(
  filters?: AdminPeriodFilters,
): Promise<AdminFinanceOverview> {
  const [
    allInvoices,
    allExpenses,
  ] = await Promise.all([
    salesInvoicesRepository.getInvoices(),
    expensesRepository.getExpenses(),
  ]);

  // Finance sales are based on FINANCE_APPROVED invoices only.
  const invoices = filterInvoicesByPeriod(
    allInvoices,
    filters,
  );

  const approved = invoices.filter(
    (i) => i.status === ORDER_STATUS.FINANCE_APPROVED,
  );

  // Counted expenses are filtered by their transaction date.
  const expenses = allExpenses.filter(
    (expense) =>
      isExpenseCounted(expense) &&
      matchesEthiopianPeriod(expense.date, filters),
  );

  const totalExpenses = expenses.reduce(
    (sum, expense) =>
      sum +
      (Number.isFinite(expense.amount)
        ? expense.amount
        : 0),
    0,
  );

  const expenseVat = expenses.reduce(
    (sum, expense) =>
      sum +
      (Number.isFinite(expense.vatAmount)
        ? expense.vatAmount
        : 0),
    0,
  );

  const expenseWht = expenses.reduce(
    (sum, expense) =>
      sum +
      (Number.isFinite(expense.whtAmount)
        ? expense.whtAmount
        : 0),
    0,
  );

  const totalSales = approved.reduce(
    (sum, invoice) =>
      sum + invoice.financialSummary.totalPriceInclVat,
    0,
  );

  const vat = calculateVat(totalSales);
  const grossIncome = calculateGrossIncome(totalSales);
  const royalty = invoiceRoyalty(approved);

  const netProfit = calculateNetProfit(
    grossIncome,
    totalExpenses,
    royalty,
  );

  return {
    totalSales,
    vat,
    grossIncome,
    totalExpenses,
    expenseVat,
    expenseWht,
    royalty,
    netProfit,
  };
}

/* ------------------------------------------------------------------ */
/* HR Overview                                                         */
/* ------------------------------------------------------------------ */

export async function getAdminHROverview(): Promise<AdminHROverview> {
  const { getHRApiClient } = await import("../hr/apiClient");
  const client = await getHRApiClient();

  const employees = await client.getEmployees();

  const active = employees.filter(
    (e) => e.is_active,
  );

  const inactive = employees.filter(
    (e) => !e.is_active,
  );

  const today = new Date().toISOString().split("T")[0];

  const todayAttendance = await client.getAttendance({
    date: today,
  });

  const presentToday = todayAttendance.filter(
    (a) => a.status === "PRESENT",
  ).length;

  const absentToday = todayAttendance.filter(
    (a) => a.status === "ABSENT",
  ).length;

  const lateToday = todayAttendance.filter(
    (a) => a.status === "LATE",
  ).length;

  const onLeave = todayAttendance.filter(
    (a) => a.status === "LEAVE",
  ).length;

  const leaveRequests = leaveRepository.getRequests();

  const pendingLeave = leaveRequests.filter(
    (l) => l.status === "PENDING",
  ).length;

  const payrollRuns = await payrollRepository.getRuns();

  const latestRun =
    payrollRuns.length > 0
      ? payrollRuns[0]
      : null;

  return {
    totalEmployees: employees.length,
    activeEmployees: active.length,
    inactiveEmployees: inactive.length,
    presentToday,
    absentToday,
    lateToday,
    onLeave,
    pendingLeave,
    payrollStatus:
      latestRun?.status ?? "No payroll runs",
  };
}

/* ------------------------------------------------------------------ */
/* Monthly Financial Breakdown                                         */
/* ------------------------------------------------------------------ */

export async function getAdminMonthlyFinancials(
  year?: number,
  month?: number,
): Promise<AdminMonthlyFinancialRow[]> {
  const [
    invoices,
    allExpenses,
  ] = await Promise.all([
    salesInvoicesRepository.getInvoices(),
    expensesRepository.getExpenses(),
  ]);

  const expenses = allExpenses.filter(
    isExpenseCounted,
  );

  // Period fields are Ethiopian calendar values.
  const targetYear =
    year ?? getCurrentEthiopianYear();

  const revenueInvoices = invoices.filter(
    (invoice) =>
      INVOICE_REVENUE_STATUSES.has(invoice.status),
  );

  const salesByMonth: Record<string, number> = {};
  const royaltyByMonth: Record<string, number> = {};

  // Group invoice revenue by its actual Ethiopian reporting month.
  for (const invoice of revenueInvoices) {
    const period = getEthiopianPeriod(
      invoice.createdAt,
    );

    if (period.year !== targetYear) continue;

    const key = period.key;

    salesByMonth[key] =
      (salesByMonth[key] ?? 0) +
      invoice.financialSummary.totalPriceInclVat;

    royaltyByMonth[key] =
      (royaltyByMonth[key] ?? 0) +
      invoiceRoyalty([invoice]);
  }

  const expensesByMonth: Record<string, number> = {};
  const expenseVatByMonth: Record<string, number> = {};
  const expenseWhtByMonth: Record<string, number> = {};

  // Group expenses by their transaction date's Ethiopian month.
  for (const expense of expenses) {
    const period = getEthiopianPeriod(expense.date);

    if (period.year !== targetYear) continue;

    const key = period.key;

    expensesByMonth[key] =
      (expensesByMonth[key] ?? 0) +
      (Number.isFinite(expense.amount)
        ? expense.amount
        : 0);

    expenseVatByMonth[key] =
      (expenseVatByMonth[key] ?? 0) +
      (Number.isFinite(expense.vatAmount)
        ? expense.vatAmount
        : 0);

    expenseWhtByMonth[key] =
      (expenseWhtByMonth[key] ?? 0) +
      (Number.isFinite(expense.whtAmount)
        ? expense.whtAmount
        : 0);
  }

  const rows: AdminMonthlyFinancialRow[] = [];

  // Ethiopian calendar has 13 months.
  for (let currentMonth = 1; currentMonth <= 13; currentMonth++) {
    // If a month is selected, return only that month.
    if (
      month !== undefined &&
      currentMonth !== month
    ) {
      continue;
    }

    const key =
      `${targetYear}-${String(currentMonth).padStart(2, "0")}`;

    const totalSales =
      salesByMonth[key] ?? 0;

    const monthExpenses =
      expensesByMonth[key] ?? 0;

    const vat = calculateVat(totalSales);
    const grossIncome = calculateGrossIncome(totalSales);

    const royalty =
      royaltyByMonth[key] ?? 0;

    const netProfit = calculateNetProfit(
      grossIncome,
      monthExpenses,
      royalty,
    );

    rows.push({
      month:
        `${ETHIOPIAN_MONTH_NAMES[currentMonth - 1]} ${targetYear}`,
      monthKey: key,
      totalSales,
      vat,
      grossIncome,
      expenses: monthExpenses,
      expenseVat:
        expenseVatByMonth[key] ?? 0,
      expenseWht:
        expenseWhtByMonth[key] ?? 0,
      royalty,
      netProfit,
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/* Overall Summary                                                     */
/* ------------------------------------------------------------------ */

export async function getAdminOverallSummary(): Promise<AdminOverallSummary> {
  const [
    sales,
    finance,
    hr,
    monthlyFinancials,
  ] = await Promise.all([
    getAdminSalesOverview(),
    getAdminFinanceOverview(),
    getAdminHROverview(),
    getAdminMonthlyFinancials(),
  ]);

  return {
    totalSales: finance.totalSales,
    vat: finance.vat,
    grossIncome: finance.grossIncome,
    royalty: finance.royalty,
    totalExpenses: finance.totalExpenses,
    netProfit: finance.netProfit,
    totalEmployees: hr.totalEmployees,
    activeEmployees: hr.activeEmployees,
    sales,
    finance,
    hr,
    monthlyFinancials,
  };
}

/* ------------------------------------------------------------------ */
/* Sales Reports                                                       */
/* ------------------------------------------------------------------ */

export async function getAdminSalesReport(
  filters?: AdminPeriodFilters,
): Promise<AdminSalesReportData> {
  const all =
    await salesInvoicesRepository.getInvoices();

  const filtered = filterInvoicesByPeriod(
    all,
    filters,
  );

  const filteredRevenue = filtered.filter(
    (invoice) =>
      INVOICE_REVENUE_STATUSES.has(invoice.status),
  );

  const approved = filtered.filter(
    (invoice) =>
      invoice.status === ORDER_STATUS.FINANCE_APPROVED,
  );

  const rejected = filtered.filter(
    (invoice) =>
      invoice.status === ORDER_STATUS.REJECTED,
  );

  const pending = filtered.filter(
    (invoice) =>
      invoice.status === ORDER_STATUS.PENDING_FINANCE_REVIEW,
  );

  const approvedOrConfirmed = filtered.filter(
    (invoice) =>
      invoice.status === ORDER_STATUS.FINANCE_APPROVED ||
      invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED,
  );

  const sumInclVat = (
    invoices: SalesInvoice[],
  ) =>
    invoices.reduce(
      (sum, invoice) =>
        sum +
        invoice.financialSummary.totalPriceInclVat,
      0,
    );

  const totalSales =
    sumInclVat(approvedOrConfirmed);

  const approvedSales =
    sumInclVat(approved);

  const totalQuantity = filteredRevenue.reduce(
    (sum, invoice) =>
      sum +
      invoice.orders.reduce(
        (s, order) => s + order.quantity,
        0,
      ),
    0,
  );

  // By Ethiopian month — invoice level.
  const byMonthData: Record<string, number> = {};

  for (const invoice of filteredRevenue) {
    const period = getEthiopianPeriod(
      invoice.createdAt,
    );

    const key = period.key;

    byMonthData[key] =
      (byMonthData[key] ?? 0) +
      invoice.financialSummary.totalPriceInclVat;
  }

  // By aggregate — order level, VAT-exclusive.
  const byAggregateData: Record<string, number> = {};

  for (const invoice of filteredRevenue) {
    for (const order of invoice.orders) {
      byAggregateData[order.aggregate] =
        (byAggregateData[order.aggregate] ?? 0) +
        order.lineTotalExclVat;
    }
  }

  const byStatusData: Record<string, number> = {
    Draft: filtered.filter(
      (i) => i.status === ORDER_STATUS.DRAFT,
    ).length,

    "Pending Review": pending.length,

    Approved: approved.length,

    Rejected: rejected.length,

    "Payment Confirmed": filtered.filter(
      (i) =>
        i.status === ORDER_STATUS.PAYMENT_CONFIRMED,
    ).length,
  };

  return {
    byMonth: buildEthiopianSalesMonthSeries(
      byMonthData,
      filters?.year,
      filters?.month,
    ),

    byAggregate: Object.entries(
      byAggregateData,
    ).map(([name, value]) => ({
      name,
      value,
    })),

    byStatus: Object.entries(
      byStatusData,
    ).map(([name, value]) => ({
      name,
      value,
    })),

    totalSales,
    approvedSales,
    rejectedSales: sumInclVat(rejected),
    pendingReview: sumInclVat(pending),
    totalQuantity,
    invoices: filteredRevenue,
  };
}

/* ------------------------------------------------------------------ */
/* Financial Reports                                                   */
/* ------------------------------------------------------------------ */

export async function getAdminFinancialReport(
  filters?: AdminPeriodFilters,
): Promise<AdminFinancialReportData> {
  const [
    invoices,
    expenses,
    records,
    payrollRecords,
  ] = await Promise.all([
    salesInvoicesRepository.getInvoices(),
    expensesRepository.getExpenses(),
    financialRecordsRepository.getRecords(),
    payrollFinancialRecordsRepository.getRecords(),
  ]);

  // Collect every year represented in the historical data.
  const availableYears = new Set<number>();

  for (const invoice of invoices) {
    const date = new Date(invoice.createdAt);

    if (Number.isFinite(date.getTime())) {
      availableYears.add(
        getEthiopianPeriod(date).year,
      );
    }
  }

  for (const expense of expenses) {
    const period = getEthiopianPeriod(expense.date);
    availableYears.add(period.year);
  }

  for (const record of records) {
    const date = new Date(record.postedAt);

    if (Number.isFinite(date.getTime())) {
      availableYears.add(
        getEthiopianPeriod(date).year,
      );
    }
  }

  for (const record of payrollRecords) {
    const date = new Date(record.paidAt);

    if (Number.isFinite(date.getTime())) {
      availableYears.add(
        getEthiopianPeriod(date).year,
      );
    }
  }

  const years =
    filters?.year !== undefined
      ? [filters.year]
      : Array.from(availableYears).sort(
          (a, b) => a - b,
        );

  const yearlyRows = await Promise.all(
    years.map((year) =>
      getAdminMonthlyFinancials(year),
    ),
  );

  let filteredMonthly = yearlyRows.flat();

  // Apply the selected Ethiopian month.
  if (filters?.month !== undefined) {
    filteredMonthly = filteredMonthly.filter(
      (row) => {
        const rowMonth = Number(
          row.monthKey.split("-")[1],
        );

        return rowMonth === filters.month;
      },
    );
  }

  filteredMonthly.sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey),
  );

  // Calculate totals from exactly the displayed monthly rows.
  const totals: AdminFinanceOverview =
    filteredMonthly.reduce(
      (sum, row) => ({
        totalSales:
          sum.totalSales + row.totalSales,

        vat:
          sum.vat + row.vat,

        grossIncome:
          sum.grossIncome + row.grossIncome,

        totalExpenses:
          sum.totalExpenses + row.expenses,

        expenseVat:
          sum.expenseVat + row.expenseVat,

        expenseWht:
          sum.expenseWht + row.expenseWht,

        royalty:
          sum.royalty + row.royalty,

        netProfit:
          sum.netProfit + row.netProfit,
      }),
      {
        totalSales: 0,
        vat: 0,
        grossIncome: 0,
        totalExpenses: 0,
        expenseVat: 0,
        expenseWht: 0,
        royalty: 0,
        netProfit: 0,
      },
    );

  // Apply the same Ethiopian date range to financial records.
  const filteredRecords = records.filter(
    (record) =>
      matchesEthiopianPeriod(
        record.postedAt,
        filters,
      ),
  );

  // Apply the selected date range to payroll records using paidAt.
  const filteredPayrollRecords =
    payrollRecords.filter((record) =>
      matchesEthiopianPeriod(
        record.paidAt,
        filters,
      ),
    );

  return {
    byMonth: filteredMonthly,
    totals,

    records: filteredRecords.map((record) => ({
      id: record.id,
      recordNumber: record.recordNumber,
      customerName: record.customerName,
      totalPrice: record.totalPrice,
      bank: record.bank,
      postedAt: record.postedAt,
    })),

    payrollRecords: filteredPayrollRecords.map(
      (record) => ({
        id: record.id,
        recordNumber: record.recordNumber,
        payrollPeriod: record.payrollPeriod,
        totalNet: record.totalNet,
        paidAt: record.paidAt,
      }),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* HR Reports                                                          */
/* ------------------------------------------------------------------ */

export async function getAdminHRReport(
  filters?: {
    status?: "active" | "inactive";
    position?: string;
  },
): Promise<AdminHRReportData> {
  const { getHRApiClient } =
    await import("../hr/apiClient");

  const client = await getHRApiClient();

  // Load all employees.
  const allEmployees =
    await client.getEmployees();

  // Apply employee filters.
  let filteredEmployees = allEmployees;

  if (filters?.status) {
    filteredEmployees = filteredEmployees.filter(
      (employee) =>
        filters.status === "active"
          ? employee.is_active
          : !employee.is_active,
    );
  }

  if (filters?.position) {
    filteredEmployees = filteredEmployees.filter(
      (employee) =>
        employee.position === filters.position,
    );
  }

  const active = filteredEmployees.filter(
    (employee) => employee.is_active,
  );

  const inactive = filteredEmployees.filter(
    (employee) => !employee.is_active,
  );

  // Group filtered employees by position.
  const byPositionData: Record<string, number> = {};

  for (const employee of filteredEmployees) {
    const position =
      employee.position || "Unassigned";

    byPositionData[position] =
      (byPositionData[position] ?? 0) + 1;
  }

  // Get today's date using Ethiopia's timezone.
  const today = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Africa/Addis_Ababa",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(new Date());

  const todayAttendance =
    await client.getAttendance({
      date: today,
    });

  const attendance = {
    present: todayAttendance.filter(
      (a) => a.status === "PRESENT",
    ).length,

    absent: todayAttendance.filter(
      (a) => a.status === "ABSENT",
    ).length,

    late: todayAttendance.filter(
      (a) => a.status === "LATE",
    ).length,

    leave: todayAttendance.filter(
      (a) => a.status === "LEAVE",
    ).length,
  };

  // Load payroll runs.
  const runs = await payrollRepository
    .getRuns()
    .catch((error) => {
      console.error(
        "Admin HR Reports: Failed to load payroll:",
        error,
      );

      return [];
    });

  const totalGross = runs.reduce(
    (sum, run) =>
      sum +
      run.employee_records.reduce(
        (employeeSum, employee) =>
          employeeSum + employee.gross_salary,
        0,
      ),
    0,
  );

  const totalDeductions = runs.reduce(
    (sum, run) =>
      sum +
      run.employee_records.reduce(
        (employeeSum, employee) =>
          employeeSum +
          employee.deductions.reduce(
            (deductionSum, deduction) =>
              deductionSum + deduction.amount,
            0,
          ),
        0,
      ),
    0,
  );

  const totalNet = runs.reduce(
    (sum, run) =>
      sum +
      run.employee_records.reduce(
        (employeeSum, employee) =>
          employeeSum + employee.net_salary,
        0,
      ),
    0,
  );

  const statuses: Record<string, number> = {};

  for (const run of runs) {
    statuses[run.status] =
      (statuses[run.status] ?? 0) + 1;
  }

  const leaveRequests =
    leaveRepository.getRequests();

  const pendingLeave = leaveRequests.filter(
    (leave) => leave.status === "PENDING",
  ).length;

  return {
    employees: {
      total: filteredEmployees.length,
      active: active.length,
      inactive: inactive.length,

      byPosition: Object.entries(
        byPositionData,
      ).map(([name, value]) => ({
        name,
        value,
      })),
    },

    attendance,

    payroll: {
      runs: runs.length,
      totalGross,
      totalDeductions,
      totalNet,
      statuses,
    },

    pendingLeave,
  };
}
