
/**
 * Admin Expenses — Workflow B: expenses created by Admin/management that
 * require Finance review.
 *
 * DRAFT → PENDING_FINANCE_REVIEW → APPROVED
 *                         or REJECTED → correct → resubmit
 */
import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  ClipboardCheck,
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Send,
  X,
} from "lucide-react";
import { useAdminExpenses } from "@/hooks/use-finance-data";
import { useAuth } from "@/hooks/use-auth";
import { actorLabel } from "@/services/auth/profile";
import { expensesRepository } from "@/services/finance/expenses";
import ExpenseFormDialog from "@/components/finance/ExpenseFormDialog";
import {
  EXPENSE_TYPE,
  getExpenseDisplayStatus,
  type Expense,
} from "@/services/finance/types";
import { matchesExpenseSearch } from "@/services/finance/expenseFilters";
import { formatCurrency, formatDate } from "@/services/sales/format";
import { roundMoney } from "@/services/sales/calc";

const inputClass =
  "h-9 border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30";

const selectTriggerClass =
  "h-9 border-input bg-popover text-sm text-foreground";

type StatusFilter = "ALL" | "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";

type ExpenseCategory = "STANDARD" | "CASUAL";

type AdminExpenseApiFields = {
  expense_category?: string | null;
  expenseCategory?: string | null;
  category?: string | null;
  expense_type?: string | null;
  expenseType?: string | null;
  type?: string | null;
};

/**
 * Category is STANDARD or CASUAL.
 * Always read the category field, never the actual expense type field.
 */
function getAdminExpenseCategory(expense: Expense): string {
  const record = expense as Expense & AdminExpenseApiFields;

  return String(
    record.expense_category ??
      record.expenseCategory ??
      record.category ??
      "",
  )
    .trim()
    .toUpperCase();
}

/**
 * Type is the actual expense type, for example Fuel, Rent, or Maintenance.
 * Never use Category as a fallback for Type.
 */
function getAdminExpenseType(expense: Expense): string {
  const record = expense as Expense & AdminExpenseApiFields;

  return String(
    record.expense_type ??
      record.expenseType ??
      record.type ??
      "",
  ).trim();
}

