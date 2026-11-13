import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertTriangle,
  Clock,
  FileWarning,
  Package,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useAdminSalesOverview, useAdminFinanceOverview } from "@/hooks/use-admin-data";
import { useInventorySummary } from "@/hooks/use-inventory-data";
import { formatCurrency } from "@/services/sales/format";

/**
 * Admin Monitoring — operational signals derived from REAL application data
 * (pending reviews, inventory inconsistencies, missing evidence). No
 * fabricated server health or uptime metrics.
 */
export default function AdminMonitoring() {
  const sales = useAdminSalesOverview();
  const finance = useAdminFinanceOverview();
  const inventory = useInventorySummary();

  const loading = sales.loading || finance.loading || inventory.loading;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  const pendingReviews = sales.data?.pendingReview ?? 0;
  const stuckRevenue = sales.data?.totalInvoices === 0;
  const inventoryExceptions = inventory.data?.inconsistentRecords ?? [];
  const royalty = finance.data?.royalty ?? 0;

  const signals: {
    title: string;
    detail: string;
    tone: "warn" | "info" | "ok";
    path?: string;
  }[] = [
    pendingReviews > 0
      ? {
          title: `${pendingReviews} invoice${pendingReviews === 1 ? "" : "s"} awaiting Finance review`,
          detail: "Sales submitted invoices pending approval.",
          tone: "warn",
          path: "/admin/sales-reports",
        }
      : {
          title: "No invoices awaiting review",
          detail: "The Finance review queue is clear.",
          tone: "ok",
        },
    ...(inventoryExceptions.length > 0
      ? [
          {
            title: `${inventoryExceptions.length} inventory record${inventoryExceptions.length === 1 ? "" : "s"} with inconsistent quantities`,
            detail:
              "Unsold quantity does not equal original minus sold. Finance should correct these records.",
            tone: "warn" as const,
            path: "/admin/inventory-reports",
          },
        ]
      : [
          {
            title: "Inventory quantities consistent",
            detail: "All unsold records satisfy unsold = original − sold.",
            tone: "ok" as const,
          },
        ]),
    ...(stuckRevenue
      ? [
          {
            title: "No sales transactions recorded yet",
            detail:
              "The Sales module has no invoices. Reports will show honest empty states until data exists.",
            tone: "info" as const,
            path: "/admin/sales-reports",
          },
        ]
      : []),
    {
      title: `Royalty obligation in current data: ${formatCurrency(royalty)}`,
      detail: "3% of approved VAT-exclusive order totals.",
      tone: "info",
      path: "/admin/financial-reports",
    },
  ];

  const toneStyles = {
    warn: "border-warning-border bg-warning-soft",
    info: "border-border bg-card",
    ok: "border-success-border bg-success-soft",
  };
  const toneIcons = { warn: AlertTriangle, info: Activity, ok: CheckCircle2 };
  const toneColors = {
    warn: "text-warning",
    info: "text-info",
    ok: "text-success",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Monitoring
        </h1>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Pending Reviews
              </span>
              <Clock className={`size-3.5 ${pendingReviews > 0 ? "text-warning" : "text-success"}`} />
            </div>
            <div className="mt-2 font-heading text-xl font-semibold text-foreground">
              {pendingReviews}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground">
              Inventory Exceptions
            </span>
            <div className="mt-2 font-heading text-xl font-semibold text-foreground">
              {inventoryExceptions.length}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Inventory Records
              </span>
              <Package className="size-3.5 text-info" />
            </div>
            <div className="mt-2 font-heading text-xl font-semibold text-foreground">
              {inventory.data?.totalRecords ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Rejected
              </span>
              <FileWarning className="size-3.5 text-destructive" />
            </div>
            <div className="mt-2 font-heading text-xl font-semibold text-foreground">
              {sales.data?.rejected ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Signals */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Operational Signals
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {signals.map((signal, index) => {
            const Icon = toneIcons[signal.tone];
            const content = (
              <div
                className={`flex items-start gap-3 rounded-lg border p-3 ${toneStyles[signal.tone]}`}
              >
                <Icon className={`mt-0.5 size-4 shrink-0 ${toneColors[signal.tone]}`} />
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {signal.title}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {signal.detail}
                  </div>
                </div>
                {signal.path && (
                  <Badge variant="outline" className="shrink-0 border-input bg-popover text-[10px] text-muted-foreground">
                    View
                  </Badge>
                )}
              </div>
            );
            return signal.path ? (
              <Link key={index} to={signal.path} className="block">
                {content}
              </Link>
            ) : (
              <div key={index}>{content}</div>
            );
          })}
        </CardContent>
      </Card>

      {/* Honest limitation note */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground/70">
            Backend-dependent monitoring (server health, API uptime, background
            jobs) will appear here once the PHP backend exists. This page only
            reports what the application can actually measure.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
