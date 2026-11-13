
/**
 * Contract detail — the working screen for ONE contract.
 *
 * Finance: customer/contract information, paper-contract attachments,
 * fulfillment summary, order history, completion confirmation, cancellation,
 * and conversion into the contract's single Sales Invoice.
 * Sales: the same contract information and attachments, and the Add Order
 * action for any active contract (no assignment needed).
 *
 * Completed orders keep their royalty basis here with the salesperson
 * attribution. The shared Royalty Report lives in its own Finance page.
 */
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { USER_ROLES } from "@/services/auth";
import {
  useContract,
  useContractFinancialReport,
  useContractOrders,
  useContractProgress,
} from "@/hooks/use-contracts-data";
import { contractsRepository } from "@/services/contracts";
import { ContractFinancialReportCard } from "@/components/contracts/ContractFinancialReportCard";
import { ContractPaymentDialog } from "@/components/contracts/ContractPaymentDialog";
import { ContractPaymentSection } from "@/components/contracts/ContractPaymentSection";
import {
  CONTRACT_ORDER_STATUS,
  CONTRACT_STATUS,
  CONTRACT_STATUS_UI,
  canAcceptOrders,
  type ContractOrder,
} from "@/services/contracts/types";
import {
  formatCurrency,
  formatDate,
  formatQuantity,
} from "@/services/sales/format";
import { ContractFormDialog } from "@/components/contracts/ContractFormDialog";
import { ContractOrderDialog } from "@/components/contracts/ContractOrderDialog";

type DialogKind =
  | "activate"
  | "ready"
  | "complete"
  | "cancel"
  | "convert"
  | null;

