
/**
 * Finance Expenses — Workflow A (Finance-owned expenses) plus the Finance
 * review section for Workflow B (Admin-originated expenses).
 *
 * Workflow A: Finance records and manages its own expenses directly.
 * Workflow B: Admin-originated expenses submitted for Finance review.
 *
 * Payroll integration:
 * When navigating from Payroll Review with
 * { openExpenseForm: true }, automatically open a blank expense form.
 */

import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { toast } from "sonner";

import {
  Plus,
  Trash2,
  Receipt,
  Loader2,
  Paperclip,
  CheckCircle2,
  XCircle,
  Search,
  X,
  ClipboardCheck,
  ShieldCheck,
} from "lucide-react";

import {
  useFinanceExpenses,
  useFinanceReviewQueue,
} from "@/hooks/use-finance-data";

import { useAuth } from "@/hooks/use-auth";
import { actorLabel } from "@/services/auth/profile";
import { expensesRepository } from "@/services/finance/expenses";

import ExpenseFormDialog from "@/components/finance/ExpenseFormDialog";

import {
  EXPENSE_VAT_RATE,
  EXPENSE_WHT_RATE,
} from "@/services/finance/expenseCalculations";

import {
  EXPENSE_TYPE,
  EXPENSE_TYPE_LABELS,
  expenseTypeOf,
  getExpenseDisplayStatus,
  type Expense,
  type ExpenseType,
} from "@/services/finance/types";

import {
  formatCurrency,
  formatDate,
} from "@/services/sales/format";

import { roundMoney } from "@/services/sales/calc";

import {
  EXPENSE_RANGE_OPTIONS,
  resolveExpenseDateRange,
  matchesExpenseSearch,
  type ExpenseRangeKind,
} from "@/services/finance/expenseFilters";

const inputClass =
  "h-9 border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30";

const selectTriggerClass =
  "h-9 border-input bg-background text-sm text-foreground";

const selectContentClass =
  "border-border bg-popover text-popover-foreground";

const selectItemClass =
  "text-sm text-popover-foreground focus:bg-accent focus:text-accent-foreground";

const tableHeaderClass =
  "border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground";

const tableRowClass =
  "border-b border-border transition-colors last:border-0 hover:bg-muted/50";

const dialogClass =
  "border-border bg-card text-card-foreground";

const detailBoxClass =
  "rounded-lg border border-border bg-muted/50 p-3";

