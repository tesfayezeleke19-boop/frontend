
/** Credit Contract detail — the working screen for ONE credit contract.

Finance: customer/contract information, fulfillment summary, order history,
status actions (activate, cancel, finalize into a Sales Invoice), and the
audit trail.

Sales: the same contract information and the Add Order action for any active
credit contract (no assignment needed).

Completed orders keep their royalty basis here. The shared Royalty Report lives
in the existing Royalty Reports page — this screen never duplicates it, and
contract orders reach that report once the backend persists them.
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
  CheckCircle2,
  FileText,
  Loader2,
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
  useCreditContract,
  useCreditContractOrders,
  useCreditContractFinancials,
  useCreditContractFinancialReport,
} from "@/hooks/use-credit-contracts-data";

import { creditContractsRepository } from "@/services/creditContracts/repository";

import { ContractFinancialReportCard } from "@/components/contracts/ContractFinancialReportCard";
import { ContractPaymentDialog } from "@/components/contracts/ContractPaymentDialog";
import { ContractPaymentSection } from "@/components/contracts/ContractPaymentSection";

import {
  CREDIT_CONTRACT_STATUS,
  CREDIT_CONTRACT_STATUS_UI,
  CREDIT_ORDER_STATUS,
  creditContractAcceptsOrders,
  type CreditContractOrder,
} from "@/services/creditContracts/types";

import { formatCurrency } from "@/services/sales/format";

import { CreditContractFormDialog } from "@/components/credit-contracts/CreditContractFormDialog";
import { CreditOrderDialog } from "@/components/credit-contracts/CreditOrderDialog";

/**
 * Display date values in the Ethiopian calendar.
 * Date-only API strings are parsed at local noon to avoid timezone shifts.
 */
