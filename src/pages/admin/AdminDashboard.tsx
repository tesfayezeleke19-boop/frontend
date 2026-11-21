
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useAdminSalesOverview,
  useAdminFinanceOverview,
  useAdminHROverview,
  useAdminMonthlyFinancials,
} from "@/hooks/use-admin-data";
import {
  useMonthlyReportOverview,
} from "@/hooks/use-inventory-data";
import { useAdminExpenseReviewSummary } from "@/hooks/use-finance-data";
import {
  TrendingUp,
  DollarSign,
  Receipt,
  Users,
  UserCheck,
  Package,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Wallet,
} from "lucide-react";

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

/**
 * Gets the current Ethiopian calendar year.
 */
function getCurrentEthiopianYear(): number {
  const parts = new Intl.DateTimeFormat(
    "en-US-u-ca-ethiopic-nu-latn",
    {
      year: "numeric",
      timeZone: "Africa/Addis_Ababa",
    },
  ).formatToParts(new Date());

  const yearValue = parts.find(
    (part) => part.type === "year",
  )?.value;

  const year = Number.parseInt(
    yearValue?.replace(/[^\d]/g, "") ?? "",
    10,
  );

  if (!Number.isFinite(year)) {
    throw new Error("Unable to determine the current Ethiopian year.");
  }

  return year;
}

function fmt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0.00";

  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtInt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0";

  return n.toLocaleString("en-US");
}

