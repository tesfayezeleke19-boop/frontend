
/**
 * Contract detail — the working screen for ONE contract.
 *
 * Finance: customer/contract information, paper-contract attachments,
 * fulfillment summary, order history, payment information, and explicit
 * Finance completion confirmation.
 * Sales: the same contract information and attachments, and the Add Order
 * action for any active contract (no assignment needed).
 *
 * Completed orders keep their royalty basis here with the salesperson
 * attribution. The shared Royalty Report lives in its own Finance page.
 */
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

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
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
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

import { ContractPaymentDialog } from "@/components/contracts/ContractPaymentDialog";
import { ContractPaymentSection } from "@/components/contracts/ContractPaymentSection";

import {
  CONTRACT_ORDER_STATUS,
  CONTRACT_STATUS,
  CONTRACT_STATUS_UI,
  canAddOrders,
  type ContractAttachment,
  type ContractOrder,
} from "@/services/contracts/types";

import {
  formatCurrency,
  formatDate,
  formatQuantity,
} from "@/services/sales/format";

import { ContractFormDialog } from "@/components/contracts/ContractFormDialog";
import { ContractOrderDialog } from "@/components/contracts/ContractOrderDialog";
import { AttachmentViewer } from "@/components/contracts/AttachmentViewer";

type DialogKind = "activate" | "complete" | null;

/**
 * Display labels for the order status column.
 *
 * Pending and approved orders are Submitted.
 * Completed orders are Reported.
 * Cancelled orders remain Cancelled.
 */
function getOrderDisplayStatus(status: ContractOrder["status"]) {
  const normalizedStatus = String(status).toUpperCase();

  if (normalizedStatus === CONTRACT_ORDER_STATUS.CANCELLED) {
    return {
      label: "Cancelled",
      className: "erp-badge-rejected",
    };
  }

  if (normalizedStatus === CONTRACT_ORDER_STATUS.COMPLETED) {
    return {
      label: "Reported",
      className: "erp-badge-approved",
    };
  }

  return {
    label: "Submitted",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-600",
  };
}

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

  const {
    data: contract,
    loading,
    refresh: refreshContract,
  } = useContract(id);

  const {
    data: orders,
    refresh: refreshOrders,
  } = useContractOrders(id);

  const {
    data: progress,
    refresh: refreshProgress,
  } = useContractProgress(id);

  const {
    data: report,
    refresh: refreshReport,
  } = useContractFinancialReport(id);

  const refreshAll = () => {
    refreshContract();
    refreshOrders();
    refreshProgress();
    refreshReport();
  };

  const [formOpen, setFormOpen] = useState(false);
  const [financialOpen, setFinancialOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);

  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<ContractOrder | null>(null);

  const [viewingAttachment, setViewingAttachment] =
    useState<ContractAttachment | null>(null);

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

  // Use the actual amounts to calculate fulfillment.
  // This avoids depending on an outdated percentage property.
  const contractValue = Number(
    progress?.contractValue ??
      report?.contractValue ??
      contract.contractValue ??
      0,
  );

  const fulfilledValue = Number(
    progress?.fulfilledValue ??
      report?.fulfilledValue ??
      0,
  );

  const fulfillmentPercent =
    contractValue > 0
      ? (fulfilledValue / contractValue) * 100
      : 0;

  const remainingValue = Math.max(
    0,
    contractValue - fulfilledValue,
  );

  const fullyFulfilled = fulfillmentPercent >= 100;

  const invalidContractValue = contractValue <= 0;

  const accepted =
    Boolean(progress) &&
    canAddOrders(contract, contractOrders);

  const canEditOrder = (order: ContractOrder) =>
    contract.status !== CONTRACT_STATUS.COMPLETED &&
    order.status === CONTRACT_ORDER_STATUS.COMPLETED &&
    (
      isFinance ||
      (
        isSales &&
        !session?.isGuest &&
        order.completedByUserId === user?.id
      )
    );

  // Financial calculations requested for the payment section.
  const vatRate = 0.15;
const vatAmount = contractValue * vatRate;

const withholdingRateFromApi = Number(
  report?.withholding?.rate ?? 0,
);

const withholdingEnabled = withholdingRateFromApi > 0;

