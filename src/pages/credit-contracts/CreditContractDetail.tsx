
/** Credit Contract detail — the working screen for ONE credit contract.
 *
 * Finance:
 * - Creates and activates credit contracts.
 * - Manages contract information.
 * - Completes active credit contracts through the credit-specific payment form.
 *
 * Sales:
 * - Can view all active credit contracts.
 * - Can create orders against active credit contracts only.
 *
 * Each credit contract order is registered as an individual Sales Invoice.
 * On completion, Finance supplies the FS No and payment information.
 * The backend must assign the FS No to the existing Sales Invoices and
 * prevent further orders against the completed contract.
 *
 * All persistence is handled through the backend API. No localStorage.
 */

import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Textarea } from "@/components/ui/textarea";

import {
  ArrowLeft,
  FileText,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  ScrollText,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";

import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { USER_ROLES } from "@/services/auth";

import {
  useCreditContract,
  useCreditContractOrders,
  useCreditContractFinancials,
  useCreditContractFinancialReport,
} from "@/hooks/use-credit-contracts-data";

import { creditContractsRepository } from "@/services/creditContracts/repository";

import { ContractFinancialReportCard } from "@/components/contracts/ContractFinancialReportCard";
import { ContractPaymentSection } from "@/components/contracts/ContractPaymentSection";

import {
  CREDIT_CONTRACT_STATUS,
  CREDIT_CONTRACT_STATUS_UI,
  CREDIT_ORDER_STATUS,
  creditContractAcceptsOrders,
  type CreditContractOrder,
} from "@/services/creditContracts/types";

import {
  formatCurrency,
  formatDate,
} from "@/services/sales/format";

import { CreditContractFormDialog } from "@/components/credit-contracts/CreditContractFormDialog";
import { CreditOrderDialog } from "@/components/credit-contracts/CreditOrderDialog";
import { CreditContractPaymentDialog } from "@/components/credit-contracts/CreditContractPaymentDialog";
import { AttachmentViewer } from "@/components/contracts/AttachmentViewer";

import type { ContractAttachment } from "@/services/contracts/types";
import type { CreditContractCompletionInput } from "@/components/credit-contracts/CreditContractPaymentDialog";

export default function CreditContractDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const { user, session } = useAuth();

  const isFinance = user?.role === USER_ROLES.FINANCE;

  const isSales =
    user?.role === USER_ROLES.SALES &&
    !session?.isGuest;

  const portalBase = location.pathname.startsWith("/finance")
    ? "/finance"
    : "/sales";

  const {
    data: contract,
    loading,
  } = useCreditContract(id);

  const {
    data: orders,
  } = useCreditContractOrders(id);

  const {
    data: financials,
  } = useCreditContractFinancials(id);

  const {
    data: report,
  } = useCreditContractFinancialReport(id);

  const [formOpen, setFormOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const [dialog, setDialog] = useState<"activate" | "cancel" | null>(
    null,
  );

  const [orderDialogOpen, setOrderDialogOpen] = useState(false);

  const [editingOrder, setEditingOrder] =
    useState<CreditContractOrder | null>(null);

  const [viewingAttachment, setViewingAttachment] =
    useState<ContractAttachment | null>(null);

  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading && !contract) {
    return (
      <div className="flex items-center justify-center py-20">
        <div
          className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary"
          aria-label="Loading credit contract"
        />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FileText className="mb-3 size-8 text-muted-foreground" />

        <p className="text-sm font-medium text-foreground">
          Credit contract not found
        </p>

        <Button
          variant="outline"
          onClick={() => navigate(`${portalBase}/credit-contracts`)}
          className="mt-4 border-input text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
          Back to Credit Contracts
        </Button>
      </div>
    );
  }

  const contractOrders = orders ?? [];

  const accepted = creditContractAcceptsOrders(contract.status);

  const isActive =
    contract.status === CREDIT_CONTRACT_STATUS.ACTIVE;

  const isCompleted =
    contract.status === CREDIT_CONTRACT_STATUS.INVOICED;

  const canEditOrder = (order: CreditContractOrder) =>
    accepted &&
    order.status === CREDIT_ORDER_STATUS.COMPLETED &&
    (
      isFinance ||
      (
        isSales &&
        order.completedByUserId === user?.id
      )
    );

  const totals = financials?.totals;

  const runAction = async (
    action: () => Promise<unknown>,
    success: string,
  ) => {
    setBusy(true);

    try {
      await action();

      toast.success(success);

      setDialog(null);
      setReason("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The action could not be completed",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteCredit = async (
  input: CreditContractCompletionInput,
) => {
  if (!id) {
    throw new Error("Credit contract ID is missing");
  }

  await creditContractsRepository.finalizeContract(id, input);
};

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to={`${portalBase}/credit-contracts`}
            className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 transition-colors hover:text-muted-foreground"
          >
            <ArrowLeft className="size-3" />
            Credit Contracts
          </Link>

          <div className="flex items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold text-foreground">
              {contract.contractNumber}
            </h1>

            <Badge
              variant="outline"
              className={`border text-[10px] font-medium ${
                CREDIT_CONTRACT_STATUS_UI[contract.status].className
              }`}
            >
              {CREDIT_CONTRACT_STATUS_UI[contract.status].label}
            </Badge>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            {contract.customer.name} · TIN{" "}
            {contract.customer.tin} · FS No {contract.fsNo || "—"} ·{" "}
            {formatDate(contract.contractDate)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sales: add order only while contract accepts orders */}
          {isSales && accepted && (
            <Button
              onClick={() => {
                setEditingOrder(null);
                setOrderDialogOpen(true);
              }}
              className="gap-2 bg-success text-primary-foreground hover:bg-success"
            >
              <Plus className="size-4" />
              Add Order
            </Button>
          )}

          {/* Finance: edit and activate draft */}
          {isFinance &&
            contract.status === CREDIT_CONTRACT_STATUS.DRAFT && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setFormOpen(true)}
                  className="gap-2 border-input text-foreground hover:bg-accent"
                >
                  <Pencil className="size-4" />
                  Edit Contract
                </Button>

                <Button
                  onClick={() => setDialog("activate")}
                  className="gap-2 bg-success text-primary-foreground hover:bg-success"
                >
                  <ShieldCheck className="size-4" />
                  Activate
                </Button>
              </>
            )}

          {/* Finance: complete active credit contract */}
          {isFinance && isActive && (
            <Button
              onClick={() => setPaymentOpen(true)}
              className="gap-2 bg-success text-primary-foreground hover:bg-success"
            >
              <Wallet className="size-4" />
              Complete Credit
            </Button>
          )}

          {/* Finance: cancel active contract */}
          {isFinance && isActive && (
            <Button
              variant="outline"
              onClick={() => setDialog("cancel")}
              className="gap-2 border-input text-foreground hover:bg-accent"
            >
              <XCircle className="size-4" />
              Cancel Contract
            </Button>
          )}
        </div>
      </div>

      {/* Accumulated orders */}
      {totals && (
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Accumulated Orders
            </CardTitle>

          </CardHeader>

          <CardContent className="p-0">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border bg-sidebar p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Completed Orders
                </div>

                <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {totals.completedOrderCount}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-sidebar p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Order Value (incl. VAT)
                </div>

                <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {formatCurrency(totals.fulfilledValue)}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-sidebar p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Royalty Base (excl. VAT)
                </div>

                <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {formatCurrency(totals.royaltyBase)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Paper contract attachments */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Paper Contract Attachments ({contract.attachments.length})
          </CardTitle>
        </CardHeader>

        <CardContent className="pt-0">
          {contract.attachments.length > 0 ? (
            <ul className="space-y-2">
              {contract.attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-sidebar p-2"
                >
                  <span className="flex size-10 items-center justify-center rounded border border-input bg-popover">
                    <Paperclip className="size-4 text-muted-foreground" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">
                      {attachment.fileName}
                    </div>

                    <div className="font-mono text-[10px] text-muted-foreground/70">
                      {attachment.mimeType || "unknown"} ·{" "}
                      {Math.max(
                        1,
                        Math.round(attachment.fileSize / 1024),
                      )}{" "}
                      KB
                    </div>
                  </div>

                  {(
  attachment.fileUrl ||
  `/api/credit-contracts/${encodeURIComponent(contract.id)}/attachments/${encodeURIComponent(attachment.id)}`
).startsWith("/api/") ? (
  <Button
    variant="ghost"
    size="sm"
    onClick={() =>
      setViewingAttachment({
        ...attachment,
        fileUrl:
          attachment.fileUrl ||
          `/api/credit-contracts/${encodeURIComponent(contract.id)}/attachments/${encodeURIComponent(attachment.id)}`,
      })
    }
    className="h-7 font-mono text-[10px] uppercase tracking-[0.14em] text-info hover:underline"
  >
    View
  </Button>
) : (
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                      metadata only
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No paper contract uploaded. Attachments are optional.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Payment information */}
      {report && (
        <ContractPaymentSection
          report={report}
          canManage={false}
          onEdit={() => setPaymentOpen(true)}
          title={contract.contractNumber}
        />
      )}

      {/* Completed contract financial report */}
      {isCompleted && report && (
        <ContractFinancialReportCard
          report={report}
          showFulfillment={false}
        />
      )}

      {/* Order list */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-foreground">
              Orders ({contractOrders.length})
            </CardTitle>

            {accepted && isSales && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingOrder(null);
                  setOrderDialogOpen(true);
                }}
                className="gap-1.5 border-input text-foreground hover:bg-accent"
              >
                <Plus className="size-3.5" />
                Add Order
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {contractOrders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">Order</th>
                    <th className="px-4 py-2.5 font-medium">Aggregate</th>
                    <th className="px-4 py-2.5 text-right font-medium">Quantity</th>
                    <th className="px-4 py-2.5 text-right font-medium">Unit Price</th>
                    <th className="px-4 py-2.5 text-right font-medium">Line Total (excl. VAT)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Line Total (incl. VAT)</th>
                    <th className="px-4 py-2.5 font-medium">Royalty Invoice No.</th>
                    <th className="px-4 py-2.5 font-medium">Order Date</th>
                    <th className="px-4 py-2.5 font-medium">Completed By</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>

                    {contractOrders.some(canEditOrder) && (
                      <th className="px-4 py-2.5 font-medium">Actions</th>
                    )}
                  </tr>
                </thead>

                <tbody>
                  {contractOrders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs font-medium text-foreground">
                        #{order.orderNumber}
                      </td>

                      <td className="px-4 py-2.5 text-muted-foreground">
                        {order.aggregate}
                      </td>

                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                        {order.quantity.toLocaleString()}
                      </td>

                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                        {formatCurrency(order.unitPrice)}
                      </td>

                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(order.lineTotalExclVat)}
                      </td>

                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                        {formatCurrency(order.lineTotalInclVat)}
                      </td>

                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {order.royaltyInvoiceNumber || "—"}
                      </td>

                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {formatDate(order.orderDate)}
                      </td>

                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {order.completedByName}

                        {order.completedByEmail && (
                          <span className="block font-mono text-[10px] text-muted-foreground/70">
                            {order.completedByEmail}
                          </span>
                        )}

                        {order.lastEditedByName && (
                          <span className="block text-[10px] text-muted-foreground/70">
                            Edited by {order.lastEditedByName}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-2.5">
                        <Badge
                          variant="outline"
                          className={`border text-[10px] font-medium ${
                            order.status === CREDIT_ORDER_STATUS.COMPLETED
                              ? "erp-badge-approved"
                              : "erp-badge-rejected"
                          }`}
                        >
                          {order.status}
                        </Badge>
                      </td>

                      {contractOrders.some(canEditOrder) && (
                        <td className="px-4 py-2.5 text-right">
                          {canEditOrder(order) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingOrder(order);
                                setOrderDialogOpen(true);
                              }}
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="size-3" />
                              Edit
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ScrollText className="mb-3 size-7 text-muted-foreground" />

              <p className="text-sm font-medium text-foreground">
                No orders yet
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {accepted
                  ? "Add the first order to start fulfilling this contract."
                  : "This contract is not accepting orders."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activate dialog */}
      <Dialog
        open={dialog === "activate"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className="border-input bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono text-lg font-semibold text-foreground">
              Activate Credit Contract
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              {contract.contractNumber} · {contract.customer.name}
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Activating this credit contract makes it available to the Sales
            team. Sales users can then create orders against it. Each order
            will be registered as an individual credit Sales Invoice.
          </p>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(null)}
              className="border-input"
            >
              Back
            </Button>

            <Button
              onClick={() =>
                runAction(
                  () =>
                    creditContractsRepository.activateContract(contract.id),
                  "Credit contract activated",
                )
              }
              disabled={busy}
              className="gap-2 bg-success text-primary-foreground hover:bg-success"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Activating…
                </>
              ) : (
                "Activate Contract"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog
        open={dialog === "cancel"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className="border-input bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono text-lg font-semibold text-foreground">
              Cancel Credit Contract
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              {contract.contractNumber} · {contract.customer.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This credit contract cannot accept new orders after you cancel
              it. Existing orders and their Sales Invoices remain on record.
            </p>

            <Label className="text-xs font-medium text-muted-foreground">
              Reason (required)
            </Label>

            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this contract is being cancelled…"
              rows={3}
              className="resize-y border-input bg-popover text-sm"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(null)}
              className="border-input"
            >
              Back
            </Button>

            <Button
              onClick={() =>
                runAction(
                  () =>
                    creditContractsRepository.cancelContract(
                      contract.id,
                      reason,
                    ),
                  "Credit contract cancelled",
                )
              }
              disabled={!reason.trim() || busy}
              className="gap-2 bg-destructive text-primary-foreground hover:bg-destructive/90"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Cancelling…
                </>
              ) : (
                "Cancel Contract"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credit-specific completion dialog */}
      {isFinance && (
        <CreditContractPaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          contractNumber={contract.contractNumber}
          customerName={contract.customer.name}
          creditAmount={financials?.totals.fulfilledValue ?? 0}
          onComplete={handleCompleteCredit}
        />
      )}

      {/* Finance: edit draft contract */}
      {isFinance &&
        contract.status === CREDIT_CONTRACT_STATUS.DRAFT && (
          <CreditContractFormDialog
            open={formOpen}
            onOpenChange={setFormOpen}
            onSaved={() => undefined}
            initialContract={contract}
          />
        )}

      {/* Add or edit credit order */}
      {accepted && (
        <CreditOrderDialog
          open={orderDialogOpen}
          onOpenChange={setOrderDialogOpen}
          contract={contract}
          onSaved={() => {
            setOrderDialogOpen(false);
            setEditingOrder(null);
          }}
          initialOrder={editingOrder}
        />
      )}

      {/* Attachment viewer */}
      <AttachmentViewer
        evidence={viewingAttachment}
        open={Boolean(viewingAttachment)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setViewingAttachment(null);
        }}
      />
    </div>
  );
}