export default function AdminExpenses() {
  const { user } = useAuth();
  const actor = actorLabel(user);
  const { data: expenses, loading } = useAdminExpenses();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [categoryFilter, setCategoryFilter] =
    useState<"ALL" | ExpenseCategory>("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [detail, setDetail] = useState<Expense | null>(null);
  const [submitTarget, setSubmitTarget] = useState<Expense | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const rangeBounds = useMemo(() => {
    let error = "";

    const from = fromDate
      ? new Date(`${fromDate}T00:00:00`).getTime()
      : null;

    const to = toDate
      ? new Date(`${toDate}T23:59:59.999`).getTime()
      : null;

    if (from !== null && Number.isNaN(from)) {
      error = "Invalid start date";
    } else if (to !== null && Number.isNaN(to)) {
      error = "Invalid end date";
    } else if (from !== null && to !== null && from > to) {
      error = "Start date must not be after the end date";
    }

    return { from, to, error };
  }, [fromDate, toDate]);

  const filtered = useMemo(() => {
    const list = expenses ?? [];
    const { from, to } = rangeBounds;

    return list.filter((expense) => {
      if (status === "DRAFT" && expense.reviewStatus !== "DRAFT") {
        return false;
      }

      if (
        status === "PENDING" &&
        expense.reviewStatus !== "PENDING_FINANCE_REVIEW"
      ) {
        return false;
      }

      if (status === "APPROVED" && expense.reviewStatus !== "APPROVED") {
        return false;
      }

      if (status === "REJECTED" && expense.reviewStatus !== "REJECTED") {
        return false;
      }

      // Category filter: STANDARD or CASUAL.
      if (
        categoryFilter !== "ALL" &&
        getAdminExpenseCategory(expense) !== categoryFilter
      ) {
        return false;
      }

      if (from !== null && !Number.isNaN(from) && expense.date < from) {
        return false;
      }

      if (to !== null && !Number.isNaN(to) && expense.date > to) {
        return false;
      }

      return matchesExpenseSearch(expense, search);
    });
  }, [expenses, search, status, categoryFilter, rangeBounds]);

  const counts = useMemo(() => {
    const list = expenses ?? [];

    return {
      drafts: list.filter((e) => e.reviewStatus === "DRAFT").length,
      pending: list.filter(
        (e) => e.reviewStatus === "PENDING_FINANCE_REVIEW",
      ).length,
      approved: list.filter((e) => e.reviewStatus === "APPROVED").length,
      rejected: list.filter((e) => e.reviewStatus === "REJECTED").length,
      pendingAmount: roundMoney(
        list
          .filter((e) => e.reviewStatus === "PENDING_FINANCE_REVIEW")
          .reduce(
            (sum, e) => sum + (Number.isFinite(e.amount) ? e.amount : 0),
            0,
          ),
      ),
    };
  }, [expenses]);

  const handleSubmit = async () => {
    if (!submitTarget) return;

    setIsSubmitting(true);

    try {
      const updated = await expensesRepository.submitAdminExpense(
        submitTarget.id,
        actor,
      );

      toast.success(
        `"${updated.item}" submitted to Finance for review — the same record ID is preserved.`,
      );

      setSubmitTarget(null);
      setDetail(null);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to submit expense",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = (expense: Expense) =>
    expense.reviewStatus === "DRAFT" ||
    expense.reviewStatus === "REJECTED";

  const canEdit = (expense: Expense) =>
    expense.reviewStatus === "DRAFT" ||
    expense.reviewStatus === "REJECTED" ||
    (expense.createdBy ?? "").trim().toLowerCase() === actor.toLowerCase();

  if (loading && !expenses) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
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
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          Create Expense
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="border-border bg-card shadow-none">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-9 items-center justify-center rounded-lg border border-input bg-popover">
              <FileText className="size-4 text-foreground" />
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Drafts
              </span>
              <div className="text-xl font-semibold tabular-nums text-foreground">
                {counts.drafts}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`shadow-none ${
            counts.pending > 0
              ? "border-warning-border bg-warning-soft"
              : "border-border bg-card"
          }`}
        >
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground">
              Pending Finance Review
            </span>
            <div className="mt-2 font-heading text-xl font-semibold tabular-nums text-foreground">
              {counts.pending} · {formatCurrency(counts.pendingAmount)}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
              not yet counted in approved expense totals
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground">
              Approved
            </span>
            <div className="mt-2 font-heading text-xl font-semibold tabular-nums text-success">
              {counts.approved}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
              counted exactly once in the reports
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground">
              Rejected
            </span>
            <div className="mt-2 font-heading text-xl font-semibold tabular-nums text-destructive">
              {counts.rejected}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
              excluded until corrected and resubmitted
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search item, category, type, bank, reference, amount..."
              className={`${inputClass} w-full pl-9`}
            />
          </div>

          <Select
            value={categoryFilter}
            onValueChange={(value) =>
              setCategoryFilter(value as "ALL" | ExpenseCategory)
            }
          >
            <SelectTrigger className={`${selectTriggerClass} w-36`}>
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="border-input bg-popover">
              <SelectItem
                value="ALL"
                className="text-sm text-foreground focus:bg-accent"
              >
                All categories
              </SelectItem>

              <SelectItem
                value="STANDARD"
                className="text-sm text-foreground focus:bg-accent"
              >
                Standard
              </SelectItem>

              <SelectItem
                value="CASUAL"
                className="text-sm text-foreground focus:bg-accent"
              >
                Casual
              </SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={status}
            onValueChange={(value) =>
              setStatus(value as StatusFilter)
            }
          >
            <SelectTrigger className={`${selectTriggerClass} w-48`}>
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="border-input bg-popover">
              {(
                [
                  ["ALL", "All statuses"],
                  ["DRAFT", "Draft"],
                  ["PENDING", "Pending Finance Review"],
                  ["APPROVED", "Approved"],
                  ["REJECTED", "Rejected"],
                ] as const
              ).map(([value, label]) => (
                <SelectItem
                  key={value}
                  value={value}
                  className="text-sm text-foreground focus:bg-accent"
                >
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="w-40">
            <EthiopianDatePicker
              value={fromDate}
              onChange={setFromDate}
              placeholder="Start date"
            />
          </div>

          <span className="text-xs text-muted-foreground/70">to</span>

          <div className="w-40">
            <EthiopianDatePicker
              value={toDate}
              onChange={setToDate}
              placeholder="End date"
            />
          </div>

          {(search ||
            status !== "ALL" ||
            categoryFilter !== "ALL" ||
            fromDate ||
            toDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStatus("ALL");
                setCategoryFilter("ALL");
                setFromDate("");
                setToDate("");
              }}
              className="gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
              Clear
            </Button>
          )}
        </CardContent>

        {rangeBounds.error && (
          <CardContent className="pt-0">
            <p className="text-xs text-destructive">
              {rangeBounds.error}
            </p>
          </CardContent>
        )}
      </Card>

      {/* Expense list */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Admin Expenses ({filtered.length})
          </CardTitle>
          <p className="text-xs text-muted-foreground/70">
            Filtered view count — not an all-time total.
          </p>
        </CardHeader>

        <CardContent className="p-0">
          {filtered.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">Expense Date</th>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 font-medium">Item</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Total / After VAT
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">WHT</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Transferred
                    </th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Submitted</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((expense) => {
                    const display = getExpenseDisplayStatus(expense);
                    const category = getAdminExpenseCategory(expense);
                    const expenseType = getAdminExpenseType(expense);

                    return (
                      <tr
                        key={expense.id}
                        className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {formatDate(expense.date)}
                        </td>

                        <td className="px-4 py-2.5 text-muted-foreground">
                          {category || "—"}
                        </td>

                        <td className="px-4 py-2.5 text-foreground">
                          {expense.item}
                          <div className="font-mono text-[10px] text-muted-foreground/70">
                            {expense.id.slice(0, 8)}
                          </div>
                        </td>

                        <td className="px-4 py-2.5 text-foreground">
                          {expenseType || "—"}
                        </td>

                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-destructive">
                          {formatCurrency(expense.amount)}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-violet">
                          {expense.whtAmount
                            ? formatCurrency(expense.whtAmount)
                            : "—"}
                        </td>

                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">
                          {formatCurrency(
                            expense.totalTransferred ?? expense.amount,
                          )}
                        </td>

                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`border text-[10px] font-medium ${display.badgeClass}`}
                          >
                            {display.label}
                          </Badge>

                          {expense.reviewStatus === "REJECTED" &&
                            expense.rejectionReason && (
                              <div
                                className="mt-0.5 max-w-[220px] truncate text-[10px] text-destructive"
                                title={expense.rejectionReason}
                              >
                                Reason: {expense.rejectionReason}
                              </div>
                            )}

                          {expense.reviewStatus === "APPROVED" &&
                            expense.reviewedBy && (
                              <div className="mt-0.5 text-[10px] text-success">
                                by {expense.reviewedBy}
                              </div>
                            )}
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
                              onClick={() => setDetail(expense)}
                            >
                              <Paperclip className="size-3" />
                              View
                            </Button>

                            {canEdit(expense) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs text-muted-foreground hover:text-info"
                                onClick={() => {
                                  setEditing(expense);
                                  setFormOpen(true);
                                }}
                              >
                                <Pencil className="size-3" />
                                Edit
                              </Button>
                            )}

                            {canSubmit(expense) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs text-success hover:text-success"
                                onClick={() => setSubmitTarget(expense)}
                              >
                                <Send className="size-3" />
                                Submit
                              </Button>
                            )}
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
              <ClipboardCheck className="mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                No expenses match the filters
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create an expense draft and submit it for Finance review.
              </p>
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                className="mt-4 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                size="sm"
              >
                <Plus className="size-3.5" />
                Create Expense
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / edit dialog */}
      <ExpenseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode="admin"
        initial={editing}
      />

      {/* Detail dialog */}
      <Dialog
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto border-input bg-card sm:max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading text-lg font-semibold text-foreground">
                  {detail.item}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Full record — opening this dialog does not change anything.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="rounded-lg border border-border bg-sidebar p-3">
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Amount breakdown
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div>
                      <div className="text-xs text-muted-foreground">
                        Expense date
                      </div>
                      <div className="mt-1 text-foreground">
                        {formatDate(detail.date)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground">
                        Category
                      </div>
                      <div className="mt-1 text-foreground">
                        {getAdminExpenseCategory(detail) || "—"}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground">
                        Expense type
                      </div>
                      <div className="mt-1 text-foreground">
                        {getAdminExpenseType(detail) || "—"}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground">
                        Before VAT
                      </div>
                      <div className="mt-1 tabular-nums text-foreground">
                        {formatCurrency(detail.amountBeforeVat ?? 0)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground">VAT</div>
                      <div className="mt-1 tabular-nums text-warning">
                        {getAdminExpenseCategory(detail) ===
                        EXPENSE_TYPE.CASUAL
                          ? "Not applicable"
                          : formatCurrency(detail.vatAmount ?? 0)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground">
                        Total / After VAT
                      </div>
                      <div className="mt-1 font-medium tabular-nums text-foreground">
                        {formatCurrency(detail.amount)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground">
                        WHT ({detail.whtEnabled ? "3%" : "OFF"})
                      </div>
                      <div className="mt-1 tabular-nums text-violet">
                        {detail.whtAmount
                          ? formatCurrency(detail.whtAmount)
                          : "—"}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground">
                        Total Transferred
                      </div>
                      <div className="mt-1 font-medium tabular-nums text-success">
                        {formatCurrency(
                          detail.totalTransferred ?? detail.amount,
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground">
                        Bank
                      </div>
                      <div className="mt-1 text-foreground">
                        {detail.bank ||
                          (getAdminExpenseCategory(detail) ===
                          EXPENSE_TYPE.CASUAL
                            ? "Not provided (optional)"
                            : "Not provided")}
                      </div>

                      {detail.paymentReference && (
                        <div className="font-mono text-xs text-muted-foreground/70">
                          Ref: {detail.paymentReference}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {detail.remark && (
                  <div className="rounded-lg border border-border bg-sidebar p-3">
                    <div className="text-xs text-muted-foreground">
                      Remark / explanation
                    </div>
                    <div className="mt-1 text-foreground">
                      {detail.remark}
                    </div>
                  </div>
                )}

                {detail.reviewStatus === "REJECTED" &&
                  detail.rejectionReason && (
                    <div className="rounded-lg border border-destructive-border bg-destructive-soft p-3">
                      <div className="text-xs font-medium text-destructive">
                        Rejected by {detail.reviewedBy || "Finance"}
                        {detail.reviewedAt
                          ? ` · ${formatDate(detail.reviewedAt, {
                              time: true,
                            })}`
                          : ""}
                      </div>
                      <div className="mt-1 text-sm text-foreground">
                        {detail.rejectionReason}
                      </div>
                    </div>
                  )}

                {detail.statusHistory &&
                  detail.statusHistory.length > 0 && (
                    <div className="rounded-lg border border-border bg-sidebar p-3">
                      <div className="mb-2 text-xs text-muted-foreground">
                        Status history
                      </div>
                      <ol className="space-y-1">
                        {detail.statusHistory.map((entry, i) => (
                          <li
                            key={i}
                            className="text-xs text-muted-foreground"
                          >
                            {formatDate(entry.at, { time: true })} —{" "}
                            {entry.status}
                            {entry.actor ? ` by ${entry.actor}` : ""}
                            {entry.note ? ` · ${entry.note}` : ""}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                <div className="rounded-lg border border-border bg-sidebar p-3">
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Attachments
                  </div>

                  {[
                    detail.invoiceAttachment,
                    detail.whtAttachment,
                  ].filter(Boolean).length > 0 ? (
                    <ul className="space-y-1.5">
                      {[
                        detail.invoiceAttachment,
                        detail.whtAttachment,
                      ]
                        .filter(Boolean)
                        .map((attachment) =>
                          attachment ? (
                            <li
                              key={attachment.id}
                              className="flex items-center gap-2 text-xs"
                            >
                              <Paperclip className="size-3 text-info" />
                              <span className="text-foreground">
                                {attachment.fileName}
                              </span>
                              <span className="text-muted-foreground/70">
                                {attachment.mimeType || "file"}
                                {chunkSizeLabel(attachment.fileSize)}
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

                  <p className="mt-2 text-[10px] text-muted-foreground/70">
                    Note: attachments are stored as browser-session metadata
                    until proper backend file storage exists.
                  </p>
                </div>
              </div>

              <DialogFooter>
                {canSubmit(detail) && (
                  <Button
                    onClick={() => setSubmitTarget(detail)}
                    className="gap-2 bg-success text-primary-foreground hover:bg-success"
                  >
                    <Send className="size-4" />
                    Submit for Review
                  </Button>
                )}

                <Button
                  variant="ghost"
                  onClick={() => setDetail(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Submit confirmation */}
      <Dialog
        open={!!submitTarget}
        onOpenChange={(open) => !open && setSubmitTarget(null)}
      >
        <DialogContent className="border-input bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">
              Submit for Finance Review
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Submit{" "}
              <span className="font-medium text-foreground">
                "{submitTarget?.item}"
              </span>{" "}
              ({formatCurrency(submitTarget?.amount ?? 0)} after VAT) to
              Finance? The record leaves your drafts and becomes Pending
              Finance Review — its financial fields are frozen while Finance
              reviews it. The same record ID is kept.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setSubmitTarget(null)}
              disabled={isSubmitting}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>

            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="gap-2 bg-success text-primary-foreground hover:bg-success"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function chunkSizeLabel(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";

  const kb = Math.round(size / 1024);

  return kb > 1024
    ? ` · ${(kb / 1024).toFixed(1)} MB`
    : ` · ${kb} KB`;
}
