import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ApproveInvoiceDialog,
  RejectInvoiceDialog,

  
} from "@/components/finance/OrderActionDialogs";
import {
  Search,
  CheckCircle2,
  XCircle,
  Eye,
  ClipboardCheck,
  Loader2,
} from "lucide-react";
import { useSalesInvoices } from "@/hooks/use-sales-data";
import { formatCurrency, formatDate } from "@/services/sales/format";
import {
  ORDER_STATUS,
  ORDER_STATUS_UI,
} from "@/services/sales/types";
import type { SalesInvoice } from "@/services/sales/invoice";

type ActionState =
  | { invoice: SalesInvoice; type: "approve" }
  | { invoice: SalesInvoice; type: "reject" }
  | null;

export default function SalesReview() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<ActionState>(null);
  const { data: invoices, loading } = useSalesInvoices();

  const pending = useMemo(() => {
    const list = (invoices ?? []).filter(
      (invoice) => invoice.status === ORDER_STATUS.PENDING_FINANCE_REVIEW,
    );
    const query = search.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (invoice) =>
        invoice.invoiceNumber.toLowerCase().includes(query) ||
        invoice.customer.name.toLowerCase().includes(query) ||
        invoice.fsNo.toLowerCase().includes(query),
    );
  }, [invoices, search]);

  if (loading && !invoices) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Sales Review
          </h1>
          
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <ClipboardCheck className="size-4 text-warning" />
          <span className="text-sm font-medium text-foreground">
            {pending.length} pending
          </span>
        </div>
      </div>

      {/* Search */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by invoice number, customer, FS No..."
              className="h-9 border-input bg-popover pl-9 text-sm text-foreground placeholder:text-muted-foreground/70"
            />
          </div>
        </CardContent>
      </Card>

      {/* Queue Table */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="p-0">
          {pending.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">Invoice</th>
                    <th className="px-4 py-2.5 font-medium">Customer</th>
                    <th className="px-4 py-2.5 font-medium">FS No</th>
                    <th className="px-4 py-2.5 text-right font-medium">Orders</th>
                    <th className="px-4 py-2.5 text-right font-medium">Qty (m³)</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Total Price
                    </th>
                    <th className="px-4 py-2.5 font-medium">Bank</th>
                    <th className="px-4 py-2.5 font-medium">Submitted</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((invoice) => {
                    const status = ORDER_STATUS_UI[invoice.status];
                    const totalQuantity = invoice.orders.reduce(
                      (sum, order) => sum + order.quantity,
                      0,
                    );
                    return (
                      <tr
                        key={invoice.id}
                        className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                        onClick={() =>
                          navigate(`/finance/review/detail/${invoice.id}`)
                        }
                      >
                        <td className="px-4 py-2.5 font-mono text-xs font-medium text-foreground">
                          {invoice.invoiceNumber}
                        </td>
                        <td className="px-4 py-2.5 text-foreground">
                          {invoice.customer.name}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {invoice.fsNo || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                          {invoice.orders.length}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {totalQuantity.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">
                          {formatCurrency(invoice.financialSummary.totalPriceInclVat)}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {invoice.payment.bank || "—"}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {formatDate(invoice.submittedAt ?? invoice.createdAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`border text-[10px] font-medium ${status.className}`}
                          >
                            {status.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/finance/review/detail/${invoice.id}`);
                              }}
                            >
                              <Eye className="size-3" />
                              View
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 gap-1 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAction({ invoice, type: "approve" });
                              }}
                            >
                              <CheckCircle2 className="size-3" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 gap-1 border border-destructive-border bg-destructive-soft text-xs text-destructive hover:bg-destructive-soft"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAction({ invoice, type: "reject" });
                              }}
                            >
                              <XCircle className="size-3" />
                              Reject
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCircle2 className="mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                {search
                  ? "No matching invoices"
                  : "No invoices pending review"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {search
                  ? "Try a different search term."
                  : "Submitted Sales Invoices will appear here for approval."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Dialogs */}
      <ApproveInvoiceDialog
        invoice={action?.type === "approve" ? action.invoice : null}
        open={action?.type === "approve"}
        onOpenChange={(open) => !open && setAction(null)}
      />
      <RejectInvoiceDialog
        invoice={action?.type === "reject" ? action.invoice : null}
        open={action?.type === "reject"}
        onOpenChange={(open) => !open && setAction(null)}
      />
    </div>
  );
}
