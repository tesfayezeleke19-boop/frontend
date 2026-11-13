
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminFinancialReport } from "@/hooks/use-admin-data";
import {
  TrendingUp,
  DollarSign,
  Receipt,
  Wallet,
} from "lucide-react";

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
 * Returns the current Ethiopian calendar year.
 */
function getCurrentEthiopianYear(): number {
  const formatter = new Intl.DateTimeFormat(
    "en-US-u-ca-ethiopic-nu-latn",
    {
      year: "numeric",
      timeZone: "Africa/Addis_Ababa",
    },
  );

  const year = formatter
    .formatToParts(new Date())
    .find((part) => part.type === "year")?.value;

  return Number.parseInt(year?.replace(/[^\d]/g, "") ?? "", 10);
}

/**
 * Formats Gregorian API/database dates as Ethiopian calendar dates.
 * Date-only strings are interpreted using Ethiopia's local timezone.
 */
function formatEthiopianDate(
  value: string | number | Date | null | undefined,
): string {
  if (!value) return "—";

  let date: Date;

  if (typeof value === "number") {
    date = new Date(value);
  } else if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    date = new Date(`${value}T12:00:00+03:00`);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(
    "en-US-u-ca-ethiopic-nu-latn",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Africa/Addis_Ababa",
    },
  ).format(date);
}

function fmt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0.00";

  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function AdminFinancialReports() {
  const currentEthiopianYear = getCurrentEthiopianYear();

  const [year, setYear] = useState<number | undefined>(undefined);
  const [month, setMonth] = useState<number | undefined>(undefined);

  const filters = { year, month };

  const report = useAdminFinancialReport(
    year !== undefined || month !== undefined
      ? filters
      : undefined,
  );

  const data = report.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Financial Reports
        </h1>

      </div>

      {/* Ethiopian Calendar Filters */}
      <div className="flex items-center gap-3">
        {/* Ethiopian Year */}
        <select
          value={year ?? ""}
          onChange={(e) =>
            setYear(
              e.target.value
                ? Number(e.target.value)
                : undefined,
            )
          }
          className="h-8 rounded-lg border border-input bg-popover px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet/50"
        >
          <option value="">All Years</option>

          {[0, 1, 2].map((offset) => {
            const y = currentEthiopianYear - offset;

            return (
              <option key={y} value={y}>
                {y}
              </option>
            );
          })}
        </select>

        {/* Ethiopian Month */}
        <select
          value={month ?? ""}
          onChange={(e) =>
            setMonth(
              e.target.value
                ? Number(e.target.value)
                : undefined,
            )
          }
          className="h-8 rounded-lg border border-input bg-popover px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet/50"
        >
          <option value="">All Months</option>

          {ETHIOPIAN_MONTH_NAMES.map((name, index) => (
            <option key={index} value={index + 1}>
              {name}
            </option>
          ))}
        </select>

        {/* Clear Filters */}
        {(year !== undefined || month !== undefined) && (
          <button
            onClick={() => {
              setYear(undefined);
              setMonth(undefined);
            }}
            className="h-8 rounded-lg border border-input bg-popover px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Overall KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KPICard
          label="Total Sales"
          value={`ETB ${fmt(data?.totals.totalSales ?? 0)}`}
          icon={TrendingUp}
          color="text-success"
          bg="bg-success-soft"
        />

        <KPICard
          label="VAT"
          value={`ETB ${fmt(data?.totals.vat ?? 0)}`}
          icon={Receipt}
          color="text-warning"
          bg="bg-warning-soft"
        />

        <KPICard
          label="Gross Income"
          value={`ETB ${fmt(data?.totals.grossIncome ?? 0)}`}
          icon={DollarSign}
          color="text-info"
          bg="bg-info-soft"
        />

        <KPICard
          label="Total Expenses"
          value={`ETB ${fmt(data?.totals.totalExpenses ?? 0)}`}
          icon={Receipt}
          color="text-destructive"
          bg="bg-destructive-soft"
        />

        <KPICard
          label="Royalty"
          value={`ETB ${fmt(data?.totals.royalty ?? 0)}`}
          icon={Wallet}
          color="text-violet"
          bg="bg-violet-soft"
        />

        <KPICard
          label="Net Profit"
          value={`ETB ${fmt(data?.totals?.netProfit ?? 0)}`}
          icon={TrendingUp}
          color={
            data && (data.totals?.netProfit ?? 0) >= 0
              ? "text-success"
              : "text-destructive"
          }
          bg={
            data && (data.totals?.netProfit ?? 0) >= 0
              ? "bg-success-soft"
              : "bg-destructive-soft"
          }
        />
      </div>

      {/* Financial Summary */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Financial Summary
          </CardTitle>
        </CardHeader>

        <CardContent>
          {data && (
            <div className="space-y-2">
              {[
                {
                  label: "Total Sales",
                  value: data.totals?.totalSales ?? 0,
                  color: "bg-success",
                },
                {
                  label: "Gross Income",
                  value: data.totals?.grossIncome ?? 0,
                  color: "bg-info",
                },
                {
                  label: "Expenses",
                  value: data.totals?.totalExpenses ?? 0,
                  color: "bg-destructive",
                },
                {
                  label: "Royalty",
                  value: data.totals?.royalty ?? 0,
                  color: "bg-violet",
                },
                {
                  label: "Net Profit",
                  value: data.totals?.netProfit ?? 0,
                  color: "bg-success",
                },
              ].map((item) => {
                const maxVal = data.totals?.totalSales || 1;
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
                      <div className="h-5 rounded bg-accent">
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
          )}
        </CardContent>
      </Card>

      {/* Monthly Breakdown Table */}
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
                    Ethiopian Month
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
                {data?.byMonth.map((row) => (
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
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Financial Records */}
      {data && data.records.length > 0 && (
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Financial Records
            </CardTitle>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Record #
                    </th>

                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Customer
                    </th>

                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                      Amount
                    </th>

                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Bank
                    </th>

                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Ethiopian Date
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {data.records.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border hover:bg-foreground/[0.02]"
                    >
                      <td className="px-4 py-2.5 font-mono text-foreground">
                        {r.recordNumber}
                      </td>

                      <td className="px-4 py-2.5 text-foreground">
                        {r.customerName}
                      </td>

                      <td className="px-4 py-2.5 text-right font-mono text-success">
                        {fmt(r.totalPrice)}
                      </td>

                      <td className="px-4 py-2.5 text-muted-foreground">
                        {r.bank}
                      </td>

                      <td className="px-4 py-2.5 text-muted-foreground">
                        {formatEthiopianDate(r.postedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payroll Financial Records */}
      {data && data.payrollRecords.length > 0 && (
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Payroll Financial Records
            </CardTitle>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Record #
                    </th>

                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Payroll Period
                    </th>

                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                      Amount
                    </th>

                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Ethiopian Date
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {data.payrollRecords.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border hover:bg-foreground/[0.02]"
                    >
                      <td className="px-4 py-2.5 font-mono text-foreground">
                        {r.recordNumber}
                      </td>

                      <td className="px-4 py-2.5 text-foreground">
                        {r.payrollPeriod}
                      </td>

                      <td className="px-4 py-2.5 text-right font-mono text-success">
                        {fmt(r.totalNet)}
                      </td>

                      <td className="px-4 py-2.5 text-muted-foreground">
                        {formatEthiopianDate(r.paidAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
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

        <div className="mt-2 font-heading text-sm font-semibold text-foreground">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
