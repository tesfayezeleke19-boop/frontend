
/**
 * Finance Transactions — history and discovery over the CANONICAL Sales
 * Invoice dataset (src/services/sales/invoiceRepo). This is a second read
 * view, never a second copy: all statuses, all history, all time.
 *
 * This tab deliberately changes NO status. Approve/reject/payment-confirm
 * happen only through the existing Finance review pages, whose detail
 * routes this page links into.
 *
 * Week semantics: Monday–Sunday (calendar week in this business locale).
 * Date filtering uses the invoice's business date (`invoice.date`), not the
 * latest update time.
 */
import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Eye,
  FileText,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useSalesInvoices } from "@/hooks/use-sales-data";
import { formatCurrency, formatDate } from "@/services/sales/format";
import {
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_UI,
  type OrderStatus,
} from "@/services/sales/types";
import type { SalesInvoice } from "@/services/sales/invoice";

const PAGE_SIZE = 15;

const STATUS_FILTERS: { value: OrderStatus | "all"; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: ORDER_STATUS.DRAFT, label: ORDER_STATUS_LABELS[ORDER_STATUS.DRAFT] },
  {
    value: ORDER_STATUS.PENDING_FINANCE_REVIEW,
    label: ORDER_STATUS_LABELS[ORDER_STATUS.PENDING_FINANCE_REVIEW],
  },
  {
    value: ORDER_STATUS.FINANCE_APPROVED,
    label: ORDER_STATUS_LABELS[ORDER_STATUS.FINANCE_APPROVED],
  },
  { value: ORDER_STATUS.REJECTED, label: ORDER_STATUS_LABELS[ORDER_STATUS.REJECTED] },
  {
    value: ORDER_STATUS.PAYMENT_CONFIRMED,
    label: ORDER_STATUS_LABELS[ORDER_STATUS.PAYMENT_CONFIRMED],
  },
];

const DATE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this-week", label: "This Week (Mon–Sun)" },
  { value: "last-week", label: "Last Week (Mon–Sun)" },
  { value: "month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "custom", label: "Custom Range" },
];

/** Monday–Sunday boundaries for the week containing `date`. */
function weekRange(date: Date): { start: Date; end: Date } {
  const start = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - ((date.getDay() + 6) % 7),
  );
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

/**
 * Inclusive-on-both-ends [start, end) cutoff for the selected date filter.
 * Returns null for "all"; for "custom" the form-provided dates are used.
 */
function dateRange(
  filter: string,
  customFrom: string,
  customTo: string,
): { start: number | null; end: number | null } {
  const now = new Date();
  const midnight = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayEnd = (d: Date) => midnight(d) + 24 * 60 * 60 * 1000;

  switch (filter) {
    case "all":
      return { start: null, end: null };

    case "today":
      return { start: midnight(now), end: dayEnd(now) };

    case "yesterday": {
      const d = new Date(now);
      d.setDate(now.getDate() - 1);
      return { start: midnight(d), end: dayEnd(d) };
    }

    case "this-week": {
      const { start, end } = weekRange(now);
      return { start: midnight(start), end: dayEnd(end) };
    }

    case "last-week": {
      const last = new Date(now);
      last.setDate(now.getDate() - 7);
      const { start, end } = weekRange(last);
      return { start: midnight(start), end: dayEnd(end) };
    }

    case "month":
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
      };

    case "last-month":
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
        end: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      };

    case "custom": {
      const start = customFrom
        ? new Date(`${customFrom}T00:00:00`).getTime()
        : null;

      const end = customTo
        ? new Date(`${customTo}T00:00:00`).getTime() +
          24 * 60 * 60 * 1000
        : null;

      return { start, end };
    }

    default:
      return { start: null, end: null };
  }
}

/**
 * Compare invoice numbers by their numeric portions first.
 *
 * This allows different invoice prefixes (for example, Sales and Contract
 * invoices) to be ordered together by their invoice number instead of
 * grouping them alphabetically by invoice type.
 *
 * Sorting is descending: the larger invoice number comes first.
 */
