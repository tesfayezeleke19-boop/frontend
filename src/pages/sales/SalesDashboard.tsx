
import { useNavigate } from "react-router";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Plus,
  TrendingUp,
  ShoppingCart,
  Clock,
  CheckCircle2,
  XCircle,
  CreditCard,
  ArrowUpRight,
  FileText,
} from "lucide-react";
import { useSalesInvoices } from "@/hooks/use-sales-data";
import {
  ORDER_STATUS,
  ORDER_STATUS_UI,
} from "@/services/sales/types";
import { formatCurrency, formatDate } from "@/services/sales/format";
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_HOVER,
  CHART_PIE_STROKE,
  CHART_SERIES,
  CHART_TICK_FILL,
  CHART_TOOLTIP_STYLE,
} from "@/lib/chartTheme";

const PIE_COLORS = CHART_SERIES;

const tooltipStyle = CHART_TOOLTIP_STYLE;

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
  "en-ET-u-ca-ethiopic-nu-latn",
  {
    year: "numeric",
    month: "numeric",
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

export default function SalesDashboard() {
  const { data: invoices } = useSalesInvoices();

  // All KPI values derive from invoice-level records — one invoice counts
  // exactly once, never once per child order.
  const stats = useMemo(() => {
    const list = invoices ?? [];

    const revenue = list.filter(
      (invoice) =>
        invoice.status === ORDER_STATUS.PENDING_FINANCE_REVIEW ||
        invoice.status === ORDER_STATUS.FINANCE_APPROVED ||
        invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED,
    );

    const totalRevenue = revenue.reduce(
      (sum, invoice) =>
        sum + invoice.financialSummary.totalPriceInclVat,
      0,
    );

    // Sales by actual Ethiopian calendar month.
    const byMonthData: Record<string, number> = {};
    const byAggregateData: Record<string, number> = {};

    for (const invoice of revenue) {
      const period = getEthiopianPeriod(
        new Date(invoice.createdAt),
      );

      const value = invoice.financialSummary.totalPriceInclVat;

      byMonthData[period.key] =
        (byMonthData[period.key] ?? 0) + value;

      for (const order of invoice.orders) {
        byAggregateData[order.aggregate] =
          (byAggregateData[order.aggregate] ?? 0) +
          order.lineTotalExclVat;
      }
    }

    // Build a continuous last-six-Ethiopian-months series.
    const monthSeries: { name: string; value: number }[] = [];

    const currentPeriod = getEthiopianPeriod(new Date());

    const currentIndex =
      currentPeriod.year * 13 + currentPeriod.month - 1;

    for (let i = 5; i >= 0; i--) {
      const periodIndex = currentIndex - i;

      const year = Math.floor(periodIndex / 13);
      const month = (periodIndex % 13) + 1;

      const key = `${year}-${String(month).padStart(2, "0")}`;

      monthSeries.push({
        name: `${ETHIOPIAN_MONTHS[month - 1]} ${year}`,
        value: byMonthData[key] ?? 0,
      });
    }

    return {
      totalRevenue,
      totalInvoices: list.length,
      pendingReview: list.filter(
        (invoice) =>
          invoice.status === ORDER_STATUS.PENDING_FINANCE_REVIEW,
      ).length,
      approved: list.filter(
        (invoice) =>
          invoice.status === ORDER_STATUS.FINANCE_APPROVED,
      ).length,
      rejected: list.filter(
        (invoice) => invoice.status === ORDER_STATUS.REJECTED,
      ).length,
      paymentConfirmed: list.filter(
        (invoice) =>
          invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED,
      ).length,
      byMonth: monthSeries,
      byAggregate: Object.entries(byAggregateData).map(
        ([name, value]) => ({
          name,
          value,
        }),
      ),
    };
  }, [invoices]);

  const recentInvoices = (invoices ?? []).slice(0, 5);
  const navigate = useNavigate();

  const kpis = [
    {
      label: "Total Revenue",
      value: stats ? formatCurrency(stats.totalRevenue) : "—",
      icon: TrendingUp,
      color: "text-success",
    },
    {
      label: "Total Invoices",
      value: stats?.totalInvoices?.toString() ?? "—",
      icon: ShoppingCart,
      color: "text-info",
    },
    {
      label: "Pending Review",
      value: stats?.pendingReview?.toString() ?? "—",
      icon: Clock,
      color: "text-warning",
    },
    {
      label: "Approved",
      value: stats?.approved?.toString() ?? "—",
      icon: CheckCircle2,
      color: "text-success",
    },
    {
      label: "Rejected",
      value: stats?.rejected?.toString() ?? "—",
      icon: XCircle,
      color: "text-destructive",
    },
    {
      label: "Payment Confirmed",
      value: stats?.paymentConfirmed?.toString() ?? "—",
      icon: CreditCard,
      color: "text-info",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Sales Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
          </p>
        </div>

        <Button
          onClick={() => navigate("/sales/new-invoice")}
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          New Sales Invoice
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <Card
            key={kpi.label}
            className="border-border bg-card shadow-none"
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
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

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Sales Trend */}
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              Sales Trend
            </CardTitle>
          </CardHeader>

          <CardContent>
            {stats?.byMonth && stats.byMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.byMonth}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_GRID}
                  />

                  <XAxis
  dataKey="name"
  interval={0}
  angle={-25}
  height={60}
  tickMargin={8}
  tick={{
    fontSize: 10,
    fill: CHART_TICK_FILL,
    textAnchor: "end",
  }}
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
                    formatter={(value: number) =>
                      formatCurrency(value)
                    }
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
                No sales data yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sales by Aggregate */}
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              Sales by Aggregate
            </CardTitle>
          </CardHeader>

          <CardContent>
            {stats?.byAggregate && stats.byAggregate.length > 0 ? (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="50%" height={220}>
                  <PieChart>
                    <Pie
                      data={stats.byAggregate}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      nameKey="name"
                      stroke={CHART_PIE_STROKE}
                    >
                      {stats.byAggregate.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            PIE_COLORS[index % PIE_COLORS.length]
                          }
                        />
                      ))}
                    </Pie>

                    <Tooltip
                      formatter={(value: number) =>
                        formatCurrency(value)
                      }
                      contentStyle={tooltipStyle}
                    />
                  </PieChart>
                </ResponsiveContainer>

                <div className="flex-1 space-y-2">
                  {stats.byAggregate.map((item, i) => (
                    <div
                      key={item.name}
                      className="flex items-center gap-2"
                    >
                      <div
                        className="size-2.5 rounded-sm"
                        style={{
                          backgroundColor:
                            PIE_COLORS[i % PIE_COLORS.length],
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

      {/* Recent Invoices */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-foreground">
            Recent Invoices
          </CardTitle>

          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/sales/transactions")}
          >
            View All
            <ArrowUpRight className="size-3" />
          </Button>
        </CardHeader>

        <CardContent>
          {recentInvoices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="pb-2 pr-4 font-medium">Invoice</th>
                    <th className="pb-2 pr-4 font-medium">Customer</th>
                    <th className="pb-2 pr-4 text-right font-medium">
                      Orders
                    </th>
                    <th className="pb-2 pr-4 text-right font-medium">
                      Total Price
                    </th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Date</th>
                  </tr>
                </thead>

                <tbody>
                  {recentInvoices.map((invoice) => {
                    const status = ORDER_STATUS_UI[invoice.status];

                    return (
                      <tr
                        key={invoice.id}
                        className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                        onClick={() =>
                          navigate(
                            `/sales/transactions/detail/${invoice.id}`,
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
                            className={`border text-[10px] font-medium ${status.className}`}
                          >
                            {status.label}
                          </Badge>
                        </td>

                        <td className="py-2.5 font-mono text-xs text-muted-foreground">
                          {formatDate(invoice.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <FileText className="mb-3 size-8 text-muted-foreground" />

              <p className="text-sm font-medium text-foreground">
                No invoices yet
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Create your first sales invoice to get started.
              </p>

              <Button
                onClick={() => navigate("/sales/new-invoice")}
                className="mt-4 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                size="sm"
              >
                <Plus className="size-3.5" />
                New Sales Invoice
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