function KPICard({
  label,
  value,
  icon: Icon,
  color,
  bg,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
}) {
  return (
    <Card className="border-border bg-card shadow-none">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {label}
          </span>

          <div
            className={`flex size-7 items-center justify-center rounded-lg ${bg}`}
          >
            <Icon className={`size-3.5 ${color}`} />
          </div>
        </div>

        <div className="mt-2 font-heading text-xl font-semibold text-foreground">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const currentEthiopianYear = getCurrentEthiopianYear();

  const [year, setYear] = useState<number>(
    () => currentEthiopianYear,
  );

  const [month, setMonth] = useState<number | undefined>(
    undefined,
  );

  const filters = { year, month };

  const sales = useAdminSalesOverview(filters);
  const finance = useAdminFinanceOverview(filters);
  const hr = useAdminHROverview();
  const monthly = useAdminMonthlyFinancials(year, month);

  const monthlyReports = useMonthlyReportOverview();

  // Admin expense workflow review status.
  const adminExpenseReview = useAdminExpenseReviewSummary();

  const loading =
    sales.loading ||
    finance.loading ||
    hr.loading ||
    monthly.loading;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-muted-foreground/70">
          Loading dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header and Ethiopian Date Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Admin Dashboard
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-9 rounded-lg border border-input bg-popover px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet/50"
          >
            {[0, 1, 2, 3, 4].map((offset) => {
              const y = currentEthiopianYear - offset;

              return (
                <option key={y} value={y}>
                  {y} E.C.
                </option>
              );
            })}
          </select>

          <select
            value={month ?? ""}
            onChange={(e) =>
              setMonth(
                e.target.value === ""
                  ? undefined
                  : Number(e.target.value),
              )
            }
            className="h-9 min-w-[125px] rounded-lg border border-input bg-popover px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet/50"
          >
            <option value="">All Months</option>

            {ETHIOPIAN_MONTHS.map((monthName, index) => (
              <option key={monthName} value={index + 1}>
                {monthName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Overall KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard
          label="Total Sales"
          value={`ETB ${fmt(finance.data?.totalSales ?? 0)}`}
          icon={TrendingUp}
          color="text-success"
          bg="bg-success-soft"
        />

        <KPICard
          label="VAT"
          value={`ETB ${fmt(finance.data?.vat ?? 0)}`}
          icon={Receipt}
          color="text-warning"
          bg="bg-warning-soft"
        />

        <KPICard
          label="Gross Income"
          value={`ETB ${fmt(finance.data?.grossIncome ?? 0)}`}
          icon={DollarSign}
          color="text-info"
          bg="bg-info-soft"
        />

        <KPICard
          label="Royalty"
          value={`ETB ${fmt(finance.data?.royalty ?? 0)}`}
          icon={Wallet}
          color="text-violet"
          bg="bg-violet-soft"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard
          label="Total Expenses"
          value={`ETB ${fmt(finance.data?.totalExpenses ?? 0)}`}
          icon={Receipt}
          color="text-destructive"
          bg="bg-destructive-soft"
        />

        <KPICard
          label="Net Profit"
          value={`ETB ${fmt(finance.data?.netProfit ?? 0)}`}
          icon={TrendingUp}
          color="text-success"
          bg="bg-success-soft"
        />

        <KPICard
          label="Total Employees"
          value={fmtInt(hr.data?.totalEmployees ?? 0)}
          icon={Users}
          color="text-warning"
          bg="bg-warning-soft"
        />

        <KPICard
          label="Active Employees"
          value={fmtInt(hr.data?.activeEmployees ?? 0)}
          icon={UserCheck}
          color="text-success"
          bg="bg-success-soft"
        />
      </div>

      {/* Monthly Inventory Reporting and Admin Expense Oversight */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard
          label="Latest Submitted Monthly Report"
          value={
            monthlyReports.data?.latest
              ? `${monthlyReports.data.latest.quantityTotal.toLocaleString()} m³`
              : "—"
          }
          icon={Package}
          color="text-info"
          bg="bg-info-soft"
        />

        <KPICard
          label="Submitted Monthly Reports"
          value={fmtInt(monthlyReports.data?.submittedCount ?? 0)}
          icon={Package}
          color="text-info"
          bg="bg-info-soft"
        />

        <KPICard
          label="Admin Expenses Awaiting Review"
          value={`ETB ${fmt(adminExpenseReview.data?.pendingAmount ?? 0)}`}
          icon={AlertTriangle}
          color={
            adminExpenseReview.data?.pendingReview
              ? "text-warning"
              : "text-success"
          }
          bg={
            adminExpenseReview.data?.pendingReview
              ? "bg-warning-soft"
              : "bg-success-soft"
          }
        />

        <KPICard
          label="Approved Admin Expenses"
          value={fmtInt(adminExpenseReview.data?.approved ?? 0)}
          icon={Clock}
          color={
            adminExpenseReview.data?.rejected
              ? "text-warning"
              : "text-success"
          }
          bg={
            adminExpenseReview.data?.rejected
              ? "bg-warning-soft"
              : "bg-success-soft"
          }
        />
      </div>

      {/* Operational KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KPICard
          label="Latest Reporting Month"
          value={monthlyReports.data?.latest?.label ?? "—"}
          icon={Package}
          color="text-info"
          bg="bg-info-soft"
        />

        <KPICard
          label="Months Not Yet Submitted"
          value={fmtInt(monthlyReports.data?.eligibleMissing ?? 0)}
          icon={
            monthlyReports.data?.eligibleMissing
              ? AlertTriangle
              : CheckCircle2
          }
          color={
            monthlyReports.data?.eligibleMissing
              ? "text-warning"
              : "text-success"
          }
          bg={
            monthlyReports.data?.eligibleMissing
              ? "bg-warning-soft"
              : "bg-success-soft"
          }
        />

        <KPICard
          label="Pending Finance Reviews"
          value={fmtInt(sales.data?.pendingReview ?? 0)}
          icon={Clock}
          color="text-warning"
          bg="bg-warning-soft"
        />
      </div>

      {/* Sales Overview */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Sales Overview
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
            <StatusStat
              label="Total Orders"
              value={sales.data?.totalOrders ?? 0}
            />

            <StatusStat
              label="Pending Review"
              value={sales.data?.pendingReview ?? 0}
              color="text-warning"
            />

            <StatusStat
              label="Approved"
              value={sales.data?.approved ?? 0}
              color="text-success"
            />

            <StatusStat
              label="Rejected"
              value={sales.data?.rejected ?? 0}
              color="text-destructive"
            />

            <StatusStat
              label="Payment Confirmed"
              value={sales.data?.paymentConfirmed ?? 0}
              color="text-info"
            />

            <StatusStat
              label="Total Quantity (m³)"
              value={sales.data?.totalQuantity ?? 0}
            />
          </div>

          {/* Monthly Sales Chart */}
          {sales.data && sales.data.byMonth.length > 0 && (
            <div className="mt-6">
              <h4 className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
                {month
                  ? `${ETHIOPIAN_MONTHS[month - 1]} Sales`
                  : `Monthly Sales (${year} E.C.)`}
              </h4>

              <div
                className="flex items-end gap-2"
                style={{ height: 120 }}
              >
                {sales.data.byMonth.map((m) => {
                  const maxVal = Math.max(
                    ...sales.data!.byMonth.map((x) => x.value),
                    1,
                  );

                  const height = (m.value / maxVal) * 100;

                  return (
                    <div
                      key={m.name}
                      className="flex flex-1 flex-col items-center gap-1"
                    >
                      <span className="font-mono text-[9px] text-muted-foreground/70">
                        {m.value > 0
                          ? `${(m.value / 1000).toFixed(0)}k`
                          : ""}
                      </span>

                      <div
                        className="w-full rounded-t bg-success/60 transition-all"
                        style={{
                          height: `${Math.max(height, 2)}%`,
                          minHeight: 2,
                        }}
                      />

                      <span className="font-mono text-[9px] text-muted-foreground/70">
                        {m.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sales by Aggregate */}
          {sales.data && sales.data.byAggregate.length > 0 && (
            <div className="mt-6">
              <h4 className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
                Sales by Aggregate
              </h4>

              <div
                className="flex items-end gap-3"
                style={{ height: 80 }}
              >
                {sales.data.byAggregate.map((a) => {
                  const maxVal = Math.max(
                    ...sales.data!.byAggregate.map((x) => x.value),
                    1,
                  );

                  const height = (a.value / maxVal) * 100;

                  return (
                    <div
                      key={a.name}
                      className="flex flex-1 flex-col items-center gap-1"
                    >
                      <span className="font-mono text-[9px] text-muted-foreground/70">
                        {a.value > 0
                          ? `${(a.value / 1000).toFixed(0)}k`
                          : ""}
                      </span>

                      <div
                        className="w-full rounded-t bg-info/60 transition-all"
                        style={{
                          height: `${Math.max(height, 2)}%`,
                          minHeight: 2,
                        }}
                      />

                      <span className="font-mono text-[9px] text-foreground">
                        {a.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Financial Overview */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Financial Overview
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <FinStat
              label="Total Sales"
              value={finance.data?.totalSales ?? 0}
            />

            <FinStat
              label="VAT"
              value={finance.data?.vat ?? 0}
            />

            <FinStat
              label="Gross Income"
              value={finance.data?.grossIncome ?? 0}
            />

            <FinStat
              label="Total Expenses"
              value={finance.data?.totalExpenses ?? 0}
            />

            <FinStat
              label="Royalty"
              value={finance.data?.royalty ?? 0}
            />

            <FinStat
              label="Net Profit"
              value={finance.data?.netProfit ?? 0}
              accent
            />
          </div>

          {/* Financial Summary */}
          {finance.data && (
            <div className="mt-6">
              <h4 className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
                Financial Summary
              </h4>

              <div className="space-y-2">
                {[
                  {
                    label: "Total Sales",
                    value: finance.data.totalSales,
                    color: "bg-success",
                  },
                  {
                    label: "Gross Income",
                    value: finance.data.grossIncome,
                    color: "bg-info",
                  },
                  {
                    label: "Expenses",
                    value: finance.data.totalExpenses,
                    color: "bg-destructive",
                  },
                  {
                    label: "Royalty",
                    value: finance.data.royalty,
                    color: "bg-violet",
                  },
                  {
                    label: "Net Profit",
                    value: finance.data.netProfit,
                    color: "bg-success",
                  },
                ].map((item) => {
                  const maxVal = finance.data!.totalSales || 1;
                  const width = Math.max(
                    (item.value / maxVal) * 100,
                    2,
                  );

                  return (
                    <div
                      key={item.label}
                      className="flex items-center gap-3"
                    >
                      <span className="w-24 text-right text-xs text-muted-foreground">
                        {item.label}
                      </span>

                      <div className="flex-1">
                        <div className="h-4 rounded bg-accent">
                          <div
                            className={`h-full rounded ${item.color}/60 transition-all`}
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>

                      <span className="w-28 text-right font-mono text-xs text-foreground">
                        {fmt(item.value)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly Financial Table */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Monthly Financial Data
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                    Month
                  </th>

                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                    Total Sales
                  </th>

                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                    VAT
                  </th>

                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                    Gross Income
                  </th>

                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                    Expenses
                  </th>

                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                    Royalty
                  </th>

                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                    Net Profit
                  </th>
                </tr>
              </thead>

              <tbody>
                {monthly.data?.map((row) => (
                  <tr
                    key={row.monthKey}
                    className="border-b border-border hover:bg-foreground/[0.02]"
                  >
                    <td className="px-4 py-2.5 text-foreground">
                      {row.month}
                    </td>

                    <td className="px-4 py-2.5 text-right font-mono text-success">
                      {row.totalSales > 0
                        ? fmt(row.totalSales)
                        : "—"}
                    </td>

                    <td className="px-4 py-2.5 text-right font-mono text-warning">
                      {row.vat > 0 ? fmt(row.vat) : "—"}
                    </td>

                    <td className="px-4 py-2.5 text-right font-mono text-info">
                      {row.grossIncome > 0
                        ? fmt(row.grossIncome)
                        : "—"}
                    </td>

                    <td className="px-4 py-2.5 text-right font-mono text-destructive">
                      {row.expenses > 0
                        ? fmt(row.expenses)
                        : "—"}
                    </td>

                    <td className="px-4 py-2.5 text-right font-mono text-violet">
                      {row.royalty > 0
                        ? fmt(row.royalty)
                        : "—"}
                    </td>

                    <td
                      className={`px-4 py-2.5 text-right font-mono ${
                        row.netProfit >= 0
                          ? "text-success"
                          : "text-destructive"
                      }`}
                    >
                      {row.totalSales > 0 || row.expenses > 0
                        ? fmt(row.netProfit)
                        : "—"}
                    </td>
                  </tr>
                ))}

                {!monthly.loading &&
                  (!monthly.data || monthly.data.length === 0) && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        No financial data available for this period.
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* HR Overview — unchanged by date filters */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            HR Overview
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
            <StatusStat
              label="Total Employees"
              value={hr.data?.totalEmployees ?? 0}
            />

            <StatusStat
              label="Active"
              value={hr.data?.activeEmployees ?? 0}
              color="text-success"
            />

            <StatusStat
              label="Inactive"
              value={hr.data?.inactiveEmployees ?? 0}
              color="text-destructive"
            />

            <StatusStat
              label="Present Today"
              value={hr.data?.presentToday ?? 0}
              color="text-success"
            />

            <StatusStat
              label="Absent Today"
              value={hr.data?.absentToday ?? 0}
              color="text-destructive"
            />

            <StatusStat
              label="Late Today"
              value={hr.data?.lateToday ?? 0}
              color="text-warning"
            />

            <StatusStat
              label="On Leave"
              value={hr.data?.onLeave ?? 0}
              color="text-info"
            />

            <StatusStat
              label="Pending Leave"
              value={hr.data?.pendingLeave ?? 0}
              color="text-warning"
            />

            <div>
              <div className="text-xs text-muted-foreground">
                Payroll Status
              </div>

              <div className="mt-1">
                <Badge
                  variant="outline"
                  className="border-input bg-popover text-[10px] font-medium text-foreground"
                >
                  {hr.data?.payrollStatus ?? "—"}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusStat({
  label,
  value,
  color = "text-foreground",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">
        {label}
      </div>

      <div className={`mt-1 font-heading text-lg font-semibold ${color}`}>
        {fmtInt(value)}
      </div>
    </div>
  );
}

function FinStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-sidebar p-3">
      <div className="text-xs text-muted-foreground">
        {label}
      </div>

      <div
        className={`mt-1 font-mono text-sm font-medium ${
          accent
            ? value >= 0
              ? "text-success"
              : "text-destructive"
            : "text-foreground"
        }`}
      >
        ETB {fmt(value)}
      </div>
    </div>
  );
}
