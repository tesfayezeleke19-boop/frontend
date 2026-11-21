import { useParams, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { fetchInvoiceAttachmentBlob } from "@/services/sales/apiInvoiceRepo";
import {
  ArrowLeft,
  Printer,
  Clock,
  CheckCircle2,
  XCircle,
  CreditCard,
  FileText,
  Pencil,
  Loader2,
  Paperclip,
  Link2,
  Image as ImageIcon,
} from "lucide-react";
import { useSalesInvoice } from "@/hooks/use-sales-data";
import { formatCurrency, formatDate, formatQuantity } from "@/services/sales/format";
import {
  isEditableInvoiceStatus,
  type InvoiceOrder,
} from "@/services/sales/invoice";
import {
  ORDER_STATUS,
  ORDER_STATUS_UI,
  type OrderStatus,
} from "@/services/sales/types";

const statusIcons: Record<string, React.ElementType> = {
  [ORDER_STATUS.DRAFT]: FileText,
  [ORDER_STATUS.PENDING_FINANCE_REVIEW]: Clock,
  [ORDER_STATUS.FINANCE_APPROVED]: CheckCircle2,
  [ORDER_STATUS.REJECTED]: XCircle,
  [ORDER_STATUS.PAYMENT_CONFIRMED]: CreditCard,
};

const workflowSteps: { key: OrderStatus; label: string }[] = [
  { key: ORDER_STATUS.DRAFT, label: "Created" },
  { key: ORDER_STATUS.PENDING_FINANCE_REVIEW, label: "Finance Review" },
  { key: ORDER_STATUS.FINANCE_APPROVED, label: "Approved" },
  { key: ORDER_STATUS.PAYMENT_CONFIRMED, label: "Payment Confirmed" },
];

type EvidenceFile = {
  fileName: string;
  fileUrl?: string | null;
  mimeType?: string | null;
};

function isImageFile(fileName: string, mimeType?: string | null) {
  if (mimeType?.toLowerCase().startsWith("image/")) {
    return true;
  }

  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);
}


