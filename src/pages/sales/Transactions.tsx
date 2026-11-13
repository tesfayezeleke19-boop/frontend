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
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  FileText,
  Eye,
  Pencil,
  X,
} from "lucide-react";
import { useSalesInvoices } from "@/hooks/use-sales-data";
import { formatCurrency, formatDate } from "@/services/sales/format";
import {
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_UI,
  isEditableStatus,
  type OrderStatus,
} from "@/services/sales/types";

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
  { value: "all", label: "All Dates" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "month", label: "This Month" },
];

/** Cutoff timestamp for a date filter, or null when no date filter applies. */
/** Returns the start timestamp for the selected date filter. */

/** Returns the first Gregorian date of the current Ethiopian month,
 *  represented as midnight in the Africa/Addis_Ababa timezone.
 */
function getEthiopianMonthStartTimestamp(): number {
  const timezone = "Africa/Addis_Ababa";

  const ethiopianFormatter = new Intl.DateTimeFormat(
    "en-US-u-ca-ethiopic-nu-latn",
    {
      year: "numeric",
      month: "numeric",
      timeZone: timezone,
    },
  );

  const gregorianFormatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: timezone,
  });

  const getParts = (
    formatter: Intl.DateTimeFormat,
    date: Date,
  ) => {
    const parts = formatter.formatToParts(date);

    return Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
  };

  const now = new Date();

  // Current Ethiopian year and month
  const currentEthiopian = getParts(ethiopianFormatter, now);

  // Current Gregorian calendar date in Addis Ababa
  const currentGregorian = getParts(gregorianFormatter, now);

  let candidate = Date.UTC(
    currentGregorian.year,
    currentGregorian.month - 1,
    currentGregorian.day,
    12,
  );

  let firstDayOfMonth = candidate;

  // Walk backwards until the Ethiopian month changes.
  for (let i = 0; i < 31; i++) {
    const date = new Date(candidate);
    const ethiopian = getParts(ethiopianFormatter, date);

    if (
      ethiopian.year !== currentEthiopian.year ||
      ethiopian.month !== currentEthiopian.month
    ) {
      break;
    }

    firstDayOfMonth = candidate;
    candidate -= 24 * 60 * 60 * 1000;
  }

  // Convert the first Gregorian calendar date to Addis Ababa midnight.
  const firstDate = new Date(firstDayOfMonth);

  return (
    Date.UTC(
      firstDate.getUTCFullYear(),
      firstDate.getUTCMonth(),
      firstDate.getUTCDate(),
    ) -
    3 * 60 * 60 * 1000
  );
}

/** Cutoff timestamp for a date filter, or null when no filter applies. */
function dateCutoff(value: string): number | null {
  const now = new Date();

  switch (value) {
    case "today": {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Africa/Addis_Ababa",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);

      const year = Number(
        parts.find((p) => p.type === "year")?.value,
      );
      const month = Number(
        parts.find((p) => p.type === "month")?.value,
      );
      const day = Number(
        parts.find((p) => p.type === "day")?.value,
      );

      return Date.UTC(year, month - 1, day) - 3 * 60 * 60 * 1000;
    }

    case "7d":
      return now.getTime() - 7 * 24 * 60 * 60 * 1000;

    case "30d":
      return now.getTime() - 30 * 24 * 60 * 60 * 1000;

    case "month":
      return getEthiopianMonthStartTimestamp();

    default:
      return null;
  }
}

/** Converts an invoice creation date into a millisecond timestamp. */
function getCreatedAtTimestamp(
  value: number | string | Date,
): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    // Convert Unix seconds to milliseconds when necessary.
    return value < 1_000_000_000_000
      ? value * 1000
      : value;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return NaN;
  }

  // Handle numeric timestamps returned as strings.
  if (/^\d+$/.test(trimmed)) {
    const numericValue = Number(trimmed);

    return numericValue < 1_000_000_000_000
      ? numericValue * 1000
      : numericValue;
  }

  return new Date(trimmed).getTime();
}

type SortKey = "invoiceNumber" | "totalPrice" | "createdAt";
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
        className={`size-3 ${active ? "text-success" : "text-muted-foreground"}`}
      />
    </button>
  );
}