function formatEthiopianDate(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  const date =
    typeof value === "number"
      ? new Date(value)
      : new Date(
          /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? `${value}T12:00:00`
            : value,
        );

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-ET-u-ca-ethiopic-nu-latn", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

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
  const [financialOpen, setFinancialOpen] = useState(false);

  const [dialog, setDialog] = useState<
    "activate" | "cancel" | "finalize" | null
  >(null);

  const [orderDialogOpen, setOrderDialogOpen] = useState(false);

  const [editingOrder, setEditingOrder] =
    useState<CreditContractOrder | null>(null);

  const [reason, setReason] = useState("");
  const [fsNo, setFsNo] = useState("");

  const [busy, setBusy] = useState(false);

  if (loading && !contract) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2
          className="size-7 animate-spin text-muted-foreground"
          aria-label="Loading contract"
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
          onClick={() =>
            navigate(`${portalBase}/credit-contracts`)
          }
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

  const canEditOrder = (order: CreditContractOrder) =>
    contract.status !== CREDIT_CONTRACT_STATUS.INVOICED &&
    order.status === CREDIT_ORDER_STATUS.COMPLETED &&
    (
      isFinance ||
      (
        isSales &&
        order.completedByUserId === user?.id
      )
    );

  const progress = financials?.progress;

  const closedBelowValue =
    Boolean(contract.closedBelowValue) ||
    (
      !!progress &&
      progress.fulfilledValue < progress.contractValue
    );

  const runAction = async (
    action: () => Promise<unknown>,
    success: string,
  ) => {
    if (busy) return;

    setBusy(true);

    try {
      await action();

      toast.success(success);

      setDialog(null);
      setReason("");
      setFsNo("");
    } catch (error: unknown) {
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
            {contract.customer.tin} · FS No{" "}
            {contract.fsNo || "—"} ·{" "}
            {formatEthiopianDate(contract.contractDate)}
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
                  onClick={() => {
                    setDialog("activate");
                  }}
                  className="gap-2 bg-success text-primary-foreground hover:bg-success"
                >
                  <ShieldCheck className="size-4" />
                  Activate
                </Button>
              </>
            )}

          {isFinance &&
            contract.status === CREDIT_CONTRACT_STATUS.ACTIVE && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setDialog("cancel")}
                  className="gap-2 border-input text-foreground hover:bg-accent"
                >
                  <XCircle className="size-4" />
                  Cancel Contract
                </Button>

                <Button
                  onClick={() => setDialog("finalize")}
                  className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <CheckCircle2 className="size-4" />
                  Finalize
                </Button>
              </>
            )}
        </div>
      </div>

      {/* Fulfillment summary */}
      {progress && (
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Fulfillment
            </CardTitle>
          </CardHeader>

          <CardContent className="p-0">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border bg-sidebar p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Contract Value
                </div>

                <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {formatCurrency(progress.contractValue)}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-sidebar p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Fulfilled Value
                </div>

                <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {formatCurrency(progress.fulfilledValue)}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-sidebar p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Remaining
                </div>

                <div className="mt-1 text-lg font-semibold tabular-nums text-muted-foreground">
                  {formatCurrency(progress.remainingValue)}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-sidebar p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Fulfillment
                </div>

                <div className="mt-1 flex items-center gap-2">
                  <div className="h-3 overflow-hidden rounded-full border border-border bg-muted">
                    <div
                      className={`h-full transition-all ${
                        progress.fulfillmentPercent >= 100
                          ? "bg-success"
                          : progress.fulfillmentPercent >= 70
                            ? "bg-warning"
                            : "bg-info"
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          progress.fulfillmentPercent,
                        )}%`,
                      }}
                    />
                  </div>

                  <span className="text-sm font-medium tabular-nums text-foreground">
                    {progress.fulfillmentPercent.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment information */}
      {report && (
        <ContractPaymentSection
          report={report}
          canManage={
            isFinance &&
            contract.status !== CREDIT_CONTRACT_STATUS.CANCELLED
          }
          onEdit={() => setFinancialOpen(true)}
          title={contract.contractNumber}
        />
      )}

      {/* Completed-contract financial report */}
      {contract.status === CREDIT_CONTRACT_STATUS.INVOICED && report && (
        <ContractFinancialReportCard report={report} />
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
                    <th className="px-4 py-2.5 text-right font-medium">
                      Quantity
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Unit Price
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Line Total (excl. VAT)
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Line Total (incl. VAT)
                    </th>
                    <th className="px-4 py-2.5 font-medium">
                      Royalty Invoice No.
                    </th>
                    <th className="px-4 py-2.5 font-medium">Order Date</th>
                    <th className="px-4 py-2.5 font-medium">Completed By</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>

                    {(isFinance || contractOrders.some(canEditOrder)) && (
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
                        {formatEthiopianDate(order.orderDate)}
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

                      {(isFinance ||
                        (
                          canEditOrder(order) &&
                          order.status === CREDIT_ORDER_STATUS.COMPLETED
                        )) && (
                        <td className="px-4 py-2.5 text-right">
                          {canEditOrder(order) &&
                            order.status === CREDIT_ORDER_STATUS.COMPLETED && (
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
          if (!open && !busy) {
            setDialog(null);
          }
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

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to activate this credit contract?
              Once activated, Sales users will be able to add orders
              against this contract.
            </p>

            <div className="rounded-lg border border-border bg-sidebar p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Customer</span>

                <span className="font-medium text-foreground">
                  {contract.customer.name}
                </span>
              </div>

              <div className="mt-2 flex justify-between gap-3">
                <span className="text-muted-foreground">
                  Contract Value
                </span>

                <span className="font-medium text-foreground">
                  {formatCurrency(contract.contractValue)}
                </span>
              </div>

              <div className="mt-2 flex justify-between gap-3">
                <span className="text-muted-foreground">
                  Current Status
                </span>

                <span className="font-medium text-foreground">
                  DRAFT
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialog(null)}
              disabled={busy}
              className="border-input"
            >
              Cancel
            </Button>

            <Button
              type="button"
              onClick={() =>
                runAction(
                  () =>
                    creditContractsRepository.activateContract(
                      contract.id,
                    ),
                  "Credit contract activated successfully",
                )
              }
              disabled={busy}
              className="gap-2 bg-success text-primary-foreground hover:bg-success"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Activating...
                </>
              ) : (
                <>
                  <ShieldCheck className="size-4" />
                  Confirm Activation
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog
        open={dialog === "cancel"}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDialog(null);
          }
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
              This credit contract cannot accept new orders after you cancel it.
              Completed orders stay on the record; the contract is not converted
              into a Sales Invoice.
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
              disabled={busy}
              className="border-input"
            >
              Cancel
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

      {/* Finalize dialog */}
      <Dialog
        open={dialog === "finalize"}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDialog(null);
          }
        }}
      >
        <DialogContent className="border-input bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono text-lg font-semibold text-foreground">
              Finalize Credit Contract
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              {contract.contractNumber} · {contract.customer.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {progress && (
              <div className="rounded-lg border border-border bg-sidebar p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">
                  Fulfillment: {progress.fulfillmentPercent.toFixed(1)}% ·{" "}
                  {formatCurrency(progress.fulfilledValue)} of{" "}
                  {formatCurrency(progress.contractValue)}
                </div>

                {closedBelowValue &&
                  progress?.fulfillmentPercent !== undefined &&
                  progress.fulfillmentPercent < 100 && (
                    <div className="mt-1 text-warning">
                      Below contract value — a reason is required to finalize.
                    </div>
                  )}
              </div>
            )}

            <Label className="text-xs font-medium text-muted-foreground">
              FS No (required)
            </Label>

            <input
              type="text"
              value={fsNo}
              onChange={(e) => setFsNo(e.target.value)}
              placeholder="e.g. 2704301"
              className="h-9 rounded-md border border-input bg-popover text-sm"
            />

            {progress &&
              closedBelowValue &&
              progress.fulfillmentPercent < 100 && (
                <>
                  <Label className="text-xs font-medium text-muted-foreground">
                    Reason for shortfall (required)
                  </Label>

                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Explain why the contract is being finalized below its value…"
                    rows={3}
                    className="resize-y border-input bg-popover text-sm"
                  />
                </>
              )}

            <p className="text-xs text-muted-foreground">
              Finalizing creates exactly one Sales Invoice for all completed
              orders. The contract is then invoiced and its orders are frozen.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(null)}
              disabled={busy}
              className="border-input"
            >
              Cancel
            </Button>

            <Button
              onClick={() =>
                runAction(
                  () =>
                    creditContractsRepository.finalizeContract(
                      contract.id,
                      {
                        fsNo: fsNo || "",
                        reason: reason || undefined,
                      },
                    ),
                  "Credit contract finalized",
                )
              }
              disabled={
                !fsNo.trim() ||
                (
                  closedBelowValue &&
                  progress?.fulfillmentPercent !== undefined &&
                  progress.fulfillmentPercent < 100 &&
                  !reason.trim()
                ) ||
                busy
              }
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Finalizing…
                </>
              ) : (
                "Finalize"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment information dialog */}
      {isFinance && financialOpen && report && (
        <ContractPaymentDialog
          contractId={contract.id}
          contractNumber={contract.contractNumber}
          report={report}
          onClose={() => setFinancialOpen(false)}
          onSave={async (input) => {
            await creditContractsRepository.saveFinancialInformation(
              contract.id,
              input,
            );
          }}
        />
      )}

      {/* Edit contract dialog */}
      {isFinance &&
        contract.status === CREDIT_CONTRACT_STATUS.DRAFT && (
          <CreditContractFormDialog
            open={formOpen}
            onOpenChange={setFormOpen}
            onSaved={() => undefined}
            initialContract={contract}
          />
        )}

      {/* Add/Edit order dialog */}
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
    </div>
  );
}
