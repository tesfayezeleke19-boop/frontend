
/**
 * Finance Expenses — Workflow A (Finance-owned expenses) plus the Finance
 * review section for Workflow B (Admin-originated expenses).
 *
 * Category: expense_category — STANDARD / CASUAL
 * Type: expense_type — actual expense type from the expense_types table
 */

import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";
import { useEffect, useMemo, useState, type ComponentType } from "react";
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
  useExpenses,
  useFinanceReviewQueue,
} from "@/hooks/use-finance-data";

import { useAuth } from "@/hooks/use-auth";
import { actorLabel } from "@/services/auth/profile";

import {
  expensesRepository,
  isExpenseCounted,
} from "@/services/finance/expenses";

import ExpenseFormDialog from "@/components/finance/ExpenseFormDialog";

import {
  EXPENSE_VAT_RATE,
  EXPENSE_WHT_RATE,
} from "@/services/finance/expenseCalculations";

import {
  EXPENSE_TYPE,
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
  matchesExpenseDateRange,
  type ExpenseRangeKind,
} from "@/services/finance/expenseFilters";

const FinanceExpenseFormDialog = ExpenseFormDialog as ComponentType<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: string;
  initial: Expense | null;
  onSaved?: (saved: Expense, submitted: boolean) => void;
}>;

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

type ExpenseAttachment = NonNullable<Expense["invoiceAttachment"]>;

/**
 * API returns:
 * category: STANDARD / CASUAL
 * type: actual expense type, e.g. Maintenance
 *
 * Snake_case properties are also supported for compatibility.
 */
type ExpenseApiFields = {
  category?: string | null;
  type?: string | null;

  expense_category?: string | null;
  expenseCategory?: string | null;

  expense_type?: string | null;
  expenseType?: string | null;
};

/** Reads STANDARD / CASUAL from the category property. */
function getExpenseCategory(expense: Expense): string {
  const record = expense as Expense & ExpenseApiFields;

  return String(
    record.category ??
      record.expense_category ??
      record.expenseCategory ??
      "",
  )
    .trim()
    .toUpperCase();
}

/** Reads the actual expense type from the type property. */
function getExpenseType(expense: Expense): string {
  const record = expense as Expense & ExpenseApiFields;

  return String(
    record.type ??
      record.expense_type ??
      record.expenseType ??
      "",
  ).trim();
}

/** Returns the category classification only when it is valid. */
function getExpenseCategoryClassification(
  expense: Expense,
): ExpenseType | null {
  const category = getExpenseCategory(expense);

  if (category === EXPENSE_TYPE.STANDARD) {
    return EXPENSE_TYPE.STANDARD;
  }

  if (category === EXPENSE_TYPE.CASUAL) {
    return EXPENSE_TYPE.CASUAL;
  }

  return null;
}

function normalizeExpenseCategory(expense: Expense): string {
  return getExpenseCategory(expense);
}

/**
 * Ethiopian calendar month filtering.
 */
function getEthiopianMonthKey(date: Date): string {
  const formatter = new Intl.DateTimeFormat(
    "en-US-u-ca-ethiopic-nu-latn",
    {
      year: "numeric",
      month: "numeric",
    },
  );

  const parts = formatter.formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;

  return `${year}-${month}`;
}

function parseExpenseDate(dateValue: unknown): Date | null {
  if (!dateValue) return null;

  if (dateValue instanceof Date) {
    return Number.isNaN(dateValue.getTime())
      ? null
      : new Date(
          dateValue.getFullYear(),
          dateValue.getMonth(),
          dateValue.getDate(),
        );
  }

  const value = String(dateValue).trim();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return null;

  return new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
  );
}

function getTargetEthiopianMonthKey(offset: 0 | -1): string {
  const today = new Date();
  const currentKey = getEthiopianMonthKey(today);

  if (offset === 0) return currentKey;

  const cursor = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  for (let day = 0; day < 36; day += 1) {
    cursor.setDate(cursor.getDate() - 1);

    if (getEthiopianMonthKey(cursor) !== currentKey) {
      cursor.setDate(cursor.getDate() + 1);
      break;
    }
  }

  cursor.setDate(cursor.getDate() - 1);

  return getEthiopianMonthKey(cursor);
}