export default function Transactions() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortState>({ key: "createdAt", dir: "desc" });
  const [page, setPage] = useState(0);

  const { data: invoices } = useSalesInvoices();

  const filtered = useMemo(() => {
  const list = invoices ?? [];

  const status =
    statusFilter === "all"
      ? null
      : (statusFilter as OrderStatus);

  const query = search.trim().toLowerCase();
  const cutoff = dateCutoff(dateFilter);

  return list.filter((invoice) => {
    // Status filter
    if (status && invoice.status !== status) {
      return false;
    }

    // Date filter
    if (cutoff !== null) {
      const invoiceDate = getCreatedAtTimestamp(
        invoice.createdAt,
      );

      if (
        !Number.isFinite(invoiceDate) ||
        invoiceDate < cutoff
      ) {
        return false;
      }
    }

    // Search filter
    if (!query) {
      return true;
    }

    return (
      invoice.invoiceNumber.toLowerCase().includes(query) ||
      invoice.customer.name.toLowerCase().includes(query) ||
      invoice.fsNo.toLowerCase().includes(query) ||
      invoice.orders.some(
        (order) =>
          order.aggregate.toLowerCase().includes(query) ||
          String(order.quantity).includes(query),
      )
    );
  });
}, [invoices, search, statusFilter, dateFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      if (sort.key === "invoiceNumber") {
        cmp = a.invoiceNumber.localeCompare(b.invoiceNumber);
      } else if (sort.key === "totalPrice") {
        cmp =
          a.financialSummary.totalPriceInclVat -
          b.financialSummary.totalPriceInclVat;
      } else {
        cmp = a.createdAt - b.createdAt;
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sort]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasFilters = !!search || statusFilter !== "all" || dateFilter !== "all";

  const handleSort = (column: SortKey) => {
    setSort((prev) => ({
      key: column,
      dir: prev.key === column && prev.dir === "asc" ? "desc" : "asc",
    }));
    setPage(0);
  };

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setDateFilter("all");
    setSort({ key: "createdAt", dir: "desc" });
    setPage(0);
  };

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Transactions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
          </p>
        </div>
        <Button
          onClick={() => navigate("/sales/new-invoice")}
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          New Sales Invoice
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search by invoice number, customer, FS No..."
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
              <SelectTrigger className="h-9 w-[170px] border-input bg-popover text-sm text-foreground">
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
              <SelectTrigger className="h-9 w-[150px] border-input bg-popover text-sm text-foreground">
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
                    <th className="px-4 py-2.5 font-medium">Customer</th>
                    <th className="px-4 py-2.5 font-medium">FS No</th>
                    <th className="px-4 py-2.5 text-right font-medium">Orders</th>
                    <th className="px-4 py-2.5 text-right font-medium">Qty (m³)</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      <SortButton
                        label="Total Price"
                        column="totalPrice"
                        sort={sort}
                        onSort={handleSort}
                        align="right"
                      />
                    </th>
                    <th className="px-4 py-2.5 font-medium">Bank</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
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
                          navigate(`/sales/transactions/detail/${invoice.id}`)
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
                        <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                          {invoice.orders.length}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {totalQuantity.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">
                          {formatCurrency(invoice.financialSummary.totalPriceInclVat)}
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
                          {formatDate(invoice.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isEditableStatus(invoice.status) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs text-success hover:text-success hover:bg-success/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/sales/invoices/${invoice.id}/edit`);
                                }}
                              >
                                <Pencil className="size-3" />
                                {invoice.status === ORDER_STATUS.REJECTED
                                  ? "Resubmit"
                                  : "Edit"}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(
                                  `/sales/transactions/detail/${invoice.id}`,
                                );
                              }}
                            >
                              <Eye className="size-3" />
                              View
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
              <FileText className="mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                {hasFilters
                  ? "No transactions found"
                  : "No transactions yet"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasFilters
                  ? "Try adjusting your search or filters."
                  : "Create your first sales invoice to get started."}
              </p>
              {hasFilters ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3 gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={resetFilters}
                >
                  <X className="size-3" />
                  Clear Filters
                </Button>
              ) : (
                <Button
                  onClick={() => navigate("/sales/new-invoice")}
                  className="mt-3 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                  size="sm"
                >
                  <Plus className="size-3.5" />
                  New Sales Invoice
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
            Showing {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, sorted.length)} of{" "}
            {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className="h-7 w-7 border-input bg-transparent p-0 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const startPage = Math.max(0, Math.min(page - 2, totalPages - 5));
              const p = startPage + i;
              if (p >= totalPages) return null;
              return (
                <Button
                  key={p}
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPage(p)}
                  className={`h-7 w-7 p-0 text-xs ${
                    p === page
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {p + 1}
                </Button>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
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
