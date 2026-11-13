
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  ApproveInvoiceDialog,
  ConfirmInvoicePaymentDialog,
  RejectInvoiceDialog,
} from "@/components/finance/OrderActionDialogs";
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Loader2,
  XCircle,
  Paperclip,
  Link2,
  Image as ImageIcon,
} from "lucide-react";
import { useSalesInvoice } from "@/hooks/use-sales-data";
import { fetchInvoiceAttachmentBlob } from "@/services/sales/apiInvoiceRepo";
import {
  formatCurrency,
  formatDate,
  formatQuantity,
} from "@/services/sales/format";
import {
  ORDER_STATUS,
  ORDER_STATUS_UI,
} from "@/services/sales/types";
import type { InvoiceOrder } from "@/services/sales/invoice";

type ActionState =
  | { type: "approve" }
  | { type: "reject" }
  | { type: "confirm" }
  | null;

type EvidenceFileData = {
  fileName: string;
  fileUrl?: string | null;
};

function isImageFile(fileName: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);
}

function InvoiceOrderRow({ order }: { order: InvoiceOrder }) {
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

/**
 * Evidence attachment component.
 *
 * Image attachments are fetched through the authenticated API helper.
 * This is necessary because protected invoice attachments require
 * Bearer-token authentication and cannot be loaded using a normal
 * <img src={fileUrl}> request.
 */
function EvidenceAttachment({
  title,
  file,
}: {
  title: string;
  file: EvidenceFileData;
}) {
  const navigate = useNavigate();

  const imageFile = isImageFile(file.fileName);
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
        setImageError(false);
        setImageLoading(false);
        return;
      }

      try {
        setImageLoading(true);
        setImageError(false);
        setThumbnailUrl("");

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

      {/* Image thumbnail */}
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

export default function FinanceOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const { data: invoice, loading } = useSalesInvoice(id);
  const [action, setAction] = useState<ActionState>(null);

  const backTo =
    (location.state as { from?: string } | null)?.from ??
    "/finance/review";

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
          onClick={() => navigate(backTo)}
          className="mt-4 gap-1.5 border-input text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Button>
      </div>
    );
  }

  const config = ORDER_STATUS_UI[invoice.status];

  const isPending =
    invoice.status === ORDER_STATUS.PENDING_FINANCE_REVIEW;

  const isApproved =
    invoice.status === ORDER_STATUS.FINANCE_APPROVED;

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
          onClick={() => navigate(backTo)}
          className="mb-2 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          {backTo === "/finance/payments"
            ? "Back to Payments"
            : "Back to Sales Review"}
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
                {config.label}
              </Badge>
            </div>

            <p className="mt-1 text-sm text-muted-foreground">
              {invoice.customer.name} · {invoice.orders.length} Order
              {invoice.orders.length > 1 ? "s" : ""}
            </p>
          </div>

          <div className="flex gap-2">
            {isPending && (
              <>
                <Button
                  size="sm"
                  onClick={() => setAction({ type: "approve" })}
                  className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <CheckCircle2 className="size-3.5" />
                  Approve
                </Button>

                <Button
                  size="sm"
                  onClick={() => setAction({ type: "reject" })}
                  className="gap-1.5 border border-destructive-border bg-destructive-soft text-destructive hover:bg-destructive-soft"
                >
                  <XCircle className="size-3.5" />
                  Reject
                </Button>
              </>
            )}

            {isApproved && (
              <Button
                size="sm"
                onClick={() => setAction({ type: "confirm" })}
                className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <CreditCard className="size-3.5" />
                Confirm Payment
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Main Info */}
        <div className="space-y-5 lg:col-span-2">
          {/* Invoice & Customer Information */}
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-5">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="text-sm font-medium text-foreground">
                  Invoice Information
                </div>

                <div className="mt-3 space-y-2.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Invoice Number
                    </span>
                    <span className="font-mono text-xs font-medium text-foreground">
                      {invoice.invoiceNumber}
                    </span>
                  </div>

                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Date</span>
                    <span className="text-foreground">
                      {formatDate(invoice.date)}
                    </span>
                  </div>

                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <Badge
                      variant="outline"
                      className={`border text-[10px] font-medium ${config.className}`}
                    >
                      {config.label}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="text-sm font-medium text-foreground">
                  Customer Information
                </div>

                <div className="mt-3 space-y-2.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Customer / Company
                    </span>
                    <span className="font-medium text-foreground">
                      {invoice.customer.name}
                    </span>
                  </div>

                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Customer TIN
                    </span>
                    <span className="font-mono text-xs font-medium text-foreground">
                      {invoice.customer.tin || "—"}
                    </span>
                  </div>

                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">FS No</span>
                    <span className="font-mono text-xs font-medium text-foreground">
                      {invoice.fsNo || "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Orders */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-medium text-foreground">
              Orders ({invoice.orders.length})
            </div>

            <div className="mt-3 space-y-3">
              {invoice.orders.map((order) => (
                <InvoiceOrderRow
                  key={order.id}
                  order={order}
                />
              ))}
            </div>

            <Separator className="my-3 bg-muted" />

            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                Total Royalty (3%, VAT-exclusive)
              </span>

              <span className="font-medium tabular-nums text-violet">
                {formatCurrency(royaltyTotal)}
              </span>
            </div>
          </div>

          {/* Financial Summary */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-medium text-foreground">
              Finance Summary
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
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

            <Separator className="my-3 bg-muted" />

            {/* Withholding */}
            <div className="flex items-center justify-between rounded-lg border border-border bg-sidebar p-3">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Withholding
                </div>

                <div className="font-mono text-[10px] text-muted-foreground/70">
                  {summary.withholdingEnabled
                    ? `ON — ${formatCurrency(summary.withholdingAmount)} (3%)`
                    : "No withholding applied"}
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
          </div>

          {/* Payment Information */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-medium text-foreground">
              Payment Information
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
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
              <div className="mt-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Remark
                </div>

                <div className="mt-1 text-sm text-foreground">
                  {invoice.remark}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar — workflow timestamps */}
        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-medium text-foreground">
              Invoice Details
            </div>

            <div className="mt-3 space-y-2.5">
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
                <span className="text-muted-foreground">Created</span>

                <span className="font-mono text-xs text-foreground">
                  {formatDate(invoice.createdAt, { time: true })}
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
                    {invoice.approvedBy
                      ? ` · ${invoice.approvedBy}`
                      : ""}
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

              {invoice.rejectionReason && (
                <div className="rounded-lg border border-destructive-border bg-destructive-soft p-2.5 text-xs text-destructive">
                  <strong>Rejection Reason:</strong>{" "}
                  {invoice.rejectionReason}
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
            </div>
          </div>
        </div>
      </div>

      {/* Action Dialogs */}
      <ApproveInvoiceDialog
        invoice={action?.type === "approve" ? invoice : null}
        open={action?.type === "approve"}
        onOpenChange={(open) => !open && setAction(null)}
      />

      <RejectInvoiceDialog
        invoice={action?.type === "reject" ? invoice : null}
        open={action?.type === "reject"}
        onOpenChange={(open) => !open && setAction(null)}
      />

      <ConfirmInvoicePaymentDialog
        invoice={action?.type === "confirm" ? invoice : null}
        open={action?.type === "confirm"}
        onOpenChange={(open) => !open && setAction(null)}
      />
    </div>
  );
}
