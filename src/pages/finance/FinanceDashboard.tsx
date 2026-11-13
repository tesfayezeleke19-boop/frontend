
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import {
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  CreditCard,
  ClipboardCheck,
  ArrowUpRight,
  Receipt,
  Banknote,
  Percent,
  Calculator,
  Wallet,
  CalendarDays,
} from "lucide-react";

import { useFinanceSummary } from "@/hooks/use-finance-data";
import { ORDER_STATUS_UI } from "@/services/sales/types";
import {
  formatCurrency,
  formatDate,
} from "@/services/sales/format";

/* ------------------------------------------------------------------ */
/* Ethiopian calendar helpers                                          */
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

function getCurrentEthiopianPeriod() {
  const formatter = new Intl.DateTimeFormat(
    "en-US-u-ca-ethiopic-nu-latn",
    {
      year: "numeric",
      month: "numeric",
      timeZone: "Africa/Addis_Ababa",
    },
  );

  const parts = formatter.formatToParts(new Date());

  return {
    year: Number(
      parts.find((part) => part.type === "year")?.value,
    ),
    month: Number(
      parts.find((part) => part.type === "month")?.value,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export default function FinanceDashboard() {
  const navigate = useNavigate();

  // Default to the current Ethiopian year and month.
  const currentPeriod = useMemo(
    () => getCurrentEthiopianPeriod(),
    [],
  );

  const [selectedYear, setSelectedYear] = useState(
    currentPeriod.year,
  );

  const [selectedMonth, setSelectedMonth] = useState<number | null>(
    currentPeriod.month,
  );

  const { data: stats, loading, error } = useFinanceSummary(
    selectedYear,
    selectedMonth,
  );

  const yearOptions = useMemo(
    () =>
      Array.from(
        { length: 7 },
        (_, index) => currentPeriod.year - 5 + index,
      ),
    [currentPeriod.year],
  );

  /* -------------------------------------------------------------- */
  /* Financial KPI cards                                             */
  /* -------------------------------------------------------------- */

  const financialKpis = [
    {
      label: "Total Sales",
      value: stats ? formatCurrency(stats.totalSales) : "—",
      icon: Banknote,
      color: "text-blue-500",
      description: "Approved + payment-confirmed sales",
    },
    {
      label: "VAT",
      value: stats ? formatCurrency(stats.vat) : "—",
      icon: Percent,
      color: "text-amber-500",
      description: "VAT extracted from Total Sales",
    },
    {
      label: "Gross Income",
      value: stats ? formatCurrency(stats.grossIncome) : "—",
      icon: TrendingUp,
      color: "text-emerald-500",
      description: "Total Sales − VAT",
    },
    {
      label: "Royalty",
      value: stats ? formatCurrency(stats.royalty) : "—",
      icon: Calculator,
      color: "text-violet-500",
      description: "3% of eligible VAT-exclusive order lines",
    },
    {
      label: "Total Expenses",
      value: stats ? formatCurrency(stats.totalExpenses) : "—",
      icon: Receipt,
      color: "text-red-500",
      description: "Counted operational expenses",
    },
    {
      label: "Net Profit",
      value: stats ? formatCurrency(stats.netProfit) : "—",
      icon: Wallet,
      color:
        stats && stats.netProfit >= 0
          ? "text-emerald-500"
          : "text-red-500",
      description: "Gross Income − Expenses − Royalty",
    },
  ];

  /* -------------------------------------------------------------- */
  /* Operational KPI cards                                           */
  /* -------------------------------------------------------------- */

  const operationalKpis = [
    {
      label: "Pending Approvals",
      value: stats?.pendingApprovals?.toString() ?? "—",
      icon: Clock,
      color: "text-amber-500",
    },
    {
      label: "Approved",
      value: stats?.approved?.toString() ?? "—",
      icon: CheckCircle2,
      color: "text-emerald-500",
    },
    {
      label: "Rejected",
      value: stats?.rejected?.toString() ?? "—",
      icon: XCircle,
      color: "text-red-500",
    },
    {
      label: "Payment Confirmed",
      value: stats?.confirmedPayments?.toString() ?? "—",
      icon: CreditCard,
      color: "text-blue-500",
    },
  ];

  const selectedPeriodLabel =
    selectedMonth === null
      ? `All months · ${selectedYear}`
      : `${ETHIOPIAN_MONTHS[selectedMonth - 1]} ${selectedYear}`;

  /* -------------------------------------------------------------- */
  /* Render                                                          */
  /* -------------------------------------------------------------- */

  return (
    <div className="space-y-6 text-foreground">
      {/* Page Header and compact period filters */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Finance Dashboard
          </h1>

          <p className="mt-1 text-sm text-muted-foreground">
            Financial overview for {selectedPeriodLabel}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Ethiopian year */}
          <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2.5">
            <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />

            <span className="text-xs text-muted-foreground">
              Year
            </span>

            <select
              value={selectedYear}
              onChange={(event) => {
                setSelectedYear(Number(event.target.value));
              }}
              className="h-7 min-w-[76px] cursor-pointer border-0 bg-transparent text-xs font-medium text-foreground outline-none"
              aria-label="Select Ethiopian year"
            >
              {yearOptions.map((year) => (
                <option
                  key={year}
                  value={year}
                  className="bg-background text-foreground"
                >
                  {year}
                </option>
              ))}
            </select>
          </div>

          {/* Ethiopian month */}
          <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2.5">
            <span className="text-xs text-muted-foreground">
              Month
            </span>

            <select
              value={selectedMonth ?? "all"}
              onChange={(event) => {
                const value = event.target.value;

                setSelectedMonth(
                  value === "all" ? null : Number(value),
                );
              }}
              className="h-7 min-w-[112px] cursor-pointer border-0 bg-transparent text-xs font-medium text-foreground outline-none"
              aria-label="Select Ethiopian month"
            >
              <option value="all">
                All Months
              </option>

              {ETHIOPIAN_MONTHS.map((month, index) => (
                <option
                  key={month}
                  value={index + 1}
                >
                  {month}
                </option>
              ))}
            </select>
          </div>

          {stats && stats.pendingApprovals > 0 && (
            <Button
              onClick={() => navigate("/finance/review")}
              size="sm"
              className="h-9 gap-2"
            >
              <ClipboardCheck className="size-4" />
              Review Approvals
            </Button>
          )}
        </div>
      </div>

      {/* Loading and error states */}
      {loading && !stats && (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Loading finance information...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load finance information: {error.message}
        </div>
      )}

      {/* Financial KPI Cards */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Financial Summary
          </h2>

          <span className="text-[10px] text-muted-foreground">
            {selectedPeriodLabel}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {financialKpis.map((kpi) => (
            <Card
              key={kpi.label}
              className="border-border bg-card shadow-none"
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {kpi.label}
                  </span>

                  <kpi.icon className={`size-4 shrink-0 ${kpi.color}`} />
                </div>

                <div className="mt-2 break-words text-base font-semibold tabular-nums text-foreground xl:text-lg">
                  {kpi.value}
                </div>

                <div className="mt-1 text-[10px] text-muted-foreground">
                  {kpi.description}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Financial Breakdown */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-card-foreground">
            Financial Breakdown
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">
                Total Sales (VAT-inclusive)
              </span>

              <span className="font-medium tabular-nums text-blue-500">
                {stats ? formatCurrency(stats.totalSales) : "—"}
              </span>
            </div>

            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">
                VAT (15%)
              </span>

              <span className="tabular-nums text-amber-500">
                − {stats ? formatCurrency(stats.vat) : "—"}
              </span>
            </div>

            <Separator className="bg-border" />

            <div className="flex justify-between gap-4 text-sm">
              <span className="font-medium text-foreground">
                Gross Income
              </span>

              <span className="font-medium tabular-nums text-emerald-500">
                {stats ? formatCurrency(stats.grossIncome) : "—"}
              </span>
            </div>

            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">
                Royalty (3% of eligible order lines)
              </span>

              <span className="tabular-nums text-violet-500">
                − {stats ? formatCurrency(stats.royalty) : "—"}
              </span>
            </div>

            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">
                Total Expenses
              </span>

              <span className="tabular-nums text-red-500">
                − {stats ? formatCurrency(stats.totalExpenses) : "—"}
              </span>
            </div>

            <Separator className="bg-border" />

            <div className="flex justify-between gap-4 text-sm">
              <span className="font-medium text-foreground">
                Net Profit
              </span>

              <span
                className={`text-lg font-semibold tabular-nums ${
                  stats && stats.netProfit >= 0
                    ? "text-emerald-500"
                    : "text-red-500"
                }`}
              >
                {stats ? formatCurrency(stats.netProfit) : "—"}
              </span>
            </div>

            <p className="pt-1 text-[10px] text-muted-foreground">
              Net Profit = Gross Income − Total Expenses − Royalty.
              Expense VAT and withholding are informational and are not
              deducted a second time.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Operational KPI Cards */}
      <div>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Sales Review & Payments
        </h2>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {operationalKpis.map((kpi) => (
            <Card
              key={kpi.label}
              className="border-border bg-card shadow-none"
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {kpi.label}
                  </span>

                  <kpi.icon className={`size-4 ${kpi.color}`} />
                </div>

                <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">
                  {kpi.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Summary Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Sales Review Summary */}
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-medium text-card-foreground">
              Sales Review Summary
            </CardTitle>

            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => navigate("/finance/review")}
            >
              Open Review
              <ArrowUpRight className="size-3" />
            </Button>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: "Pending",
                  value: stats?.review.pending ?? "—",
                  color: "text-amber-500",
                },
                {
                  label: "Approved",
                  value: stats?.review.approved ?? "—",
                  color: "text-emerald-500",
                },
                {
                  label: "Rejected",
                  value: stats?.review.rejected ?? "—",
                  color: "text-red-500",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-border bg-muted/40 p-3"
                >
                  <div
                    className={`text-lg font-semibold tabular-nums ${item.color}`}
                  >
                    {item.value}
                  </div>

                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {item.label}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Approval rate
              </span>

              <span className="font-mono text-sm font-medium tabular-nums text-foreground">
                {stats ? `${stats.review.approvalRate}%` : "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Payment Summary */}
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-medium text-card-foreground">
              Payment Summary
            </CardTitle>

            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => navigate("/finance/payments")}
            >
              Payment Queue
              <ArrowUpRight className="size-3" />
            </Button>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Pending Amount
                </div>

                <div className="mt-1 break-words text-lg font-semibold tabular-nums text-amber-500">
                  {stats
                    ? formatCurrency(stats.payments.pendingAmount)
                    : "—"}
                </div>

                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {stats?.payments.pendingCount ?? "—"} invoices
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Confirmed Amount
                </div>

                <div className="mt-1 break-words text-lg font-semibold tabular-nums text-emerald-500">
                  {stats
                    ? formatCurrency(stats.payments.confirmedAmount)
                    : "—"}
                </div>

                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {stats?.payments.confirmedCount ?? "—"} invoices
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Pending Reviews */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-card-foreground">
            Awaiting Finance Review
          </CardTitle>

          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/finance/review")}
          >
            View All
            <ArrowUpRight className="size-3" />
          </Button>
        </CardHeader>

        <CardContent>
          {stats?.recentPending && stats.recentPending.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">
                      Invoice
                    </th>

                    <th className="pb-2 pr-4 font-medium">
                      Customer
                    </th>

                    <th className="pb-2 pr-4 text-right font-medium">
                      Orders
                    </th>

                    <th className="pb-2 pr-4 text-right font-medium">
                      Amount
                    </th>

                    <th className="pb-2 pr-4 font-medium">
                      Status
                    </th>

                    <th className="pb-2 font-medium">
                      Submitted
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {stats.recentPending.map((invoice) => {
                    const status = ORDER_STATUS_UI[invoice.status];

                    return (
                      <tr
                        key={invoice.id}
                        className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                        onClick={() =>
                          navigate(
                            `/finance/review/detail/${invoice.id}`,
                          )
                        }
                      >
                        <td className="py-2.5 pr-4 font-mono text-xs font-medium text-foreground">
                          {invoice.invoiceNumber}
                        </td>

                        <td className="py-2.5 pr-4 text-muted-foreground">
                          {invoice.customer.name}
                        </td>

                        <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                          {invoice.orders.length}
                        </td>

                        <td className="py-2.5 pr-4 text-right font-medium tabular-nums text-foreground">
                          {formatCurrency(
                            invoice.financialSummary.totalPriceInclVat,
                          )}
                        </td>

                        <td className="py-2.5 pr-4">
                          <Badge
                            variant="outline"
                            className="border-border text-[10px] font-medium"
                          >
                            {status.label}
                          </Badge>
                        </td>

                        <td className="py-2.5 font-mono text-xs text-muted-foreground">
                          {formatDate(
                            invoice.submittedAt ?? invoice.createdAt,
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="mb-3 size-8 text-muted-foreground/40" />

              <p className="text-sm font-medium text-foreground">
                No invoices awaiting review
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Submitted Sales Invoices will appear here for approval.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
