import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmInvoicePaymentDialog } from "@/components/finance/OrderActionDialogs";
import {
  CreditCard,
  Eye,
  Hourglass,
  Loader2,
  Wallet,
} from "lucide-react";
import { useSalesInvoices } from "@/hooks/use-sales-data";
import { formatCurrency, formatDate } from "@/services/sales/format";
import { ORDER_STATUS, ORDER_STATUS_UI } from "@/services/sales/types";
import type { SalesInvoice } from "@/services/sales/invoice";

export default function Payments() {
  const navigate = useNavigate();
  const [confirmInvoice, setConfirmInvoice] = useState<SalesInvoice | null>(
    null,
  );
  const { data: invoices, loading } = useSalesInvoices();

  const approved = (invoices ?? []).filter(
    (invoice) => invoice.status === ORDER_STATUS.FINANCE_APPROVED,
  );
  const totalPending = approved.reduce(
    (sum, invoice) => sum + invoice.financialSummary.totalPriceInclVat,
    0,
  );

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
            Payments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Approved invoices whose payment has not been confirmed yet.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <Wallet className="size-4 text-info" />
          <span className="text-sm font-medium tabular-nums text-foreground">
            {formatCurrency(totalPending)} pending
          </span>
        </div>
      </div>

      {/* Queue Table */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="p-0">
          {approved.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">Invoice</th>
                    <th className="px-4 py-2.5 font-medium">Customer</th>
                    <th className="px-4 py-2.5 text-right font-medium">Orders</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 font-medium">Bank</th>
                    <th className="px-4 py-2.5 font-medium">Approved</th>
                    <th className="px-4 py-2.5 font-medium">Approved By</th>
                    <th className="px-4 py-2.5 font-medium">Payment Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {approved.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                      onClick={() =>
                        navigate(`/finance/review/detail/${invoice.id}`, {
                          state: { from: "/finance/payments" },
                        })
                      }
                    >
                      <td className="px-4 py-2.5 font-mono text-xs font-medium text-foreground">
                        {invoice.invoiceNumber}
                      </td>
                      <td className="px-4 py-2.5 text-foreground">
                        {invoice.customer.name}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {invoice.orders.length}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">
                        {formatCurrency(invoice.financialSummary.totalPriceInclVat)}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {invoice.payment.bank || "—"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {invoice.approvedAt ? formatDate(invoice.approvedAt) : "—"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {invoice.approvedBy || "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant="outline"
                          className={`border text-[10px] font-medium ${ORDER_STATUS_UI[invoice.status].className}`}
                        >
                          {ORDER_STATUS_UI[invoice.status].label}
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
                              navigate(
                                `/finance/review/detail/${invoice.id}`,
                                { state: { from: "/finance/payments" } },
                              );
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
                              setConfirmInvoice(invoice);
                            }}
                          >
                            <CreditCard className="size-3" />
                            Confirm Payment
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Hourglass className="mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                No payments pending
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Approved invoices will appear here until payment is confirmed.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm Payment Dialog */}
      <ConfirmInvoicePaymentDialog
        invoice={confirmInvoice}
        open={!!confirmInvoice}
        onOpenChange={(open) => !open && setConfirmInvoice(null)}
      />
    </div>
  );
}
