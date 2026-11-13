/**
 * Finance action dialogs — Approve, Reject, and Confirm Payment for Sales
 * Invoices.
 *
 * All three mutate the SAME Sales Invoice record that Sales created (via the
 * shared salesInvoicesRepository), so Finance is never working on a copy.
 * Approve/reject operate at the invoice level — all child orders are
 * approved or rejected together.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCircle2, Loader2, XCircle, CreditCard } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { salesInvoicesRepository } from "@/services/sales/invoiceRepo";
import { formatCurrency } from "@/services/sales/format";
import type { SalesInvoice } from "@/services/sales/invoice";

interface InvoiceActionDialogProps {
  invoice: SalesInvoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the action succeeds (dialog closes itself). */
  onComplete?: () => void;
}

export function InvoiceSummary({ invoice }: { invoice: SalesInvoice }) {
  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-sidebar p-4">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Invoice</span>
        <span className="font-mono text-xs font-medium text-foreground">
          {invoice.invoiceNumber}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Customer</span>
        <span className="font-medium text-foreground">
          {invoice.customer.name}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Orders</span>
        <span className="font-medium tabular-nums text-foreground">
          {invoice.orders.length}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Total Price</span>
        <span className="font-medium tabular-nums text-foreground">
          {formatCurrency(invoice.financialSummary.totalPriceInclVat)}
        </span>
      </div>
    </div>
  );
}

/** Approve a pending invoice (PENDING_FINANCE_REVIEW → FINANCE_APPROVED). */
export function ApproveInvoiceDialog({
  invoice,
  open,
  onOpenChange,
  onComplete,
}: InvoiceActionDialogProps) {
  const { user } = useAuth();
  const actor = user?.email ?? user?.name ?? "Finance";
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleApprove = async () => {
    if (!invoice) return;
    setIsSubmitting(true);
    try {
      await salesInvoicesRepository.approveInvoice(invoice.id, actor);
      toast.success(`Invoice ${invoice.invoiceNumber} approved`);
      onOpenChange(false);
      onComplete?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to approve invoice",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-input bg-card">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-semibold text-foreground">
            Approve Invoice
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Approving this invoice approves all {invoice?.orders.length ?? 0} of
            its orders. They become eligible for the Royalty Report and visible
            to Sales as Finance Approved.
          </DialogDescription>
        </DialogHeader>
        {invoice && <InvoiceSummary invoice={invoice} />}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApprove}
            disabled={!invoice || isSubmitting}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Confirm Approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reject a pending invoice with a required reason (→ REJECTED). */
export function RejectInvoiceDialog({
  invoice,
  open,
  onOpenChange,
  onComplete,
}: InvoiceActionDialogProps) {
  const { user } = useAuth();
  const actor = user?.email ?? user?.name ?? "Finance";
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReject = async () => {
    if (!invoice) return;
    if (!reason.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    setIsSubmitting(true);
    try {
      await salesInvoicesRepository.rejectInvoice(
        invoice.id,
        reason.trim(),
        actor,
      );
      toast.success(`Invoice ${invoice.invoiceNumber} rejected`);
      onOpenChange(false);
      setReason("");
      setError(null);
      onComplete?.();
    } catch (rejectError) {
      toast.error(
        rejectError instanceof Error
          ? rejectError.message
          : "Failed to reject invoice",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason("");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="border-input bg-card">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-semibold text-foreground">
            Reject Invoice
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            The entire invoice (all orders) is returned to Sales with the reason
            below, so they can correct and resubmit it.
          </DialogDescription>
        </DialogHeader>
        {invoice && <InvoiceSummary invoice={invoice} />}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Rejection Reason *
          </Label>
          <Textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Explain why this invoice cannot be approved..."
            rows={3}
            className={`resize-none border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 ${
              error ? "border-destructive" : ""
            }`}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleReject}
            disabled={!invoice || isSubmitting}
            className="gap-2 bg-destructive text-primary-foreground hover:bg-destructive"
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <XCircle className="size-4" />
            )}
            Reject Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirm payment for an approved invoice (→ PAYMENT_CONFIRMED). */
export function ConfirmInvoicePaymentDialog({
  invoice,
  open,
  onOpenChange,
  onComplete,
}: InvoiceActionDialogProps) {
  const { user } = useAuth();
  const actor = user?.email ?? user?.name ?? "Finance";
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (!invoice) return;
    setIsSubmitting(true);
    try {
      await salesInvoicesRepository.confirmInvoicePayment(invoice.id, actor);
      toast.success(
        `Payment confirmed for ${invoice.invoiceNumber}`,
      );
      onOpenChange(false);
      onComplete?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to confirm payment",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-input bg-card">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-semibold text-foreground">
            Confirm Payment
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Confirming the payment marks the invoice as Payment Confirmed for
            Sales.
          </DialogDescription>
        </DialogHeader>
        {invoice && <InvoiceSummary invoice={invoice} />}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!invoice || isSubmitting}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CreditCard className="size-4" />
            )}
            Confirm Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