const withholdingAmount = withholdingEnabled
  ? contractValue * withholdingRateFromApi
  : 0;
  const runAction = async (
    action: () => Promise<unknown>,
    success: string,
  ) => {
    setBusy(true);

    try {
      await action();

      refreshAll();

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
                (
                  CONTRACT_STATUS_UI[contract.status] ?? {
                    className:
                      "border-border bg-muted text-muted-foreground",
                    label: contract.status,
                  }
                ).className
              }`}
            >
              {
                (
                  CONTRACT_STATUS_UI[contract.status] ?? {
                    label: contract.status,
                  }
                ).label
              }
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

          {isFinance && contract.status === CONTRACT_STATUS.ACTIVE && (
            <Button
              onClick={() => setDialog("complete")}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <CheckCircle2 className="size-4" />
              Confirm Completion
            </Button>
          )}
        </div>
      </div>

      {/* Completed contract notice */}
      {contract.status === CONTRACT_STATUS.COMPLETED && (
        <div className="flex items-start gap-3 rounded-lg border border-success-border bg-success-soft p-3.5 text-xs text-muted-foreground">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />

          <p className="leading-relaxed">
            This contract was explicitly marked Completed by Finance
            {contract.completionConfirmedBy
              ? ` (${contract.completionConfirmedBy})`
              : ""}
            {contract.completionConfirmedAt
              ? ` on ${formatDate(contract.completionConfirmedAt, {
                  time: true,
                })}`
              : ""}
            . The contract is read-only.
            {contract.completionReason
              ? ` Reason: ${contract.completionReason}`
              : ""}
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

            <div className="mt-2 flex items-baseline gap-2">
              <div className="text-2xl font-semibold tabular-nums text-foreground">
                {fulfillmentPercent.toFixed(2)}%
              </div>
            </div>

            {/* Progress bar calculated from fulfilledValue / contractValue */}
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-accent">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  progress?.overFulfilled
                    ? "bg-warning"
                    : "bg-success"
                }`}
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(0, fulfillmentPercent),
                  )}%`,
                }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/70">
              <span>
                {formatCurrency(fulfilledValue)} fulfilled
              </span>

              <span>
                {formatCurrency(contractValue)} total
              </span>
            </div>

          </CardContent>
        </Card>

        {[
          {
            label: "Contract Value",
            value: formatCurrency(contractValue),
          },
          {
            label: "Fulfilled Value",
            value: formatCurrency(fulfilledValue),
          },
          {
            label: "Remaining Value",
            value: formatCurrency(remainingValue),
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

      {/* Invalid contract value */}
      {invalidContractValue &&
        contract.status !== CONTRACT_STATUS.COMPLETED && (
          <div className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-soft p-3.5 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />

            <p className="leading-relaxed">
              This contract has no valid contract value, so Sales order entry
              is closed. Finance must recreate the contract or correct it while
              it is still a draft before any further order can be added.
            </p>
          </div>
        )}

      {/* Fully fulfilled notice */}
      {fullyFulfilled &&
        contract.status !== CONTRACT_STATUS.COMPLETED && (
          <div className="flex items-start gap-3 rounded-lg border border-success-border bg-success-soft p-3.5 text-xs text-muted-foreground">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />

            <p className="leading-relaxed">
              This contract has reached 100% fulfillment. Its lifecycle remains
              ACTIVE until Finance explicitly confirms completion. No
              automatic status change or invoice conversion occurs.
            </p>
          </div>
        )}

      {/* Over-fulfilled notice */}
      {progress?.overFulfilled && (
        <div className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-soft p-3.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />

          <p className="leading-relaxed">
            Fulfilled value exceeds the contract value. Finance should review
            the over-fulfillment before confirming completion.
          </p>
        </div>
      )}

      {/* Payment information */}
      {report && (
        <div className="space-y-3">
          <ContractPaymentSection
            report={report}
            canManage={
              isFinance &&
              contract.status !== CONTRACT_STATUS.COMPLETED
            }
            onEdit={() => setFinancialOpen(true)}
            title={contract.contractNumber}
          />

          {/* Contract VAT and withholding calculations */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Contract VAT & Withholding
              </CardTitle>

              
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-sidebar p-3">
                <div>
                  <p className="text-xs font-medium text-foreground">
                    VAT (15%)
                  </p>

                  <p className="mt-1 text-[11px] text-muted-foreground">
                    15% of contract value
                  </p>
                </div>

                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {formatCurrency(vatAmount)}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-sidebar p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-foreground">
                      Withholding (3%)
                    </p>

                    <Badge
                      variant="outline"
                      className={
                        withholdingEnabled
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-border bg-muted text-muted-foreground"
                      }
                    >
                      {withholdingEnabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>

                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {withholdingEnabled
                      ? "3% of contract value"
                      : "Withholding is not enabled for this contract"}
                  </p>
                </div>

                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {formatCurrency(withholdingAmount)}
                </p>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs font-medium text-muted-foreground">
                  Contract Value
                </span>

                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {formatCurrency(contractValue)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
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
                  {attachment.fileUrl?.startsWith("blob:") ? (
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

                  {attachment.fileUrl?.startsWith("/api/") ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewingAttachment(attachment)}
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
              No paper contract attached. Attachments are optional and can
              only be changed while the contract is in Draft.
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

        </CardHeader>

        <CardContent className="p-0">
          {contractOrders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">
                      Order
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Date
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Aggregate
                    </th>

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

                    <th className="px-4 py-2.5 font-medium">
                      Completed By
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Status
                    </th>

                  </tr>
                </thead>

                <tbody>
                  {contractOrders.map((order) => {
                    const displayStatus = getOrderDisplayStatus(
                      order.status,
                    );

                    return (
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
                            {order.completedByName || "—"}
                          </div>

                          <div className="font-mono text-[10px] text-muted-foreground/70">
                            {order.completedAt
                              ? formatDate(order.completedAt)
                              : "—"}

                            {order.lastEditedByName && (
                              <> · edited by {order.lastEditedByName}</>
                            )}
                          </div>
                        </td>

                        {/* Status column */}
                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`border text-[10px] font-medium ${displayStatus.className}`}
                          >
                            {displayStatus.label}
                          </Badge>
                        </td>

                        
                      </tr>
                    );
                  })}
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
                            (order) =>
                              order.status ===
                              CONTRACT_ORDER_STATUS.COMPLETED,
                          )
                          .reduce(
                            (sum, order) => sum + order.quantity,
                            0,
                          ),
                      )}
                    </td>

                    <td />
                    <td />

                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-foreground">
                      {formatCurrency(fulfilledValue)}
                    </td>

                    <td
                      colSpan={3}
                      className="px-4 py-2.5 text-[11px] text-muted-foreground/70"
                    >
                      Fulfilled value of completed orders
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

      {/* Payment + withholding dialog */}
      {isFinance && financialOpen && report && (
        <ContractPaymentDialog
          contractNumber={contract.contractNumber}
          report={report}
          onClose={() => setFinancialOpen(false)}
          onSave={async (input) => {
            await contractsRepository.saveFinancialInformation(
              contract.id,
              input,
            );

            refreshAll();
            setFinancialOpen(false);
          }}
        />
      )}

      {/* Contract form dialog */}
      {isFinance && (
        <ContractFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          contract={contract}
          onSaved={refreshAll}
        />
      )}

      {/* Contract order dialog */}
      {(isSales || isFinance) && (
        <ContractOrderDialog
          open={orderDialogOpen}
          onOpenChange={(open) => {
            setOrderDialogOpen(open);

            if (!open) {
              setEditingOrder(null);
            }
          }}
          contract={contract}
          order={editingOrder}
          onSaved={refreshAll}
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
              {contract.contractNumber} becomes Active and available to
              authorized Sales users for order entry. The contract remains
              separate from Sales Invoice creation.
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
                  `${contract.contractNumber} is now Active`,
                )
              }
              className="gap-2 bg-success text-primary-foreground hover:bg-success"
            >
              {busy && (
                <Loader2 className="size-4 animate-spin" />
              )}

              Activate
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
              {fulfilledValue < contractValue
                ? `Fulfilled value (${formatCurrency(
                    fulfilledValue,
                  )}) is below the contract value (${formatCurrency(
                    contractValue,
                  )}). Closing below value requires a recorded reason.`
                : "Finance will mark this contract as Completed. Completed contracts become read-only."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              {fulfilledValue < contractValue
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
              disabled={
                busy ||
                (
                  fulfilledValue < contractValue &&
                  !reason.trim()
                )
              }
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
              {busy && (
                <Loader2 className="size-4 animate-spin" />
              )}

              Confirm Completion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attachment viewer */}
      <AttachmentViewer
        evidence={viewingAttachment}
        open={Boolean(viewingAttachment)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setViewingAttachment(null);
          }
        }}
      />
    </div>
  );
}
