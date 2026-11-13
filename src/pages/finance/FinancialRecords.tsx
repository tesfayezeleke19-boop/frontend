import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText,
  Eye,
  Loader2,
  Info,
  ReceiptText,
  Landmark,
} from "lucide-react";
import {
  useConfirmedRecordTotals,
  useFinancialRecords,
} from "@/hooks/use-finance-data";
import type { FinancialRecord } from "@/services/finance";
import { FINANCIAL_RECORD_STATUS_LABELS } from "@/services/finance";
import { formatCurrency, formatDate, formatQuantity } from "@/services/sales/format";

export default function FinancialRecords() {
  const navigate = useNavigate();
  const { data: records, loading } = useFinancialRecords();
  const { data: totals } = useConfirmedRecordTotals();
  const [selected, setSelected] = useState<FinancialRecord | null>(null);

  if (loading && !records) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  const stats = [
    {
      label: "Total Records",
      value: totals?.count?.toString() ?? records?.length?.toString() ?? "—",
      icon: ReceiptText,
    },
    {
      label: "Total Amount",
      value: totals ? formatCurrency(totals.totalAmount) : "—",
      icon: Landmark,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Financial Records
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Records created when a confirmed Sales payment is posted.
          </p>
        </div>
      </div>

      {/* Development note */}
      <div className="flex items-start gap-3 rounded-lg border border-input bg-card p-3.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-info" />
        <p className="leading-relaxed">
          These are <span className="font-medium text-foreground">mock financial records</span> for
          frontend development only — not a real accounting ledger. The future
          PHP/ERPNext backend will own authoritative, double-entry accounting;
          this page simply represents the workflow and the correct data
          relationship to each Sales Order.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card
            key={stat.label}
            className="border-border bg-card shadow-none"
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {stat.label}
                </span>
                <stat.icon className="size-4 text-muted-foreground/70" />
              </div>
              <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">
                {stat.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Records Table */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Records ({records?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {records && records.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">Record</th>
                    <th className="px-4 py-2.5 font-medium">Order</th>
                    <th className="px-4 py-2.5 font-medium">Customer</th>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Bank</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Amount
                    </th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr
                      key={record.id}
                      className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                      onClick={() => setSelected(record)}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs font-medium text-info">
                        {record.recordNumber}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs font-medium text-foreground">
                        {record.sourceOrderNumber}
                      </td>
                      <td className="px-4 py-2.5 text-foreground">
                        {record.customerName}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {formatDate(record.postedAt)}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {record.bank}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">
                        {formatCurrency(record.totalPrice)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant="outline"
                          className="erp-badge-approved border text-[10px] font-medium"
                        >
                          {FINANCIAL_RECORD_STATUS_LABELS[record.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(record);
                          }}
                        >
                          <Eye className="size-3" />
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText className="mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                No financial records yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Confirming a payment in the Payments queue creates a record
                here.
              </p>
              <Button
                onClick={() => navigate("/finance/payments")}
                className="mt-4 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                size="sm"
              >
                Open Payment Queue
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record Detail Dialog */}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="border-input bg-card">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono text-lg font-semibold text-foreground">
                  {selected.recordNumber}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Financial record for {selected.sourceOrderNumber} ·{" "}
                  {formatDate(selected.postedAt, { time: true })}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-sidebar p-4">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Source Order
                  </div>
                  <div className="mt-1 font-mono text-sm font-medium text-foreground">
                    {selected.sourceOrderNumber}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Customer
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {selected.customerName}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Aggregate
                  </div>
                  <div className="mt-1 text-sm text-foreground">
                    {selected.aggregate}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Quantity
                  </div>
                  <div className="mt-1 text-sm text-foreground">
                    {formatQuantity(selected.quantity)}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Unit Price
                  </div>
                  <div className="mt-1 text-sm tabular-nums text-foreground">
                    {formatCurrency(selected.unitPrice)}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Total Price
                  </div>
                  <div className="mt-1 text-sm font-medium tabular-nums text-foreground">
                    {formatCurrency(selected.totalPrice)}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Bank
                  </div>
                  <div className="mt-1 text-sm text-foreground">
                    {selected.bank}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Posted By
                  </div>
                  <div className="mt-1 font-mono text-sm text-foreground">
                    {selected.postedBy || "—"}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Status
                  </div>
                  <div className="mt-1">
                    <Badge
                      variant="outline"
                      className="erp-badge-approved border text-[10px] font-medium"
                    >
                      {FINANCIAL_RECORD_STATUS_LABELS[selected.status]}
                    </Badge>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