export default function Expenses() {
  // -----------------------------------------------------
  // ROUTER
  // -----------------------------------------------------

  const location = useLocation();
  const navigate = useNavigate();

  // -----------------------------------------------------
  // AUTHENTICATION AND DATA
  // -----------------------------------------------------

  const { user } = useAuth();
  const actor = actorLabel(user);

  const {
    data: financeExpenses,
    loading,
  } = useFinanceExpenses();

  const {
    data: reviewQueue,
  } = useFinanceReviewQueue();

  // -----------------------------------------------------
  // FORM STATE
  // -----------------------------------------------------

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  // -----------------------------------------------------
  // PAYROLL REVIEW NAVIGATION INTEGRATION
  // -----------------------------------------------------

  useEffect(() => {
    const navigationState = location.state as
      | { openExpenseForm?: boolean }
      | null;

    if (!navigationState?.openExpenseForm) {
      return;
    }

    // Always open a new blank expense form.
    setEditing(null);
    setFormOpen(true);

    // Clear navigation state so refreshing the page or returning
    // to Expenses does not reopen the form unexpectedly.
    navigate(location.pathname, {
      replace: true,
      state: null,
    });
  }, [location.pathname, location.state, navigate]);

  // -----------------------------------------------------
  // DIALOG STATE
  // -----------------------------------------------------

  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Admin expense review state.
  const [detailTarget, setDetailTarget] = useState<Expense | null>(null);
  const [approveTarget, setApproveTarget] = useState<Expense | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Expense | null>(null);

  const [rejectReason, setRejectReason] = useState("");
  const [isReviewing, setIsReviewing] = useState(false);

  // -----------------------------------------------------
  // FINANCE EXPENSE FILTERS
  // -----------------------------------------------------

  const [rangeKind, setRangeKind] =
    useState<ExpenseRangeKind>("ALL_TIME");

  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [search, setSearch] = useState("");

  const [typeFilter, setTypeFilter] =
    useState<"ALL" | ExpenseType>("ALL");

  // -----------------------------------------------------
  // DATE RANGE
  // -----------------------------------------------------

  const rangeResult = useMemo(
    () => resolveExpenseDateRange(rangeKind, customFrom, customTo),
    [rangeKind, customFrom, customTo],
  );

  // -----------------------------------------------------
  // FILTER EXPENSE RECORDS
  // -----------------------------------------------------

  const filtered = useMemo(() => {
    const list = financeExpenses ?? [];

    return list.filter(
      (expense) =>
        (!rangeResult.range ||
          (expense.date >= rangeResult.range!.start &&
            expense.date <= rangeResult.range!.end)) &&
        (typeFilter === "ALL" ||
          expenseTypeOf(expense) === typeFilter) &&
        matchesExpenseSearch(expense, search),
    );
  }, [financeExpenses, search, rangeResult, typeFilter]);

  // -----------------------------------------------------
  // FINANCIAL TOTALS
  // -----------------------------------------------------

  const totalExpenses = filtered.reduce(
    (sum, expense) =>
      sum +
      (Number.isFinite(expense.amount) ? expense.amount : 0),
    0,
  );

  const totalVat = filtered.reduce(
    (sum, expense) =>
      sum +
      (Number.isFinite(expense.vatAmount)
        ? expense.vatAmount
        : 0),
    0,
  );

  const totalWht = filtered.reduce(
    (sum, expense) =>
      sum +
      (Number.isFinite(expense.whtAmount)
        ? expense.whtAmount
        : 0),
    0,
  );

  // -----------------------------------------------------
  // APPROVE ADMIN EXPENSE
  // -----------------------------------------------------

  const confirmApprove = async () => {
    if (!approveTarget) return;

    setIsReviewing(true);

    try {
      const updated = await expensesRepository.approveAdminExpense(
        approveTarget.id,
        actor,
      );

      toast.success(
        `"${updated.item}" approved — review by ${
          updated.reviewedBy ?? actor
        }`,
      );

      setApproveTarget(null);
      setDetailTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to approve expense",
      );
    } finally {
      setIsReviewing(false);
    }
  };

  // -----------------------------------------------------
  // REJECT ADMIN EXPENSE
  // -----------------------------------------------------

  const confirmReject = async () => {
    if (!rejectTarget) return;

    if (!rejectReason.trim()) {
      toast.error("Please provide a rejection reason.");
      return;
    }

    setIsReviewing(true);

    try {
      const updated = await expensesRepository.rejectAdminExpense(
        rejectTarget.id,
        rejectReason.trim(),
        actor,
      );

      toast.success(
        `"${updated.item}" rejected with a reason — Admin can correct and resubmit it.`,
      );

      setRejectTarget(null);
      setRejectReason("");
      setDetailTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to reject expense",
      );
    } finally {
      setIsReviewing(false);
    }
  };

  // -----------------------------------------------------
  // DELETE FINANCE EXPENSE
  // -----------------------------------------------------

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      await expensesRepository.deleteExpense(deleteId);

      toast.success("Expense deleted");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete expense",
      );
    } finally {
      setDeleteId(null);
    }
  };

  // -----------------------------------------------------
  // LOADING STATE
  // -----------------------------------------------------

  if (loading && !financeExpenses) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // -----------------------------------------------------
  // FILTER STATE
  // -----------------------------------------------------

  const filtersActive =
    rangeKind !== "ALL_TIME" ||
    typeFilter !== "ALL" ||
    !!search.trim() ||
    !!customFrom ||
    !!customTo;

  const pendingQueue = reviewQueue ?? [];

  // -----------------------------------------------------
  // PAGE
  // -----------------------------------------------------

  return (
    <div className="space-y-6">

      {/* ================================================= */}
      {/* PAGE HEADER */}
      {/* ================================================= */}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Expenses
          </h1>
        </div>

        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="gap-2"
        >
          <Plus className="size-4" />
          Add Expense
        </Button>
      </div>

      {/* ================================================= */}
      {/* FINANCIAL SUMMARY */}
      {/* ================================================= */}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">

        <Card className="border-border bg-card shadow-none">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted">
              <Receipt className="size-4 text-red-500" />
            </div>

            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Total Expenses (after VAT)
              </span>

              <div className="text-xl font-semibold tabular-nums text-foreground">
                {formatCurrency(roundMoney(totalExpenses))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground">
              VAT Paid ({Math.round(EXPENSE_VAT_RATE * 100)}%)
            </span>

            <div className="mt-2 text-xl font-semibold tabular-nums text-amber-500">
              {formatCurrency(roundMoney(totalVat))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground">
              WHT Withheld ({Math.round(EXPENSE_WHT_RATE * 100)}%)
            </span>

            <div className="mt-2 text-xl font-semibold tabular-nums text-violet-500">
              {formatCurrency(roundMoney(totalWht))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground">
              Records
            </span>

            <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">
              {filtered.length}
            </div>
          </CardContent>
        </Card>

      </div>

      {/* ================================================= */}
      {/* FINANCE EXPENSE RECORDS */}
      {/* ================================================= */}

      <Card className="border-border bg-card shadow-none">

        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Expense Records
          </CardTitle>
        </CardHeader>

        {/* FILTERS */}

        <CardContent className="sticky top-0 z-0 border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-3">

            <Select
              value={rangeKind}
              onValueChange={(value) =>
                setRangeKind(value as ExpenseRangeKind)
              }
            >
              <SelectTrigger className={`${selectTriggerClass} w-40`}>
                <SelectValue />
              </SelectTrigger>

              <SelectContent className={selectContentClass}>
                {EXPENSE_RANGE_OPTIONS.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className={selectItemClass}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {rangeKind === "CUSTOM" && (
              <>
                <div className="w-40">
                  <EthiopianDatePicker
                    value={customFrom}
                    onChange={setCustomFrom}
                    placeholder="Start date"
                  />
                </div>

                <span className="text-xs text-muted-foreground">
                  to
                </span>

                <div className="w-40">
                  <EthiopianDatePicker
                    value={customTo}
                    onChange={setCustomTo}
                    placeholder="End date"
                  />
                </div>
              </>
            )}

            <Select
              value={typeFilter}
              onValueChange={(value) =>
                setTypeFilter(value as "ALL" | ExpenseType)
              }
            >
              <SelectTrigger className={`${selectTriggerClass} w-36`}>
                <SelectValue />
              </SelectTrigger>

              <SelectContent className={selectContentClass}>
                <SelectItem
                  value="ALL"
                  className={selectItemClass}
                >
                  All types
                </SelectItem>

                {(
                  [
                    EXPENSE_TYPE.STANDARD,
                    EXPENSE_TYPE.CASUAL,
                  ] as const
                ).map((type) => (
                  <SelectItem
                    key={type}
                    value={type}
                    className={selectItemClass}
                  >
                    {EXPENSE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search item, category, type, bank, reference, amount..."
                className={`${inputClass} w-full pl-9`}
              />
            </div>

            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setRangeKind("ALL_TIME");
                  setTypeFilter("ALL");
                  setCustomFrom("");
                  setCustomTo("");
                }}
                className="gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
                Clear
              </Button>
            )}

          </div>

          {rangeResult.error && (
            <p className="mt-2 text-xs text-destructive">
              {rangeResult.error}
            </p>
          )}
        </CardContent>

        {/* EXPENSE TABLE */}

        <CardContent className="p-0">
          {filtered.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">

                <thead>
                  <tr className={tableHeaderClass}>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 font-medium">Item</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 text-right font-medium">Before VAT</th>
                    <th className="px-4 py-2.5 text-right font-medium">VAT</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total / After VAT</th>
                    <th className="px-4 py-2.5 text-right font-medium">WHT</th>
                    <th className="px-4 py-2.5 text-right font-medium">Transferred</th>
                    <th className="px-4 py-2.5 font-medium">Bank</th>
                    <th className="px-4 py-2.5 font-medium">Attachments</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((expense) => {
                    const display = getExpenseDisplayStatus(expense);

                    return (
                      <tr
                        key={expense.id}
                        className={tableRowClass}
                      >

                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {formatDate(expense.date)}
                        </td>

                        <td className="px-4 py-2.5 text-muted-foreground">
                          {expense.category || "—"}
                        </td>

                        <td className="px-4 py-2.5 text-foreground">
                          {expense.item}
                        </td>

                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`border text-[10px] font-medium ${
                              expenseTypeOf(expense) === EXPENSE_TYPE.CASUAL
                                ? "erp-badge-draft"
                                : "erp-badge-approved"
                            }`}
                          >
                            {EXPENSE_TYPE_LABELS[expenseTypeOf(expense)]}
                          </Badge>
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatCurrency(expense.amountBeforeVat ?? 0)}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-amber-500">
                          {expenseTypeOf(expense) === EXPENSE_TYPE.CASUAL
                            ? "N/A"
                            : formatCurrency(expense.vatAmount ?? 0)}
                        </td>

                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-red-500">
                          {formatCurrency(expense.amount)}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-violet-500">
                          {expense.whtAmount
                            ? formatCurrency(expense.whtAmount)
                            : "—"}
                        </td>

                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">
                          {formatCurrency(
                            expense.totalTransferred ?? expense.amount,
                          )}
                        </td>

                        <td className="px-4 py-2.5 text-muted-foreground">
                          {expense.bank || "—"}

                          {expense.paymentReference && (
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {expense.paymentReference}
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-2.5">
                          <div className="flex gap-1">

                            {expense.invoiceAttachment && (
                              <span
                                title={`Invoice: ${expense.invoiceAttachment.fileName}`}
                              >
                                <Paperclip className="size-3 text-blue-500" />
                              </span>
                            )}

                            {expense.whtAttachment && (
                              <span
                                title={`WHT: ${expense.whtAttachment.fileName}`}
                              >
                                <Paperclip className="size-3 text-violet-500" />
                              </span>
                            )}

                            {!expense.invoiceAttachment &&
                              !expense.whtAttachment &&
                              "—"}

                          </div>
                        </td>

                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`border text-[10px] font-medium ${display.badgeClass}`}
                          >
                            {display.label}
                          </Badge>
                        </td>

                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">

                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-blue-500"
                              title="Edit this expense"
                              onClick={() => {
                                setEditing(expense);
                                setFormOpen(true);
                              }}
                            >
                              Edit
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteId(expense.id)}
                            >
                              <Trash2 className="size-3" />
                              Delete
                            </Button>

                          </div>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>

              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">

              <Receipt className="mb-3 size-8 text-muted-foreground" />

              <p className="text-sm font-medium text-foreground">
                No expenses match the current filters
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {filtersActive
                  ? "Try a different date range or search."
                  : "Add operational expenses to track costs and calculate Net Profit."}
              </p>

              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                className="mt-4 gap-2"
                size="sm"
              >
                <Plus className="size-3.5" />
                Add Expense
              </Button>

            </div>
          )}
        </CardContent>
      </Card>

      {/* ================================================= */}
      {/* ADMIN EXPENSE REVIEW */}
      {/* ================================================= */}

      <Card className="border-border bg-card shadow-none">

        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="size-4 text-success" />

            <CardTitle className="text-sm font-medium text-foreground">
              Admin Expense Review
            </CardTitle>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {pendingQueue.length > 0 ? (
            <ReviewQueue
              queue={pendingQueue}
              onApprove={(expense) => setApproveTarget(expense)}
              onReject={(expense) => setRejectTarget(expense)}
              onView={(expense) => setDetailTarget(expense)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">

              <ShieldCheck className="mb-3 size-8 text-muted-foreground" />

              <p className="text-sm font-medium text-foreground">
                No Admin expenses awaiting review
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Expenses Admin submits for review appear here.
              </p>

            </div>
          )}
        </CardContent>
      </Card>

      {/* ================================================= */}
      {/* CREATE / EDIT EXPENSE DIALOG */}
      {/* ================================================= */}

      <ExpenseFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);

          if (!open) {
            setEditing(null);
          }
        }}
        mode="finance"
        initial={editing}
      />

      {/* ================================================= */}
      {/* ADMIN EXPENSE DETAIL DIALOG */}
      {/* ================================================= */}

      <ExpenseReviewDetail
        expense={detailTarget}
        onClose={() => setDetailTarget(null)}
        onApprove={() => {
          if (detailTarget) {
            setApproveTarget(detailTarget);
            setDetailTarget(null);
          }
        }}
        onReject={() => {
          if (detailTarget) {
            setRejectTarget(detailTarget);
            setDetailTarget(null);
          }
        }}
      />

      {/* ================================================= */}
      {/* APPROVE CONFIRMATION */}
      {/* ================================================= */}

      <Dialog
        open={!!approveTarget}
        onOpenChange={(open) => {
          if (!open && !isReviewing) {
            setApproveTarget(null);
          }
        }}
      >
        <DialogContent className={`${dialogClass} sm:max-w-md`}>

          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">
              Approve Expense
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              Approve{" "}
              <span className="font-medium text-foreground">
                "{approveTarget?.item}"
              </span>{" "}
              ({formatCurrency(approveTarget?.amount ?? 0)} after VAT)
              submitted by{" "}
              <span className="font-medium text-foreground">
                {approveTarget?.submittedBy ?? "Admin"}
              </span>
              ? Approved expenses become eligible for the financial reports
              and are counted exactly once.
            </DialogDescription>
          </DialogHeader>

          {approveTarget && (
            <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">

              <div className="grid grid-cols-3 gap-2">

                <div>
                  <span className="block">Before VAT</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(approveTarget.amountBeforeVat ?? 0)}
                  </span>
                </div>

                <div>
                  <span className="block">VAT</span>
                  <span className="font-medium text-foreground">
                    {expenseTypeOf(approveTarget) === EXPENSE_TYPE.CASUAL
                      ? "N/A"
                      : formatCurrency(approveTarget.vatAmount ?? 0)}
                  </span>
                </div>

                <div>
                  <span className="block">WHT</span>
                  <span className="font-medium text-foreground">
                    {approveTarget.whtAmount
                      ? formatCurrency(approveTarget.whtAmount)
                      : "—"}
                  </span>
                </div>

              </div>
            </div>
          )}

          <DialogFooter>

            <Button
              variant="ghost"
              onClick={() => setApproveTarget(null)}
              disabled={isReviewing}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>

            <Button
              onClick={confirmApprove}
              disabled={isReviewing}
              className="gap-2"
            >
              {isReviewing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}

              Approve Expense
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================= */}
      {/* REJECT CONFIRMATION */}
      {/* ================================================= */}

      <Dialog
        open={!!rejectTarget}
        onOpenChange={(open) => {
          if (!open && !isReviewing) {
            setRejectTarget(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent className={`${dialogClass} sm:max-w-md`}>

          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">
              Reject Expense
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              The record returns to Admin as Rejected with your reason —
              Admin can correct and resubmit the same record. A meaningful
              reason is required.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">

            <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {rejectTarget?.item}
              </span>{" "}
              · {formatCurrency(rejectTarget?.amount ?? 0)} after VAT
            </div>

            <div>
              <Textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Why is this expense rejected? (required)"
                rows={3}
                className="resize-none border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/30"
              />
            </div>

          </div>

          <DialogFooter>

            <Button
              variant="ghost"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
              }}
              disabled={isReviewing}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>

            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={isReviewing || !rejectReason.trim()}
              className="gap-2"
            >
              {isReviewing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <XCircle className="size-4" />
              )}

              Reject Expense
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================= */}
      {/* DELETE CONFIRMATION */}
      {/* ================================================= */}

      <Dialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteId(null);
          }
        }}
      >
        <DialogContent className={`${dialogClass} sm:max-w-sm`}>

          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">
              Delete Expense
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              Are you sure you want to delete this expense? This will affect
              the Net Profit calculation.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>

            <Button
              variant="ghost"
              onClick={() => setDeleteId(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>

            <Button
              variant="destructive"
              onClick={handleDelete}
              className="gap-2"
            >
              <Trash2 className="size-4" />
              Delete
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

/* ===================================================== */
/* ADMIN EXPENSE REVIEW QUEUE                            */
/* ===================================================== */

function ReviewQueue({
  queue,
  onApprove,
  onReject,
  onView,
}: {
  queue: Expense[];
  onApprove: (expense: Expense) => void;
  onReject: (expense: Expense) => void;
  onView: (expense: Expense) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">

        <thead>
          <tr className={tableHeaderClass}>
            <th className="px-4 py-2.5 font-medium">Date</th>
            <th className="px-4 py-2.5 font-medium">Category</th>
            <th className="px-4 py-2.5 font-medium">Item</th>
            <th className="px-4 py-2.5 text-right font-medium">Before VAT</th>
            <th className="px-4 py-2.5 text-right font-medium">VAT</th>
            <th className="px-4 py-2.5 text-right font-medium">Total / After VAT</th>
            <th className="px-4 py-2.5 text-right font-medium">WHT</th>
            <th className="px-4 py-2.5 text-right font-medium">Transferred</th>
            <th className="px-4 py-2.5 font-medium">Bank</th>
            <th className="px-4 py-2.5 font-medium">Attachments</th>
            <th className="px-4 py-2.5 font-medium">Submitted By</th>
            <th className="px-4 py-2.5 font-medium">Submitted</th>
            <th className="px-4 py-2.5 text-right font-medium">Actions</th>
          </tr>
        </thead>

        <tbody>
          {queue.map((expense) => (
            <tr
              key={expense.id}
              className={tableRowClass}
            >

              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                {formatDate(expense.date)}
              </td>

              <td className="px-4 py-2.5 text-muted-foreground">
                {expense.category || "—"}
              </td>

              <td className="px-4 py-2.5 text-foreground">
                {expense.item}

                <div className="text-[10px] text-muted-foreground">
                  {EXPENSE_TYPE_LABELS[expenseTypeOf(expense)]}
                </div>
              </td>

              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                {formatCurrency(expense.amountBeforeVat ?? 0)}
              </td>

              <td className="px-4 py-2.5 text-right tabular-nums text-amber-500">
                {expenseTypeOf(expense) === EXPENSE_TYPE.CASUAL
                  ? "N/A"
                  : formatCurrency(expense.vatAmount ?? 0)}
              </td>

              <td className="px-4 py-2.5 text-right font-medium tabular-nums text-red-500">
                {formatCurrency(expense.amount)}
              </td>

              <td className="px-4 py-2.5 text-right tabular-nums text-violet-500">
                {expense.whtAmount
                  ? formatCurrency(expense.whtAmount)
                  : "—"}
              </td>

              <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">
                {formatCurrency(
                  expense.totalTransferred ?? expense.amount,
                )}
              </td>

              <td className="px-4 py-2.5 text-muted-foreground">
                {expense.bank || "—"}
              </td>

              <td className="px-4 py-2.5">
                <div className="flex gap-1">

                  {expense.invoiceAttachment && (
                    <span
                      title={`Invoice: ${expense.invoiceAttachment.fileName}`}
                    >
                      <Paperclip className="size-3 text-blue-500" />
                    </span>
                  )}

                  {expense.whtAttachment && (
                    <span
                      title={`WHT: ${expense.whtAttachment.fileName}`}
                    >
                      <Paperclip className="size-3 text-violet-500" />
                    </span>
                  )}

                  {!expense.invoiceAttachment &&
                    !expense.whtAttachment &&
                    "—"}

                </div>
              </td>

              <td className="px-4 py-2.5 text-xs text-muted-foreground">
                {expense.submittedBy || "—"}
              </td>

              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                {expense.submittedAt
                  ? formatDate(expense.submittedAt)
                  : "—"}
              </td>

              <td className="px-4 py-2.5 text-right">
                <div className="flex items-center justify-end gap-1">

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => onView(expense)}
                  >
                    View Details
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs text-success hover:text-success"
                    onClick={() => onApprove(expense)}
                  >
                    <CheckCircle2 className="size-3" />
                    Approve
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => onReject(expense)}
                  >
                    <XCircle className="size-3" />
                    Reject
                  </Button>

                </div>
              </td>

            </tr>
          ))}
        </tbody>

      </table>
    </div>
  );
}

