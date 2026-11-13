import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, TrendingUp, Package, CircleDollarSign } from "lucide-react";
import { useSalesInvoices } from "@/hooks/use-sales-data";
import { formatCurrency, formatDate, formatQuantity } from "@/services/sales/format";
import { ORDER_STATUS, ORDER_STATUS_UI } from "@/services/sales/types";

export default function SalesReports() {
  const { data: invoices, loading, error } = useSalesInvoices();
  const rows = useMemo(() => invoices ?? [], [invoices]);
  const reportable = rows.filter((invoice) => invoice.status === ORDER_STATUS.FINANCE_APPROVED || invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED);
  const totalRevenue = reportable.reduce((sum, invoice) => sum + invoice.financialSummary.totalPriceInclVat, 0);
  const totalQuantity = reportable.reduce((sum, invoice) => sum + invoice.orders.reduce((n, order) => n + order.quantity, 0), 0);
  const aggregateSummary = useMemo(() => {
    const totals = new Map<string, number>();
    for (const invoice of reportable) for (const order of invoice.orders) {
      totals.set(order.aggregate, (totals.get(order.aggregate) ?? 0) + order.lineTotalExclVat);
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  if (loading && !invoices) return <div className="flex items-center justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground/70" /></div>;
  if (error) return <Card className="border-destructive-border bg-destructive-soft shadow-none"><CardContent className="p-5 text-sm text-destructive">Unable to load Sales reports: {error.message}</CardContent></Card>;

  return <div className="space-y-5">
    <div><h1 className="font-heading text-2xl font-semibold text-foreground">Sales Reports</h1><p className="mt-1 text-sm text-muted-foreground">Live summaries calculated from backend invoices. Report creation and saved report history are not available until a Sales Reports API is added.</p></div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[{label:"Backend invoices",value:String(rows.length),icon:FileText},{label:"Approved / paid revenue",value:formatCurrency(totalRevenue),icon:CircleDollarSign},{label:"Approved / paid quantity",value:formatQuantity(totalQuantity),icon:Package}].map((stat) => <Card key={stat.label} className="border-border bg-card shadow-none"><CardContent className="p-4"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{stat.label}</span><stat.icon className="size-4 text-muted-foreground/70" /></div><div className="mt-2 text-xl font-semibold tabular-nums text-foreground">{stat.value}</div></CardContent></Card>)}
    </div>
    <Card className="border-border bg-card shadow-none"><CardHeader><CardTitle className="text-sm font-medium text-foreground">Revenue by Aggregate</CardTitle></CardHeader><CardContent>{aggregateSummary.length ? <div className="space-y-3">{aggregateSummary.map(([aggregate, amount]) => <div key={aggregate} className="flex items-center gap-3"><span className="w-32 text-sm text-muted-foreground">Aggregate {aggregate}</span><div className="h-2 flex-1 overflow-hidden rounded bg-accent"><div className="h-full rounded bg-muted" style={{width:`${totalRevenue ? Math.min(100, amount / Math.max(...aggregateSummary.map(([,v])=>v)) * 100) : 0}%`}} /></div><span className="w-36 text-right text-sm tabular-nums text-foreground">{formatCurrency(amount)}</span></div>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">No approved or paid invoice data yet.</p>}</CardContent></Card>
    <Card className="border-border bg-card shadow-none"><CardHeader><CardTitle className="text-sm font-medium text-foreground">Invoice Activity ({rows.length})</CardTitle></CardHeader><CardContent>{rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="pb-2 pr-4">Invoice</th><th className="pb-2 pr-4">Customer</th><th className="pb-2 pr-4">Orders</th><th className="pb-2 pr-4 text-right">Total</th><th className="pb-2 pr-4">Status</th><th className="pb-2">Date</th></tr></thead><tbody>{rows.map((invoice) => { const status = ORDER_STATUS_UI[invoice.status]; return <tr key={invoice.id} className="border-b border-border last:border-0"><td className="py-3 pr-4 font-mono text-xs text-foreground">{invoice.invoiceNumber}</td><td className="py-3 pr-4 text-muted-foreground">{invoice.customer.name}</td><td className="py-3 pr-4 text-muted-foreground">{invoice.orders.length}</td><td className="py-3 pr-4 text-right tabular-nums text-foreground">{formatCurrency(invoice.financialSummary.totalPriceInclVat)}</td><td className="py-3 pr-4"><Badge variant="outline" className={`border text-[10px] ${status.className}`}>{status.label}</Badge></td><td className="py-3 text-xs text-muted-foreground">{formatDate(invoice.date)}</td></tr>; })}</tbody></table></div> : <div className="flex flex-col items-center py-10 text-center"><TrendingUp className="mb-3 size-8 text-muted-foreground"/><p className="text-sm text-muted-foreground">No invoices returned by the backend.</p></div>}</CardContent></Card>
  </div>;
}