function matchesEthiopianMonth(
  expense: Expense,
  offset: 0 | -1,
): boolean {
  const expenseDate = parseExpenseDate(expense.date);

  if (!expenseDate) return false;

  return (
    getEthiopianMonthKey(expenseDate) ===
    getTargetEthiopianMonthKey(offset)
  );
}

/** Opens a stored expense attachment in the authenticated image viewer. */
function ExpenseAttachmentLink({
  attachment,
  label,
  colorClass = "text-blue-500",
}: {
  attachment: ExpenseAttachment;
  label: string;
  colorClass?: string;
}) {
  const navigate = useNavigate();

  const openAttachment = () => {
    const src = `/api/finance/expenses/attachments/${attachment.id}`;

    const params = new URLSearchParams({
      src,
      name: attachment.fileName,
    });

    navigate(`/evidence-image?${params.toString()}`);
  };

  return (
    <button
      type="button"
      onClick={openAttachment}
      title={`Open ${attachment.fileName}`}
      className={`inline-flex max-w-[220px] items-center gap-1.5 truncate text-left text-xs hover:underline ${colorClass}`}
    >
      <Paperclip className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export default function Expenses() {
  const location = useLocation();
  const navigate = useNavigate();

  const { user } = useAuth();
  const actor = actorLabel(user);

  const {
    data: allExpenses,
    loading,
  } = useExpenses();

  const {
    data: reviewQueue,
  } = useFinanceReviewQueue();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  useEffect(() => {
    const navigationState = location.state as
      | { openExpenseForm?: boolean }
      | null;

    if (!navigationState?.openExpenseForm) return;

    setEditing(null);
    setFormOpen(true);

    navigate(location.pathname, {
      replace: true,
      state: null,
    });
  }, [location.pathname, location.state, navigate]);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [detailTarget, setDetailTarget] = useState<Expense | null>(null);
  const [approveTarget, setApproveTarget] = useState<Expense | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Expense | null>(null);

  const [rejectReason, setRejectReason] = useState("");
  const [isReviewing, setIsReviewing] = useState(false);

  const [rangeKind, setRangeKind] =
    useState<ExpenseRangeKind>("ALL_TIME");

  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [search, setSearch] = useState("");

  const [typeFilter, setTypeFilter] =
    useState<"ALL" | ExpenseType>("ALL");

  const rangeResult = useMemo(
    () => resolveExpenseDateRange(rangeKind, customFrom, customTo),
    [rangeKind, customFrom, customTo],
  );

  const filtered = useMemo(() => {
    const list = (allExpenses ?? []).filter(isExpenseCounted);

    return list.filter((expense) => {
      const categoryMatches =
        typeFilter === "ALL" ||
        normalizeExpenseCategory(expense) ===
          String(typeFilter).trim().toUpperCase();

      let dateMatches = true;

      if (rangeKind === "THIS_MONTH") {
        dateMatches = matchesEthiopianMonth(expense, 0);
      } else if (rangeKind === "LAST_MONTH") {
        dateMatches = matchesEthiopianMonth(expense, -1);
      } else {
        dateMatches = matchesExpenseDateRange(
          expense,
          rangeResult.range,
        );
      }

      return (
        dateMatches &&
        categoryMatches &&
        matchesExpenseSearch(expense, search)
      );
    });
  }, [
    allExpenses,
    search,
    rangeResult,
    rangeKind,
    typeFilter,
  ]);

  const totalExpenses = filtered.reduce(
    (sum, expense) =>
      sum + (Number.isFinite(expense.amount) ? expense.amount : 0),
    0,
  );

  const totalVat = filtered.reduce(
    (sum, expense) =>
      sum +
      (Number.isFinite(expense.vatAmount) ? expense.vatAmount : 0),
    0,
  );

  const totalWht = filtered.reduce(
    (sum, expense) =>
      sum +
      (Number.isFinite(expense.whtAmount) ? expense.whtAmount : 0),
    0,
  );

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

  if (loading && !allExpenses) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const filtersActive =
    rangeKind !== "ALL_TIME" ||
    typeFilter !== "ALL" ||
    !!search.trim() ||
    !!customFrom ||
    !!customTo;

  const pendingQueue = reviewQueue ?? [];

  return (
    <div className="space-y-6">
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

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Expense Records
          </CardTitle>
        </CardHeader>

        <CardContent className="sticky top-0 z-0 border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={rangeKind}
              onValueChange={(value) =>
                setRangeKind(value as ExpenseRangeKind)
              }
            >
              <SelectTrigger className={`${selectTriggerClass} w-44`}>
                <SelectValue />
              </SelectTrigger>

              <SelectContent className={selectContentClass}>
                {EXPENSE_RANGE_OPTIONS.map((option) => {
                  const label =
                    option.value === "THIS_MONTH"
                      ? "This Ethiopian Month"
                      : option.value === "LAST_MONTH"
                        ? "Last Ethiopian Month"
                        : option.label;

                  return (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className={selectItemClass}
                    >
                      {label}
                    </SelectItem>
                  );
                })}
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

                <span className="text-xs text-muted-foreground">to</span>

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
                <SelectValue placeholder="All categories" />
              </SelectTrigger>

              <SelectContent className={selectContentClass}>
                <SelectItem value="ALL" className={selectItemClass}>
                  All categories
                </SelectItem>

                <SelectItem
                  value={EXPENSE_TYPE.STANDARD}
                  className={selectItemClass}
                >
                  Standard
                </SelectItem>

                <SelectItem
                  value={EXPENSE_TYPE.CASUAL}
                  className={selectItemClass}
                >
                  Casual
                </SelectItem>
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

          {rangeResult.error && rangeKind === "CUSTOM" && (
            <p className="mt-2 text-xs text-destructive">
              {rangeResult.error}
            </p>
          )}
        </CardContent>

        <CardContent className="p-0">
          {filtered.length > 0 ? (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[1200px] text-sm">
                <thead className="sticky top-0 z-10 bg-muted">
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
                    const category = getExpenseCategoryClassification(expense);

                    return (
                      <tr key={expense.id} className={tableRowClass}>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {formatDate(expense.date)}
                        </td>

                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`border text-[10px] font-medium ${
                              category === EXPENSE_TYPE.CASUAL
                                ? "erp-badge-draft"
                                : category === EXPENSE_TYPE.STANDARD
                                  ? "erp-badge-approved"
                                  : ""
                            }`}
                          >
                            {getExpenseCategory(expense) || "—"}
                          </Badge>
                        </td>

                        <td className="px-4 py-2.5 text-foreground">
                          {expense.item}
                        </td>

                        <td className="px-4 py-2.5 text-muted-foreground">
                          {getExpenseType(expense) || "—"}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatCurrency(expense.amountBeforeVat ?? 0)}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-amber-500">
                          {category === EXPENSE_TYPE.CASUAL
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
                          <div className="flex min-w-[150px] flex-col items-start gap-1">
                            {expense.invoiceAttachment && (
                              <ExpenseAttachmentLink
                                attachment={expense.invoiceAttachment}
                                label="Evidence"
                                colorClass="text-blue-500"
                              />
                            )}

                            {expense.whtAttachment && (
                              <ExpenseAttachmentLink
                                attachment={expense.whtAttachment}
                                label="Withholding"
                                colorClass="text-violet-500"
                              />
                            )}

                            {!expense.invoiceAttachment &&
                              !expense.whtAttachment && (
                                <span className="text-muted-foreground">—</span>
                              )}
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

      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="size-4 text-success" />

            <CardTitle className="text-sm font-medium text-foreground">
              Admin Expense Review
            </CardTitle>

            <Badge variant="secondary" className="ml-auto">
              {pendingQueue.length} Pending
            </Badge>
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

      <FinanceExpenseFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);

          if (!open) {
            setEditing(null);
          }
        }}
        mode="finance"
        initial={editing}
        onSaved={() => {
          // The repository notification reloads the expense hooks.
        }}
      />

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
                    {getExpenseCategoryClassification(approveTarget) === EXPENSE_TYPE.CASUAL
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

      <Dialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
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

/* ADMIN EXPENSE REVIEW QUEUE */

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
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full min-w-[1150px] text-sm">
        <thead className="sticky top-0 z-10 bg-muted">
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
            <th className="px-4 py-2.5 font-medium">Submitted By</th>
            <th className="px-4 py-2.5 font-medium">Submitted</th>
            <th className="px-4 py-2.5 text-right font-medium">Actions</th>
          </tr>
        </thead>

        <tbody>
          {queue.map((expense) => {
            const category = getExpenseCategoryClassification(expense);

            return (
              <tr key={expense.id} className={tableRowClass}>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                  {formatDate(expense.date)}
                </td>

                <td className="px-4 py-2.5">
                  <Badge
                    variant="outline"
                    className={`border text-[10px] font-medium ${
                      category === EXPENSE_TYPE.CASUAL
                        ? "erp-badge-draft"
                        : category === EXPENSE_TYPE.STANDARD
                          ? "erp-badge-approved"
                          : ""
                    }`}
                  >
                    {getExpenseCategory(expense) || "—"}
                  </Badge>
                </td>

                <td className="px-4 py-2.5 text-foreground">
                  {expense.item}
                </td>

                <td className="px-4 py-2.5 text-muted-foreground">
                  {getExpenseType(expense) || "—"}
                </td>

                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {formatCurrency(expense.amountBeforeVat ?? 0)}
                </td>

                <td className="px-4 py-2.5 text-right tabular-nums text-amber-500">
                  {category === EXPENSE_TYPE.CASUAL
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
                  <div className="flex min-w-[150px] flex-col items-start gap-1">
                    {expense.invoiceAttachment && (
                      <ExpenseAttachmentLink
                        attachment={expense.invoiceAttachment}
                        label="Evidence"
                        colorClass="text-blue-500"
                      />
                    )}

                    {expense.whtAttachment && (
                      <ExpenseAttachmentLink
                        attachment={expense.whtAttachment}
                        label="Withholding"
                        colorClass="text-violet-500"
                      />
                    )}

                    {!expense.invoiceAttachment &&
                      !expense.whtAttachment && (
                        <span className="text-muted-foreground">—</span>
                      )}
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ADMIN EXPENSE DETAIL DIALOG */

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
  const category = expense
    ? getExpenseCategoryClassification(expense)
    : null;

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
                    {getExpenseCategory(expense) || "—"}
                  </div>
                </div>

                <div className={detailBoxClass}>
                  <div className="text-xs text-muted-foreground">
                    Type
                  </div>

                  <div className="mt-1 font-medium text-foreground">
                    {getExpenseType(expense) || "—"}
                  </div>
                </div>
              </div>

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
                      {category === EXPENSE_TYPE.CASUAL
                        ? "VAT"
                        : `VAT (${Math.round(EXPENSE_VAT_RATE * 100)}%)`}
                    </div>

                    <div className="mt-1 tabular-nums text-amber-500">
                      {category === EXPENSE_TYPE.CASUAL
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

              <div className="grid gap-3 sm:grid-cols-2">
                <div className={detailBoxClass}>
                  <div className="text-xs text-muted-foreground">
                    Bank / Payment info
                  </div>

                  <div className="mt-1 font-medium text-foreground">
                    {expense.bank ||
                      (category === EXPENSE_TYPE.CASUAL
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

              <div className={detailBoxClass}>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Attachments
                </div>

                {expense.invoiceAttachment || expense.whtAttachment ? (
                  <div className="flex flex-col items-start gap-1.5">
                    {expense.invoiceAttachment && (
                      <ExpenseAttachmentLink
                        attachment={expense.invoiceAttachment}
                        label="Evidence"
                        colorClass="text-blue-500"
                      />
                    )}

                    {expense.whtAttachment && (
                      <ExpenseAttachmentLink
                        attachment={expense.whtAttachment}
                        label="Withholding"
                        colorClass="text-violet-500"
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No attachments
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button onClick={onApprove} className="gap-2">
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