export default function ContractDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, session } = useAuth();

  const isFinance = user?.role === USER_ROLES.FINANCE;
  const isSales = user?.role === USER_ROLES.SALES && !session?.isGuest;

  const portalBase = location.pathname.startsWith("/finance")
    ? "/finance"
    : "/sales";

  const { data: contract, loading } = useContract(id);
  const { data: orders } = useContractOrders(id);
  const { data: progress } = useContractProgress(id);
  const { data: report } = useContractFinancialReport(id);

  const [formOpen, setFormOpen] = useState(false);
  const [financialOpen, setFinancialOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<ContractOrder | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading && !contract) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FileText className="mb-3 size-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          Contract not found
        </p>
        <Button
          variant="outline"
          onClick={() => navigate(`${portalBase}/contracts`)}
          className="mt-4 border-input text-foreground hover:bg-accent"
        >
          Back to Contract Orders
        </Button>
      </div>
    );
  }

  const contractOrders = orders ?? [];
  const accepted = canAcceptOrders(contract.status);

  const canEditOrder = (order: ContractOrder) =>
    contract.status !== CONTRACT_STATUS.CONVERTED &&
    order.status === CONTRACT_ORDER_STATUS.COMPLETED &&
    (isFinance ||
      (isSales &&
        !session?.isGuest &&
        order.completedByUserId === user?.id));

  const confirmed = Boolean(contract.completionConfirmedAt);
  const converted = contract.status === CONTRACT_STATUS.CONVERTED;

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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            onClick={() => navigate(`${portalBase}/contracts`)}
            className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 transition-colors hover:text-muted-foreground"
          >
            <ArrowLeft className="size-3" />
            Contract Orders
          </button>

          <div className="flex items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold text-foreground">
              {contract.contractNumber}
            </h1>

            <Badge
              variant="outline"
              className={`border text-[10px] font-medium ${
                CONTRACT_STATUS_UI[contract.status].className
              }`}
            >
              {CONTRACT_STATUS_UI[contract.status].label}
            </Badge>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            {contract.customer.name} · TIN {contract.customer.tin} · FS No{" "}
            {contract.fsNo} · {formatDate(contract.contractDate)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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

          {isFinance && contract.status === CONTRACT_STATUS.DRAFT && (
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

          {isFinance &&
            contract.status === CONTRACT_STATUS.IN_PROGRESS && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setDialog("ready")}
                  className="gap-2 border-input text-foreground hover:bg-accent"
                >
                  <ScrollText className="size-4" />
                  Request Completion Review
                </Button>

                <Button
                  onClick={() => setDialog("complete")}
                  className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <CheckCircle2 className="size-4" />
                  Confirm Completion
                </Button>
              </>
            )}

          {isFinance &&
            contract.status === CONTRACT_STATUS.READY_FOR_COMPLETION && (
              <>
                {!confirmed && (
                  <Button
                    onClick={() => setDialog("complete")}
                    className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <CheckCircle2 className="size-4" />
                    Confirm Completion
                  </Button>
                )}

                <Button
                  onClick={() => setDialog("convert")}
                  disabled={!confirmed}
                  className="gap-2 bg-success text-primary-foreground hover:bg-success disabled:opacity-50"
                >
                  <RefreshCw className="size-4" />
                  Convert to Sales Invoice
                </Button>
              </>
            )}

          {isFinance &&
            (contract.status === CONTRACT_STATUS.DRAFT ||
              contract.status === CONTRACT_STATUS.IN_PROGRESS ||
              contract.status === CONTRACT_STATUS.READY_FOR_COMPLETION) && (
              <Button
                variant="outline"
                onClick={() => setDialog("cancel")}
                className="gap-2 border-destructive-border text-destructive hover:bg-destructive-soft"
              >
                <XCircle className="size-4" />
                Cancel Contract
              </Button>
            )}
        </div>
      </div>

      {/* Conversion / cancellation context */}
      {converted && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-success-border bg-success-soft p-3.5 text-xs text-muted-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-success" />

          <p className="leading-relaxed">
            Converted into Sales Invoice{" "}
            <span className="font-mono font-medium text-foreground">
              {contract.salesInvoiceNumber}
            </span>{" "}
            on{" "}
            {contract.convertedAt
              ? formatDate(contract.convertedAt, { time: true })
              : "—"}
            . The invoice enters the existing Finance review workflow; this
            contract no longer accepts new orders.
          </p>

          {isFinance && contract.salesInvoiceId && (
            <Link
              to={`/finance/review/detail/${contract.salesInvoiceId}`}
              className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-info hover:underline"
            >
              Open Sales Invoice
            </Link>
          )}
        </div>
      )}

      {contract.status === CONTRACT_STATUS.CANCELLED && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive-border bg-destructive-soft p-3.5 text-xs text-muted-foreground">
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />

          <p className="leading-relaxed">
            Cancelled by {contract.cancelledBy} on{" "}
            {contract.cancelledAt
              ? formatDate(contract.cancelledAt, { time: true })
              : "—"}{" "}
            — reason:{" "}
            <span className="text-foreground">
              {contract.cancellationReason}
            </span>
            .
          </p>
        </div>
      )}

      {/* Progress */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card className="border-border bg-card shadow-none lg:col-span-2">
          <CardContent className="p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              Fulfillment
            </div>

            <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
              {progress?.fulfillmentPercent ?? 0}%
            </div>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-accent">
              <div
                className={`h-full rounded-full ${
                  progress?.overFulfilled ? "bg-warning" : "bg-success"
                }`}
                style={{
                  width: `${Math.min(
                    100,
                    progress?.fulfillmentPercent ?? 0,
                  )}%`,
                }}
              />
            </div>

            <div className="mt-2 text-[11px] text-muted-foreground/70">
              Contract value and fulfilled value are compared VAT-inclusive.
            </div>
          </CardContent>
        </Card>

        {[
          {
            label: "Contract Value",
            value: formatCurrency(progress?.contractValue ?? 0),
          },
          {
            label: "Fulfilled Value",
            value: formatCurrency(progress?.fulfilledValue ?? 0),
          },
          {
            label: "Remaining Value",
            value: formatCurrency(progress?.remainingValue ?? 0),
          },
        ].map((item) => (
          <Card
            key={item.label}
            className="border-border bg-card shadow-none"
          >
            <CardContent className="p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                {item.label}
              </div>

              <div className="mt-2 text-lg font-semibold tabular-nums text-foreground">
                {item.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {(progress?.overFulfilled ||
        contract.status === CONTRACT_STATUS.READY_FOR_COMPLETION) && (
        <div className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-soft p-3.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />

          <p className="leading-relaxed">
            {progress?.overFulfilled
              ? "Fulfilled value exceeds the contract value — Finance must review the over-fulfillment before confirming completion. The contract is not converted automatically."
              : "This contract reached its completion review. Finance must explicitly confirm completion before it can be converted into a Sales Invoice."}

            {contract.completionConfirmedAt &&
              ` Completion confirmed by ${contract.completionConfirmedBy}${
                contract.closedBelowValue
                  ? ` — closed below contract value: ${contract.completionReason}`
                  : ""
              }.`}
          </p>
        </div>
      )}

      {/* Payment information — optional, and never a payment confirmation */}
      {report && (
        <ContractPaymentSection
          report={report}
          canManage={
            isFinance &&
            contract.status !== CONTRACT_STATUS.CANCELLED
          }
          onEdit={() => setFinancialOpen(true)}
          title={contract.contractNumber}
        />
      )}

      {/* Completed-contract financial report — stays available afterwards */}
      {(confirmed || converted) && report && (
        <ContractFinancialReportCard report={report} />
      )}

      {/* Attachments */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Paper Contract Attachments ({contract.attachments.length})
          </CardTitle>

          {isFinance && contract.status === CONTRACT_STATUS.DRAFT && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFormOpen(true)}
              className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="size-3" />
              Add / replace
            </Button>
          )}
        </CardHeader>

        <CardContent className="pt-0">
          {contract.attachments.length > 0 ? (
            <ul className="space-y-2">
              {contract.attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-sidebar p-2"
                >
                  {attachment.fileUrl ? (
                    <img
                      src={attachment.fileUrl}
                      alt={attachment.fileName}
                      className="size-10 rounded border border-input object-cover"
                    />
                  ) : (
                    <span className="flex size-10 items-center justify-center rounded border border-input bg-popover">
                      <Paperclip className="size-4 text-muted-foreground" />
                    </span>
                  )}

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

                  {attachment.fileUrl ? (
                    <a
                      href={attachment.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] uppercase tracking-[0.14em] text-info hover:underline"
                    >
                      View
                    </a>
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
              No paper contract attached. Attachments are optional and are
              preserved through activation, completion, and conversion.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Orders */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Contract Orders ({contractOrders.length})
          </CardTitle>

          <p className="text-xs text-muted-foreground/70">
            Completed orders are persisted centrally with their salesperson
            attribution and contribute to the shared Royalty Report.
          </p>
        </CardHeader>

        <CardContent className="p-0">
          {contractOrders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">Order</th>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Aggregate</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Quantity (m³)
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Unit Price
                    </th>
                    <th className="px-4 py-2.5 font-medium">
                      Royalty Invoice No
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Total (VAT-excl)
                    </th>
                    <th className="px-4 py-2.5 font-medium">Completed By</th>
                    <th className="px-4 py-2.5 font-medium">
                      Royalty Report
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {contractOrders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs font-medium text-foreground">
                        Order {order.orderNumber}
                      </td>

                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {formatDate(order.orderDate)}
                      </td>

                      <td className="px-4 py-2.5 text-muted-foreground">
                        {order.aggregate}
                      </td>

                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                        {formatQuantity(order.quantity)}
                      </td>

                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(order.unitPrice)}
                      </td>

                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {order.royaltyInvoiceNumber || "—"}
                      </td>

                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">
                        {formatCurrency(order.lineTotalExclVat)}
                      </td>

                      <td className="px-4 py-2.5 text-foreground">
                        <div className="text-xs font-medium">
                          {order.completedByName}
                        </div>

                        <div className="font-mono text-[10px] text-muted-foreground/70">
                          {formatDate(order.completedAt)}
                          {order.lastEditedByName && (
                            <> · edited by {order.lastEditedByName}</>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-2.5">
                        {order.status ===
                        CONTRACT_ORDER_STATUS.COMPLETED ? (
                          <Badge
                            variant="outline"
                            className="erp-badge-approved border text-[10px] font-medium"
                          >
                            Reported
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="erp-badge-rejected border text-[10px] font-medium"
                          >
                            Cancelled
                            {order.cancelReason
                              ? ` — ${order.cancelReason}`
                              : ""}
                          </Badge>
                        )}
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
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
                              Correct
                            </Button>
                          )}

                          {isFinance &&
                            !converted &&
                            order.status ===
                              CONTRACT_ORDER_STATUS.COMPLETED && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const value = window.prompt(
                                    "Cancellation reason for this order (kept in the audit history)?",
                                  );

                                  if (!value?.trim()) return;

                                  runAction(
                                    () =>
                                      contractsRepository.cancelOrder(
                                        order.id,
                                        value,
                                      ),
                                    `Order ${order.orderNumber} cancelled — its royalty entry was reversed`,
                                  );
                                }}
                                className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                              >
                                <XCircle className="size-3" />
                                Cancel
                              </Button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>

                <tfoot>
                  <tr className="border-t border-border bg-sidebar">
                    <td
                      colSpan={3}
                      className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70"
                    >
                      Totals
                    </td>

                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-foreground">
                      {formatQuantity(
                        contractOrders
                          .filter(
                            (o) =>
                              o.status ===
                              CONTRACT_ORDER_STATUS.COMPLETED,
                          )
                          .reduce((sum, o) => sum + o.quantity, 0),
                      )}
                    </td>

                    <td />
                    <td />

                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-foreground">
                      {formatCurrency(progress?.fulfilledValue ?? 0)}
                    </td>

                    <td
                      colSpan={3}
                      className="px-4 py-2.5 text-[11px] text-muted-foreground/70"
                    >
                      Fulfilled value (VAT-inclusive) of completed orders
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ScrollText className="mb-3 size-8 text-muted-foreground" />

              <p className="text-sm font-medium text-foreground">
                No orders recorded yet
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {isSales && accepted
                  ? "Complete the first order for this contract — it is recorded here with your attribution and royalty basis."
                  : "Once the contract is active, any authorized Sales user can complete orders for it."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment + withholding dialog (Finance only) */}
      {isFinance && financialOpen && report && (
        <ContractPaymentDialog
          contractId={contract.id}
          contractNumber={contract.contractNumber}
          report={report}
          onClose={() => setFinancialOpen(false)}
          onSave={async (input) => {
            await contractsRepository.saveFinancialInformation(
              contract.id,
              input,
            );
          }}
        />
      )}

      {/* Dialogs */}
      {isFinance && (
        <ContractFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          contract={contract}
          onSaved={() => undefined}
        />
      )}

      {(isSales || isFinance) && (
        <ContractOrderDialog
          open={orderDialogOpen}
          onOpenChange={(open) => {
            setOrderDialogOpen(open);
            if (!open) setEditingOrder(null);
          }}
          contract={contract}
          order={editingOrder}
          onSaved={() => undefined}
        />
      )}

      {/* Activate */}
      <Dialog
        open={dialog === "activate"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="border-input bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Activate contract?
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              {contract.contractNumber} becomes available to every authorized
              Sales user, who can then complete orders under it. Creating the
              contract does not create a Sales Invoice.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(null)}
              className="border-input text-foreground hover:bg-accent"
            >
              Cancel
            </Button>

            <Button
              disabled={busy}
              onClick={() =>
                runAction(
                  () =>
                    contractsRepository.activateContract(contract.id),
                  `${contract.contractNumber} is now In Progress`,
                )
              }
              className="gap-2 bg-success text-primary-foreground hover:bg-success"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Activate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request completion review */}
      <Dialog
        open={dialog === "ready"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="border-input bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Flag for completion review?
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              Marks {contract.contractNumber} as Ready for Completion. The
              contract is not completed or converted automatically — Finance
              still confirms completion and starts the conversion explicitly.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(null)}
              className="border-input text-foreground hover:bg-accent"
            >
              Cancel
            </Button>

            <Button
              disabled={busy}
              onClick={() =>
                runAction(
                  () =>
                    contractsRepository.requestCompletion(contract.id),
                  `${contract.contractNumber} is Ready for Completion`,
                )
              }
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Flag for Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm completion */}
      <Dialog
        open={dialog === "complete"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="border-input bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Confirm completion
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              {progress &&
              progress.fulfilledValue < progress.contractValue
                ? `Fulfilled value (${formatCurrency(
                    progress.fulfilledValue,
                  )}) is below the contract value (${formatCurrency(
                    progress.contractValue,
                  )}). Closing below value requires a recorded reason.`
                : "Completion is confirmed by Finance; the contract is not converted until you start the conversion."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              {progress &&
              progress.fulfilledValue < progress.contractValue
                ? "Reason (required)"
                : "Note (optional)"}
            </Label>

            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="border-input bg-popover text-sm text-foreground"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(null)}
              className="border-input text-foreground hover:bg-accent"
            >
              Cancel
            </Button>

            <Button
              disabled={busy}
              onClick={() =>
                runAction(
                  () =>
                    contractsRepository.confirmCompletion(
                      contract.id,
                      reason,
                    ),
                  "Completion confirmed",
                )
              }
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Confirm Completion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel contract */}
      <Dialog
        open={dialog === "cancel"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="border-input bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Cancel contract
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              {contract.contractNumber} will stop accepting orders. Completed
              orders keep their records and audit history, but their royalty
              entries stop being counted as active amounts. A reason is
              required.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Cancellation reason *
            </Label>

            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="border-input bg-popover text-sm text-foreground"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(null)}
              className="border-input text-foreground hover:bg-accent"
            >
              Keep contract
            </Button>

            <Button
              disabled={busy}
              onClick={() =>
                runAction(
                  () =>
                    contractsRepository.cancelContract(
                      contract.id,
                      reason,
                    ),
                  `${contract.contractNumber} cancelled`,
                )
              }
              className="gap-2 bg-destructive text-primary-foreground hover:bg-destructive"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Cancel Contract
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert */}
      <Dialog
        open={dialog === "convert"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="border-input bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Convert into one Sales Invoice?
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              {
                contractOrders.filter(
                  (o) =>
                    o.status === CONTRACT_ORDER_STATUS.COMPLETED,
                ).length
              }{" "}
              completed orders, one FS No ({contract.fsNo}), customer{" "}
              {contract.customer.name}. Exactly ONE Sales Invoice is created
              and enters the existing Finance review workflow. Royalty
              entries already reported for these orders are reconciled — no
              duplicates are created.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(null)}
              className="border-input text-foreground hover:bg-accent"
            >
              Cancel
            </Button>

            <Button
              disabled={busy}
              onClick={() =>
                runAction(
                  async () => {
                    const result =
                      await contractsRepository.convertContractToInvoice(
                        contract.id,
                      );

                    toast.success(
                      `Sales Invoice ${result.invoiceNumber} created`,
                    );
                  },
                  `${contract.contractNumber} converted`,
                )
              }
              className="gap-2 bg-success text-primary-foreground hover:bg-success"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Convert to Sales Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
