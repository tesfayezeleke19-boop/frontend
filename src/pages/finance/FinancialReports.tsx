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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Banknote, Landmark, Percent, Calculator } from "lucide-react";
import { useFinancialReports } from "@/hooks/use-finance-data";
import { formatCurrency } from "@/services/sales/format";
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_HOVER,
  CHART_PIE_STROKE,
  CHART_SERIES_8,
  CHART_TICK_FILL,
  CHART_TOOLTIP_STYLE,
} from "@/lib/chartTheme";

const PIE_COLORS = CHART_SERIES_8;

const tooltipStyle = CHART_TOOLTIP_STYLE;

export default function FinancialReports() {
  const { data: reports } = useFinancialReports();

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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Financial Reports
        </h1>
        
      </div>

      {/* Totals */}
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

      {/* Revenue by date + aggregate */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">
              Revenue by Date
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reports?.byMonth && reports.byMonth.some((m) => m.value > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={reports.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: CHART_TICK_FILL }}
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
                  <Bar dataKey="value" fill={PIE_COLORS[0]} radius={[4, 4, 0, 0]} />
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

      {/* Revenue by bank + customer */}
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
                          ? Math.round((item.value / reports.totals.totalSales) * 100)
                          : 0;
                      return (
                        <tr
                          key={item.name}
                          className="border-b border-border last:border-0"
                        >
                          <td className="py-2.5 text-foreground">{item.name}</td>
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
                        <td className="py-2.5 text-foreground">{item.name}</td>
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

      {/* Payment totals */}
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
    </div>
  );
}