function EvidenceAttachment({
  title,
  file,
}: {
  title: string;
  file: EvidenceFile;
}) {
  const navigate = useNavigate();

  const imageFile = isImageFile(file.fileName, file.mimeType);
  const fileUrl = file.fileUrl;


  
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadThumbnail() {
      if (!imageFile || !fileUrl) {
        setThumbnailUrl("");
        return;
      }

      try {
        setImageLoading(true);
        setImageError(false);

        const url = await fetchInvoiceAttachmentBlob(fileUrl);

        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }

        objectUrl = url;
        setThumbnailUrl(url);
      } catch (error) {
        if (!cancelled) {
          console.error("Unable to load evidence thumbnail:", error);
          setImageError(true);
        }
      } finally {
        if (!cancelled) {
          setImageLoading(false);
        }
      }
    }

    loadThumbnail();

    return () => {
      cancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [fileUrl, imageFile]);

  const openImageViewer = () => {
    if (!fileUrl) return;

    const params = new URLSearchParams({
      src: fileUrl,
      name: file.fileName,
    });

    navigate(`/evidence-image?${params.toString()}`);
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-sidebar p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
        {title}
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-foreground">
        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />

        <span className="min-w-0 truncate font-medium">
          {file.fileName}
        </span>

        {fileUrl && !imageFile && (
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-info hover:underline"
          >
            <Link2 className="size-3" />
            open
          </a>
        )}
      </div>

      {imageFile && fileUrl && (
        <div className="mt-3">
          {imageLoading && (
            <div className="flex h-32 max-w-md items-center justify-center rounded-lg border border-border bg-card">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {imageError && (
            <div className="flex h-32 max-w-md items-center justify-center rounded-lg border border-border bg-card text-xs text-destructive">
              Unable to load evidence thumbnail.
            </div>
          )}

          {thumbnailUrl && !imageError && (
            <button
              type="button"
              onClick={openImageViewer}
              className="block max-w-full text-left"
              title="View full image"
            >
              <img
                src={thumbnailUrl}
                alt={file.fileName}
                className="max-h-80 w-full max-w-md rounded-lg border border-border bg-card object-contain"
              />

              <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-info hover:underline">
                <ImageIcon className="size-3.5" />
                Click to view full image
              </span>
            </button>
          )}
        </div>
      )}

      {imageFile && !fileUrl && (
        <p className="mt-2 text-xs text-muted-foreground">
          Image URL is not available.
        </p>
      )}
    </div>
  );
}


function OrderRow({ order }: { order: InvoiceOrder }) {
  return (
    <div className="rounded-lg border border-border bg-sidebar p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-foreground">
          Order {order.orderNumber}
        </div>

        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-violet">
          Royalty Order {order.royaltyOrderNumber}
          {order.royaltyInvoiceNumber
            ? ` · ${order.royaltyInvoiceNumber}`
            : ""}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            Aggregate
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">
            {order.aggregate}
          </div>
        </div>

        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            Quantity
          </div>
          <div className="mt-0.5 text-sm font-medium tabular-nums text-foreground">
            {formatQuantity(order.quantity)}
          </div>
        </div>

        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            Unit Price
          </div>
          <div className="mt-0.5 text-sm font-medium tabular-nums text-foreground">
            {formatCurrency(order.unitPrice)}
          </div>
        </div>

        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            Total Price
          </div>
          <div className="mt-0.5 text-sm font-medium tabular-nums text-foreground">
            {formatCurrency(order.lineTotalExclVat)}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground/70">
            VAT-exclusive · Royalty {formatCurrency(order.royaltyAmount)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TransactionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: invoice, loading } = useSalesInvoice(id);

  if (loading && !invoice) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm font-medium text-foreground">
          Invoice not found
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          This invoice does not exist or may have been removed.
        </p>

        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/sales/transactions")}
          className="mt-4 gap-1.5 border-input text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-3.5" />
          Back to Transactions
        </Button>
      </div>
    );
  }

  const config = ORDER_STATUS_UI[invoice.status];
  const StatusIcon = statusIcons[invoice.status] ?? FileText;
  const currentIdx = workflowSteps.findIndex(
    (step) => step.key === invoice.status,
  );
  const statusOrder = workflowSteps.map((step) => step.key);
  const canEdit = isEditableInvoiceStatus(invoice.status);
  const summary = invoice.financialSummary;

  const royaltyTotal = invoice.orders.reduce(
    (sum, order) => sum + order.royaltyAmount,
    0,
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <button
          onClick={() => navigate("/sales/transactions")}
          className="mb-2 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Transactions
        </button>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-2xl font-semibold text-foreground">
                {invoice.invoiceNumber}
              </h1>

              <Badge
                variant="outline"
                className={`border text-xs font-medium ${config.className}`}
              >
                <StatusIcon className="mr-1 size-3" />
                {config.label}
              </Badge>
            </div>

            <p className="mt-1 text-sm text-muted-foreground">
              {invoice.customer.name} · {invoice.orders.length} Order
              {invoice.orders.length > 1 ? "s" : ""}
            </p>
          </div>

          <div className="flex gap-2">
            {canEdit && (
              <Button
                size="sm"
                onClick={() =>
                  navigate(`/sales/invoices/${invoice.id}/edit`)
                }
                className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Pencil className="size-3.5" />
                {invoice.status === ORDER_STATUS.REJECTED
                  ? "Edit & Resubmit"
                  : "Edit Draft"}
              </Button>
            )}
            
          </div>
        </div>
      </div>

      {/* Workflow Timeline */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="p-4">
          <div className="flex items-center gap-0 overflow-x-auto">
            {workflowSteps.map((step, i) => {
              const stepIdx = statusOrder.indexOf(step.key);
              const isCompleted = currentIdx > stepIdx;
              const isCurrent = currentIdx === stepIdx;

              const isRejected =
                invoice.status === ORDER_STATUS.REJECTED &&
                step.key === ORDER_STATUS.PENDING_FINANCE_REVIEW;

              return (
                <div key={step.key} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex size-7 items-center justify-center rounded-full border-2 text-xs font-medium ${
                        isRejected
                          ? "border-destructive bg-destructive text-primary-foreground"
                          : isCompleted || isCurrent
                            ? "border-success bg-success text-primary-foreground"
                            : "border-input bg-popover text-muted-foreground/70"
                      }`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="size-3.5" />
                      ) : isRejected ? (
                        <XCircle className="size-3.5" />
                      ) : (
                        i + 1
                      )}
                    </div>

                    <span
                      className={`mt-1.5 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.1em] ${
                        isCurrent
                          ? "text-foreground"
                          : isCompleted
                            ? "text-muted-foreground"
                            : "text-muted-foreground/70"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>

                  {i < workflowSteps.length - 1 && (
                    <div
                      className={`mx-1.5 h-px w-8 sm:w-12 ${
                        isCompleted ? "bg-success" : "bg-muted"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {invoice.status === ORDER_STATUS.REJECTED &&
            invoice.rejectionReason && (
              <div className="mt-3 rounded-lg border border-destructive-border bg-destructive-soft p-3 text-xs text-destructive">
                <strong>Rejection Reason:</strong>{" "}
                {invoice.rejectionReason}
              </div>
            )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Main Info */}
        <div className="space-y-5 lg:col-span-2">
          {/* Invoice + Customer Information */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Invoice & Customer Information
              </CardTitle>
            </CardHeader>

            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Invoice Number
                  </div>
                  <div className="mt-1 font-mono text-sm font-medium text-foreground">
                    {invoice.invoiceNumber}
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Date
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {formatDate(invoice.date)}
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    FS No
                  </div>
                  <div className="mt-1 font-mono text-sm font-medium text-foreground">
                    {invoice.fsNo || "—"}
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Customer / Company
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {invoice.customer.name}
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Customer TIN
                  </div>
                  <div className="mt-1 font-mono text-sm font-medium text-foreground">
                    {invoice.customer.tin || "—"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Orders */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Orders ({invoice.orders.length})
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              {invoice.orders.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </CardContent>
          </Card>

          {/* Finance Summary */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Finance Summary
              </CardTitle>
            </CardHeader>

            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Subtotal (excl. VAT)
                  </div>
                  <div className="mt-1 text-sm font-medium tabular-nums text-foreground">
                    {formatCurrency(summary.subtotalExclVat)}
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Total VAT (15%)
                  </div>
                  <div className="mt-1 text-sm font-medium tabular-nums text-warning">
                    {formatCurrency(summary.totalVat)}
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Total Price
                  </div>
                  <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                    {formatCurrency(summary.totalPriceInclVat)}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground/70">
                    VAT-inclusive
                  </div>
                </div>
              </div>

              <Separator className="my-4 bg-muted" />

              {/* Withholding status row */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-sidebar p-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Withholding
                  </div>

                  <div className="font-mono text-[10px] text-muted-foreground/70">
                    {summary.withholdingEnabled
                      ? `ON — ${formatCurrency(summary.withholdingAmount)} (3%)`
                      : "OFF"}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {summary.withholdingEnabled ? "ON" : "OFF"}
                  </span>

                  <Switch
                    checked={summary.withholdingEnabled}
                    disabled
                    className="data-[state=checked]:bg-success"
                  />
                </div>
              </div>

              <div className="mt-3 flex justify-between text-sm">
                <span className="font-medium text-foreground">
                  Net Amount After Withholding
                </span>

                <span className="text-base font-semibold tabular-nums text-success">
                  {formatCurrency(summary.netAmountAfterWithholding)}
                </span>
              </div>

              {summary.withholdingEnabled &&
                invoice.withholdingEvidence && (
                  <EvidenceAttachment
                    title="Withholding Evidence"
                    file={invoice.withholdingEvidence}
                  />
                )}
            </CardContent>
          </Card>

          {/* Payment Information */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Payment Information
              </CardTitle>
            </CardHeader>

            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Bank
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {invoice.payment.bank || "—"}
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Payment Sent By
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {invoice.payment.paymentSender || "—"}
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Reference Number
                  </div>
                  <div className="mt-1 font-mono text-sm font-medium text-foreground">
                    {invoice.payment.paymentReferenceNumber || "—"}
                  </div>
                </div>
              </div>

              {invoice.payment.paymentEvidence && (
                <EvidenceAttachment
                  title="Payment Evidence"
                  file={invoice.payment.paymentEvidence}
                />
              )}

              {invoice.remark && (
                <div className="mt-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Remark
                  </div>
                  <div className="mt-1 text-sm text-foreground">
                    {invoice.remark}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Invoice Details */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Invoice Details
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Invoice Number</span>
                <span className="font-mono text-xs font-medium text-foreground">
                  {invoice.invoiceNumber}
                </span>
              </div>

              <Separator className="bg-muted" />

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <Badge
                  variant="outline"
                  className={`border text-[10px] font-medium ${config.className}`}
                >
                  {config.label}
                </Badge>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Orders</span>
                <span className="font-medium tabular-nums text-foreground">
                  {invoice.orders.length}
                </span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Royalty Total</span>
                <span className="font-medium tabular-nums text-violet">
                  {formatCurrency(royaltyTotal)}
                </span>
              </div>

              <Separator className="bg-muted" />

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Created</span>
                <span className="font-mono text-xs text-foreground">
                  {formatDate(invoice.createdAt, { time: true })}
                </span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Last Updated</span>
                <span className="font-mono text-xs text-foreground">
                  {formatDate(invoice.updatedAt, { time: true })}
                </span>
              </div>

              {invoice.submittedAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Submitted</span>
                  <span className="font-mono text-xs text-foreground">
                    {formatDate(invoice.submittedAt, { time: true })}
                  </span>
                </div>
              )}

              {invoice.approvedAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Approved</span>
                  <span className="font-mono text-xs text-foreground">
                    {formatDate(invoice.approvedAt, { time: true })}
                  </span>
                </div>
              )}

              {invoice.rejectedAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Rejected</span>
                  <span className="font-mono text-xs text-foreground">
                    {formatDate(invoice.rejectedAt, { time: true })}
                  </span>
                </div>
              )}

              {invoice.paymentConfirmedAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Payment Confirmed
                  </span>
                  <span className="font-mono text-xs text-foreground">
                    {formatDate(invoice.paymentConfirmedAt, {
                      time: true,
                    })}
                  </span>
                </div>
              )}

              {invoice.legacyOrderId && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Legacy Order</span>
                  <span className="font-mono text-xs text-foreground">
                    {invoice.legacyOrderId.startsWith("ord-")
                      ? "Migrated"
                      : invoice.legacyOrderId}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Activity
              </CardTitle>
            </CardHeader>

            <CardContent>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="mt-0.5 size-2 shrink-0 rounded-full bg-success" />

                  <div>
                    <div className="text-xs font-medium text-foreground">
                      Invoice created
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground/70">
                      {formatDate(invoice.createdAt, { time: true })}
                    </div>
                  </div>
                </div>

                {invoice.submittedAt && (
                  <div className="flex gap-3">
                    <div className="mt-0.5 size-2 shrink-0 rounded-full bg-info" />

                    <div>
                      <div className="text-xs font-medium text-foreground">
                        Submitted for finance review
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground/70">
                        {formatDate(invoice.submittedAt, { time: true })}
                      </div>
                    </div>
                  </div>
                )}

                {invoice.approvedAt && (
                  <div className="flex gap-3">
                    <div className="mt-0.5 size-2 shrink-0 rounded-full bg-success" />

                    <div>
                      <div className="text-xs font-medium text-foreground">
                        Finance approved invoice
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground/70">
                        {formatDate(invoice.approvedAt, { time: true })}
                        {invoice.approvedBy
                          ? ` · ${invoice.approvedBy}`
                          : ""}
                      </div>
                    </div>
                  </div>
                )}

                {invoice.rejectedAt && (
                  <div className="flex gap-3">
                    <div className="mt-0.5 size-2 shrink-0 rounded-full bg-destructive" />

                    <div>
                      <div className="text-xs font-medium text-foreground">
                        Finance rejected invoice
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground/70">
                        {formatDate(invoice.rejectedAt, { time: true })}
                      </div>
                    </div>
                  </div>
                )}

                {invoice.paymentConfirmedAt && (
                  <div className="flex gap-3">
                    <div className="mt-0.5 size-2 shrink-0 rounded-full bg-info" />

                    <div>
                      <div className="text-xs font-medium text-foreground">
                        Payment confirmed
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground/70">
                        {formatDate(invoice.paymentConfirmedAt, {
                          time: true,
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