/* ===================================================== */
/* ADMIN EXPENSE DETAIL DIALOG                           */
/* ===================================================== */

/**
 * Full breakdown + attachments of a pending Admin expense.
 * Opening this dialog changes nothing.
 */
function ExpenseReviewDetail({
  expense,
  onClose,
  onApprove,
  onReject,
}: {
  expense: Expense | null;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <Dialog
      open={!!expense}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className={`max-h-[85vh] overflow-y-auto ${dialogClass} sm:max-w-2xl`}>

        {expense && (
          <>
            <DialogHeader>
              <DialogTitle className="font-heading text-lg font-semibold text-foreground">
                {expense.item}
              </DialogTitle>

              <DialogDescription className="text-sm text-muted-foreground">
                Full expense breakdown submitted by Admin. Opening this
                dialog does not change anything.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">

              {/* BASIC INFORMATION */}

              <div className="grid gap-3 sm:grid-cols-3">

                <div className={detailBoxClass}>
                  <div className="text-xs text-muted-foreground">
                    Expense Date
                  </div>

                  <div className="mt-1 font-medium text-foreground">
                    {formatDate(expense.date)}
                  </div>
                </div>

                <div className={detailBoxClass}>
                  <div className="text-xs text-muted-foreground">
                    Category
                  </div>

                  <div className="mt-1 font-medium text-foreground">
                    {expense.category || "—"}
                  </div>
                </div>

                <div className={detailBoxClass}>
                  <div className="text-xs text-muted-foreground">
                    Type
                  </div>

                  <div className="mt-1 font-medium text-foreground">
                    {EXPENSE_TYPE_LABELS[expenseTypeOf(expense)]}
                  </div>
                </div>

              </div>

              {/* AMOUNT BREAKDOWN */}

              <div className={detailBoxClass}>

                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Expense amount breakdown
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">

                  <div>
                    <div className="text-xs text-muted-foreground">
                      Before VAT
                    </div>

                    <div className="mt-1 tabular-nums text-foreground">
                      {formatCurrency(expense.amountBeforeVat ?? 0)}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground">
                      {expenseTypeOf(expense) === EXPENSE_TYPE.CASUAL
                        ? "VAT"
                        : `VAT (${Math.round(EXPENSE_VAT_RATE * 100)}%)`}
                    </div>

                    <div className="mt-1 tabular-nums text-amber-500">
                      {expenseTypeOf(expense) === EXPENSE_TYPE.CASUAL
                        ? "Not applicable"
                        : formatCurrency(expense.vatAmount ?? 0)}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground">
                      Total / After VAT
                    </div>

                    <div className="mt-1 font-medium tabular-nums text-foreground">
                      {formatCurrency(expense.amount)}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground">
                      WHT ({expense.whtEnabled ? "3%" : "OFF"})
                    </div>

                    <div className="mt-1 tabular-nums text-violet-500">
                      {expense.whtAmount
                        ? formatCurrency(expense.whtAmount)
                        : "—"}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground">
                      Total Transferred
                    </div>

                    <div className="mt-1 font-medium tabular-nums text-success">
                      {formatCurrency(
                        expense.totalTransferred ?? expense.amount,
                      )}
                    </div>
                  </div>

                </div>
              </div>

              {/* PAYMENT INFORMATION AND TIMELINE */}

              <div className="grid gap-3 sm:grid-cols-2">

                <div className={detailBoxClass}>

                  <div className="text-xs text-muted-foreground">
                    Bank / Payment info
                  </div>

                  <div className="mt-1 font-medium text-foreground">
                    {expense.bank ||
                      (expenseTypeOf(expense) === EXPENSE_TYPE.CASUAL
                        ? "Not provided (optional)"
                        : "Not provided")}
                  </div>

                  {expense.paymentParty && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Party: {expense.paymentParty}
                    </div>
                  )}

                  {expense.paymentReference && (
                    <div className="font-mono text-xs text-muted-foreground">
                      Ref: {expense.paymentReference}
                    </div>
                  )}

                </div>

                <div className={detailBoxClass}>

                  <div className="text-xs text-muted-foreground">
                    Timeline
                  </div>

                  <div className="mt-1 space-y-1 text-xs text-muted-foreground">

                    <div>
                      Created{" "}
                      {formatDate(expense.createdAt, { time: true })}
                    </div>

                    {expense.submittedAt && (
                      <div>
                        Submitted{" "}
                        {formatDate(expense.submittedAt, { time: true })}

                        {expense.submittedBy
                          ? ` by ${expense.submittedBy}`
                          : ""}
                      </div>
                    )}

                  </div>
                </div>

              </div>

              {/* REMARK */}

              {expense.remark && (
                <div className={detailBoxClass}>

                  <div className="text-xs text-muted-foreground">
                    Remark
                  </div>

                  <div className="mt-1 text-foreground">
                    {expense.remark}
                  </div>

                </div>
              )}

              {/* ATTACHMENTS */}

              <div className={detailBoxClass}>

                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Attachments
                </div>

                {[
                  expense.invoiceAttachment,
                  expense.whtAttachment,
                ].filter(Boolean).length > 0 ? (
                  <ul className="space-y-1.5">

                    {[
                      expense.invoiceAttachment,
                      expense.whtAttachment,
                    ]
                      .filter(Boolean)
                      .map((attachment) =>
                        attachment ? (
                          <li key={attachment.id}>
                            <span
                              title={`${attachment.fileName}${
                                attachment.mimeType
                                  ? ` · ${attachment.mimeType}`
                                  : ""
                              }`}
                              className="inline-flex items-center gap-1.5 text-xs text-blue-500"
                            >
                              <Paperclip className="size-3" />
                              {attachment.fileName}
                            </span>
                          </li>
                        ) : null,
                      )}

                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No attachments
                  </p>
                )}

                <p className="mt-2 text-[10px] text-muted-foreground">
                  Note: attachments are stored as browser-session metadata
                  until proper backend file storage exists — downloads can
                  only resolve when the same session is available.
                </p>

              </div>

            </div>

            <DialogFooter>

              <Button
                onClick={onApprove}
                className="gap-2"
              >
                <CheckCircle2 className="size-4" />
                Approve
              </Button>

              <Button
                variant="destructive"
                onClick={onReject}
                className="gap-2"
              >
                <XCircle className="size-4" />
                Reject
              </Button>

              <Button
                variant="ghost"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground"
              >
                Close
              </Button>

            </DialogFooter>
          </>
        )}

      </DialogContent>
    </Dialog>
  );
}
