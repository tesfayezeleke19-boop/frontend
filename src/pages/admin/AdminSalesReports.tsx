
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminSalesReport } from "@/hooks/use-admin-data";
import {
  TrendingUp,
  Package,
  CheckCircle2,
  XCircle,
  Clock,
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

function getCurrentEthiopianYear(): number {
  const parts = new Intl.DateTimeFormat(
    "en-US-u-ca-ethiopic-nu-latn",
    {
      year: "numeric",
      timeZone: "Africa/Addis_Ababa",
    },
  ).formatToParts(new Date());

  const yearValue = parts.find((part) => part.type === "year")?.value;
  const year = Number.parseInt(yearValue ?? "", 10);

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

export default function AdminSalesReports() {
  const currentEthiopianYear = getCurrentEthiopianYear();

  const [year, setYear] = useState<number | undefined>(undefined);
  const [month, setMonth] = useState<number | undefined>(undefined);

  const filters = { year, month };

  const report = useAdminSalesReport(
    year !== undefined || month !== undefined ? filters : undefined,
  );

  const data = report.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Sales Reports
        </h1>
      </div>

      {/* Ethiopian Calendar Filters */}
      <div className="flex items-center gap-3">
        <select
          value={year ?? ""}
          onChange={(e) =>
            setYear(e.target.value ? Number(e.target.value) : undefined)
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

        <select
          value={month ?? ""}
          onChange={(e) =>
            setMonth(e.target.value ? Number(e.target.value) : undefined)
          }
          className="h-8 rounded-lg border border-input bg-popover px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet/50"
        >
          <option value="">All Months</option>

          {ETHIOPIAN_MONTH_NAMES.map((name, i) => (
            <option key={i + 1} value={i + 1}>
              {name}
            </option>
          ))}
        </select>

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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KPICard
          label="Total Sales"
          value={`ETB ${fmt(data?.totalSales ?? 0)}`}
          icon={TrendingUp}
          color="text-success"
          bg="bg-success-soft"
        />

        <KPICard
          label="Approved Sales"
          value={`ETB ${fmt(data?.approvedSales ?? 0)}`}
          icon={CheckCircle2}
          color="text-success"
          bg="bg-success-soft"
        />

        <KPICard
          label="Rejected Sales"
          value={`ETB ${fmt(data?.rejectedSales ?? 0)}`}
          icon={XCircle}
          color="text-destructive"
          bg="bg-destructive-soft"
        />

        <KPICard
          label="Pending Review"
          value={`ETB ${fmt(data?.pendingReview ?? 0)}`}
          icon={Clock}
          color="text-warning"
          bg="bg-warning-soft"
        />

        <KPICard
          label="Total Quantity"
          value={`${fmtInt(data?.totalQuantity ?? 0)} m³`}
          icon={Package}
          color="text-info"
          bg="bg-info-soft"
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Sales by Ethiopian Month */}
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Sales by Ethiopian Month
            </CardTitle>
          </CardHeader>

          <CardContent>
            {data && data.byMonth.length > 0 ? (
              <div className="flex items-end gap-2" style={{ height: 140 }}>
                {data.byMonth.map((m) => {
                  const maxVal = Math.max(
                    ...data.byMonth.map((x) => x.value),
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
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground/70">
                No data
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sales by Aggregate */}
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Sales by Aggregate
            </CardTitle>
          </CardHeader>

          <CardContent>
            {data && data.byAggregate.length > 0 ? (
              <div className="flex items-end gap-3" style={{ height: 140 }}>
                {data.byAggregate.map((a) => {
                  const maxVal = Math.max(
                    ...data.byAggregate.map((x) => x.value),
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
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground/70">
                No data
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Orders by Status */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Orders by Status
          </CardTitle>
        </CardHeader>

        <CardContent>
          {data && data.byStatus.length > 0 ? (
            <div className="space-y-2">
              {data.byStatus.map((s) => {
                const maxVal = Math.max(
                  ...data.byStatus.map((x) => x.value),
                  1,
                );

                const width = Math.max((s.value / maxVal) * 100, 2);

                const colorMap: Record<string, string> = {
                  Draft: "bg-muted",
                  "Pending Review": "bg-warning",
                  Approved: "bg-success",
                  Rejected: "bg-destructive",
                  "Payment Confirmed": "bg-info",
                };

                return (
                  <div key={s.name} className="flex items-center gap-3">
                    <span className="w-32 text-right text-xs text-muted-foreground">
                      {s.name}
                    </span>

                    <div className="flex-1">
                      <div className="h-5 rounded bg-accent">
                        <div
                          className={`h-full rounded ${
                            colorMap[s.name] ?? "bg-muted"
                          } transition-all`}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>

                    <span className="w-10 text-right font-mono text-xs text-foreground">
                      {fmtInt(s.value)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground/70">
              No data
            </div>
          )}
        </CardContent>
      </Card>
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