function compareInvoiceNumbersDescending(
  a: string,
  b: string,
): number {
  const aNumbers = a.match(/\d+/g)?.map(Number) ?? [];
  const bNumbers = b.match(/\d+/g)?.map(Number) ?? [];

  const length = Math.min(aNumbers.length, bNumbers.length);

  for (let i = 0; i < length; i++) {
    if (aNumbers[i] !== bNumbers[i]) {
      return bNumbers[i] - aNumbers[i];
    }
  }

  if (aNumbers.length !== bNumbers.length) {
    return bNumbers.length - aNumbers.length;
  }

  return b.localeCompare(a, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Full-dataset search: parent invoice fields, then every child Order's
 * fields (royalty invoice number, aggregate). Partial matches, case-
 * insensitive, whitespace-trimmed, numeric lists as text. The aggregate
 * code "00" keeps its leading zero because both sides stay strings.
 */
function invoiceMatchesQuery(invoice: SalesInvoice, query: string): boolean {
  const q = query.toLowerCase();

  if (invoice.invoiceNumber.toLowerCase().includes(q)) return true;
  if (invoice.fsNo.toLowerCase().includes(q)) return true;
  if (invoice.customer.name.toLowerCase().includes(q)) return true;
  if (invoice.customer.tin.toLowerCase().includes(q)) return true;
  if (invoice.payment.bank.toLowerCase().includes(q)) return true;
  if (invoice.payment.paymentSender.toLowerCase().includes(q)) return true;
  if (invoice.payment.paymentReferenceNumber.toLowerCase().includes(q)) return true;
  if (ORDER_STATUS_LABELS[invoice.status].toLowerCase().includes(q)) return true;

  return invoice.orders.some(
    (order) =>
      order.aggregate.toLowerCase().includes(q) ||
      order.royaltyInvoiceNumber?.toLowerCase().includes(q) ||
      String(order.quantity).includes(q),
  );
}

type SortKey = "invoiceNumber" | "totalPrice" | "createdAt" | "customer";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

function SortButton({
  label,
  column,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  column: SortKey;
  sort: SortState;
  onSort: (column: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === column;

  const Icon = active
    ? sort.dir === "asc"
      ? ChevronUp
      : ChevronDown
    : ChevronsUpDown;

  return (
    <button
      onClick={() => onSort(column)}
      className={`inline-flex items-center gap-1 font-medium transition-colors hover:text-muted-foreground ${
        align === "right" ? "w-full justify-end" : ""
      }`}
    >
      {label}
      <Icon
        className={`size-3 ${
          active ? "text-success" : "text-muted-foreground"
        }`}
      />
    </button>
  );
}

export default function FinanceTransactions() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Default sorting: largest invoice number first.
  const [sort, setSort] = useState<SortState>({
    key: "invoiceNumber",
    dir: "desc",
  });

  const [page, setPage] = useState(0);

  const { data: invoices, loading, error } = useSalesInvoices();

  // Custom-range validation is derived, never stored in a ref/state set
  // during render. Start date must not come after the end date.
  const customInvalid =
    dateFilter === "custom" &&
    !!customFrom &&
    !!customTo &&
    new Date(`${customFrom}T00:00:00`).getTime() >
      new Date(`${customTo}T00:00:00`).getTime();

  const customError = customInvalid
    ? "Start date must not be after the end date"
    : "";

  const filtered = useMemo(() => {
    const list = invoices ?? [];

    const status =
      statusFilter === "all"
        ? null
        : (statusFilter as OrderStatus);

    const { start, end } = dateRange(
      dateFilter,
      customFrom,
      customTo,
    );

    const query = search.trim();

    return list.filter((invoice) => {
      if (status && invoice.status !== status) return false;

      if (customInvalid) return false;

      const date = invoice.date;

      if (start !== null && date < start) return false;
      if (end !== null && date >= end) return false;

      if (query && !invoiceMatchesQuery(invoice, query)) {
        return false;
      }

      return true;
    });
  }, [
    invoices,
    search,
    statusFilter,
    dateFilter,
    customFrom,
    customTo,
    customInvalid,
  ]);

  const sorted = useMemo(() => {
    const list = [...filtered];

    list.sort((a, b) => {
      let cmp = 0;

      if (sort.key === "invoiceNumber") {
        cmp = compareInvoiceNumbersDescending(
          a.invoiceNumber,
          b.invoiceNumber,
        );
      } else if (sort.key === "totalPrice") {
        cmp =
          a.financialSummary.totalPriceInclVat -
          b.financialSummary.totalPriceInclVat;
      } else if (sort.key === "customer") {
        cmp = a.customer.name.localeCompare(b.customer.name);
      } else {
        cmp = a.date - b.date;
      }

      return sort.key === "invoiceNumber"
        ? sort.dir === "asc"
          ? -cmp
          : cmp
        : sort.dir === "asc"
          ? cmp
          : -cmp;
    });

    return list;
  }, [filtered, sort]);

  const totalPages = Math.max(
    1,
    Math.ceil(sorted.length / PAGE_SIZE),
  );

  const safePage = Math.min(page, totalPages - 1);

  const pageRows = sorted.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );

  const hasFilters =
    !!search.trim() ||
    statusFilter !== "all" ||
    dateFilter !== "all" ||
    !!customFrom ||
    !!customTo;

  const handleSort = (column: SortKey) => {
    setSort((prev) => ({
      key: column,
      dir:
        prev.key === column && prev.dir === "asc"
          ? "desc"
          : "asc",
    }));

    setPage(0);
  };

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setDateFilter("all");
    setCustomFrom("");
    setCustomTo("");
    setPage(0);
  };

  if (error && !invoices) {
    return (
      <div className="py-20 text-center">
        <TriangleAlert className="mx-auto mb-3 size-8 text-destructive" />

        <p className="text-sm font-medium text-foreground">
          Unable to load transactions.
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          {error.message}
        </p>
      </div>
    );
  }

  if (loading && !invoices) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Transactions
        </h1>
      </div>

      {/* Filters */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />

              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search invoice, order, FS No, customer, TIN, royalty invoice no., aggregate, bank, sender, reference..."
                className="h-9 border-input bg-popover pl-9 text-sm text-foreground placeholder:text-muted-foreground/70"
              />
            </div>

            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9 w-[180px] border-input bg-popover text-sm text-foreground">
                <SelectValue placeholder="Status" />
              </SelectTrigger>

              <SelectContent className="border-input bg-popover">
                {STATUS_FILTERS.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="text-sm text-foreground focus:bg-accent"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={dateFilter}
              onValueChange={(v) => {
                setDateFilter(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9 w-[180px] border-input bg-popover text-sm text-foreground">
                <SelectValue placeholder="Date" />
              </SelectTrigger>

              <SelectContent className="border-input bg-popover">
                {DATE_FILTERS.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="text-sm text-foreground focus:bg-accent"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {dateFilter === "custom" && (
              <div className="flex items-center gap-2">
                <div className="w-40">
                  <EthiopianDatePicker
                    value={customFrom}
                    onChange={(value) => {
                      setCustomFrom(value);
                      setPage(0);
                    }}
                    placeholder="Start date"
                    className={
                      customError ? "border-destructive" : ""
                    }
                  />
                </div>

                <span className="text-xs text-muted-foreground/70">
                  to
                </span>

                <div className="w-40">
                  <EthiopianDatePicker
                    value={customTo}
                    onChange={(value) => {
                      setCustomTo(value);
                      setPage(0);
                    }}
                    placeholder="End date"
                    className={
                      customError ? "border-destructive" : ""
                    }
                  />
                </div>

                {customError && (
                  <p className="text-xs text-destructive">
                    {customError}
                  </p>
                )}
              </div>
            )}

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Result counts */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Showing{" "}
          <span className="tabular-nums text-foreground">
            {filtered.length}
          </span>{" "}
          of{" "}
          <span className="tabular-nums text-foreground">
            {invoices?.length ?? 0}
          </span>{" "}
          transactions
          {hasFilters && " (filtered)"}
        </span>

        <span>
          {invoices?.length ?? 0} total invoices in the Finance dataset
        </span>
      </div>

      {/* Table */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="p-0">
          {pageRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">
                      <SortButton
                        label="Invoice"
                        column="invoiceNumber"
                        sort={sort}
                        onSort={handleSort}
                      />
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      <SortButton
                        label="Customer"
                        column="customer"
                        sort={sort}
                        onSort={handleSort}
                      />
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      FS No
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Orders
                    </th>

                    <th className="px-4 py-2.5 text-right font-medium">
                      Qty (m³)
                    </th>

                    <th className="px-4 py-2.5 text-right font-medium">
                      <SortButton
                        label="Total Price"
                        column="totalPrice"
                        sort={sort}
                        onSort={handleSort}
                        align="right"
                      />
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Bank
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Status
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      <SortButton
                        label="Date"
                        column="createdAt"
                        sort={sort}
                        onSort={handleSort}
                      />
                    </th>

                    <th className="px-4 py-2.5 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map((invoice) => {
                    const status = ORDER_STATUS_UI[invoice.status];

                    const totalQuantity = invoice.orders.reduce(
                      (sum, order) => sum + order.quantity,
                      0,
                    );

                    return (
                      <tr
                        key={invoice.id}
                        className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                        onClick={() =>
                          navigate(
                            `/finance/review/detail/${invoice.id}`,
                          )
                        }
                      >
                        <td className="px-4 py-2.5 font-mono text-xs font-medium text-foreground">
                          {invoice.invoiceNumber}
                        </td>

                        <td className="px-4 py-2.5 text-foreground">
                          {invoice.customer.name}
                        </td>

                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {invoice.fsNo || "—"}
                        </td>

                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                          {invoice.orders.length}

                          {invoice.orders.length > 1 && (
                            <span className="ml-1 text-[10px] text-muted-foreground/70">
                              (
                              {invoice.orders
                                .map((o) => o.aggregate)
                                .join(", ")}
                              )
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {totalQuantity.toLocaleString()}
                        </td>

                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">
                          {formatCurrency(
                            invoice.financialSummary.totalPriceInclVat,
                          )}
                        </td>

                        <td className="px-4 py-2.5 text-muted-foreground">
                          {invoice.payment.bank || "—"}
                        </td>

                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`border text-[10px] font-medium ${status.className}`}
                          >
                            {status.label}
                          </Badge>
                        </td>

                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {formatDate(invoice.date)}
                        </td>

                        <td className="px-4 py-2.5 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();

                              navigate(
                                `/finance/review/detail/${invoice.id}`,
                              );
                            }}
                          >
                            <Eye className="size-3" />
                            Details
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText className="mb-3 size-8 text-muted-foreground" />

              <p className="text-sm font-medium text-foreground">
                {hasFilters
                  ? "No transactions found"
                  : "No transactions yet"}
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {hasFilters
                  ? "Try adjusting the search or filters — the whole authorized dataset is searched."
                  : "Transactions appear here once Sales creates invoices."}
              </p>

              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3 gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={resetFilters}
                >
                  <X className="size-3" />
                  Clear Filters
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {sorted.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">
            Showing {safePage * PAGE_SIZE + 1}–
            {Math.min(
              (safePage + 1) * PAGE_SIZE,
              sorted.length,
            )}{" "}
            of {sorted.length}
          </span>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              className="h-7 w-7 border-input bg-transparent p-0 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" />
            </Button>

            {Array.from(
              { length: Math.min(totalPages, 5) },
              (_, i) => {
                const startPage = Math.max(
                  0,
                  Math.min(safePage - 2, totalPages - 5),
                );

                const p = startPage + i;

                if (p >= totalPages) return null;

                return (
                  <Button
                    key={p}
                    variant={
                      p === safePage ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => setPage(p)}
                    className={`h-7 w-7 p-0 text-xs ${
                      p === safePage
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {p + 1}
                  </Button>
                );
              },
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(safePage + 1)}
              className="h-7 w-7 border-input bg-transparent p-0 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
