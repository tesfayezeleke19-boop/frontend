
/** Credit Contracts — shared list page (Finance and Sales).

This is the ADDITIONAL workflow that sits beside the existing Contract Orders
module. It has its own numbers (CREDIT-0001), its own statuses, and its own
storage keys — it never reads, writes, or reinterprets standard contracts.

Finance creates, activates, cancels, and finalizes credit contracts here.
Any authorized Sales user sees every active contract and can add orders to
any of them — no assignment, no ownership restriction, no fixed order limit.
*/
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  ScrollText,
  FileText,
  CreditCard,
  TrendingUp,
  Info,
} from "lucide-react";

import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";
import { useAuth } from "@/hooks/use-auth";
import { USER_ROLES } from "@/services/auth";
import {
  useCreditContracts,
  useAllCreditContractOrders,
} from "@/hooks/use-credit-contracts-data";
import {
  CREDIT_CONTRACT_STATUS,
  CREDIT_CONTRACT_STATUS_LABELS,
  CREDIT_CONTRACT_STATUS_UI,
  getCreditContractProgress,
  type CreditContract,
  type CreditContractOrder,
} from "@/services/creditContracts/types";
import { formatCurrency } from "@/services/sales/format";
import { CreditContractFormDialog } from "@/components/credit-contracts/CreditContractFormDialog";
import { CreditOrderDialog } from "@/components/credit-contracts/CreditOrderDialog";

/**
 * API timestamps are kept in their existing format.
 * The picker returns Gregorian YYYY-MM-DD values, so filtering compares
 * Gregorian calendar-day keys without changing the underlying dates.
 */
function getLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function matchesDateRange(
  timestamp: number,
  from: string,
  to: string,
): boolean {
  if (!from && !to) return true;

  const dateKey = getLocalDateKey(timestamp);

  if (!dateKey) return false;
  if (from && dateKey < from) return false;
  if (to && dateKey > to) return false;

  return true;
}

/**
 * Display an existing date value using the Ethiopian calendar.
 * No change is made to the original date or backend value.
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

export default function CreditContracts() {
  const location = useLocation();
  const { user } = useAuth();

  const isFinance = user?.role === USER_ROLES.FINANCE;

  const portalBase = location.pathname.startsWith("/finance")
    ? "/finance"
    : "/sales";

  const { data: contracts, loading } = useCreditContracts();
  const { data: orders } = useAllCreditContractOrders();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [selectedContract, setSelectedContract] =
    useState<CreditContract | null>(null);

  const ordersByContract = useMemo(() => {
    const map = new Map<string, CreditContractOrder[]>();

    for (const order of orders ?? []) {
      const list = map.get(order.creditContractId);

      if (list) {
        list.push(order);
      } else {
        map.set(order.creditContractId, [order]);
      }
    }

    return map;
  }, [orders]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    return (contracts ?? []).filter((contract) => {
      if (status !== "ALL" && contract.status !== status) {
        return false;
      }

      if (!matchesDateRange(contract.contractDate, from, to)) {
        return false;
      }

      if (!term) return true;

      return (
        contract.contractNumber.toLowerCase().includes(term) ||
        contract.customer.name.toLowerCase().includes(term) ||
        contract.customer.tin.toLowerCase().includes(term) ||
        contract.fsNo.toLowerCase().includes(term)
      );
    });
  }, [contracts, status, search, from, to]);

  const totals = useMemo(() => {
    let contractValue = 0;
    let fulfilled = 0;
    let active = 0;
    let orderCount = 0;

    for (const contract of contracts ?? []) {
      const contractOrders =
        ordersByContract.get(contract.id) ?? [];

      const progress = getCreditContractProgress(
        contract,
        contractOrders,
      );

      contractValue += progress.contractValue;
      fulfilled += progress.fulfilledValue;
      orderCount += contractOrders.length;

      if (contract.status === CREDIT_CONTRACT_STATUS.ACTIVE) {
        active += 1;
      }
    }

    return {
      contractValue,
      fulfilled,
      active,
      orderCount,
    };
  }, [contracts, ordersByContract]);

  const stats = [
    {
      label: "Credit Contracts",
      value: String(contracts?.length ?? 0),
      icon: ScrollText,
    },
    {
      label: "Active",
      value: String(totals.active),
      icon: TrendingUp,
    },
    {
      label: "Total Contract Value",
      value: formatCurrency(totals.contractValue),
      icon: FileText,
    },
    {
      label: "Fulfilled Value",
      value: formatCurrency(totals.fulfilled),
      icon: CreditCard,
    },
  ];

  if (loading && !contracts) {
    return (
      <div className="flex items-center justify-center py-20">
        <div
          className="animate-spin text-muted-foreground/70"
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Credit Contracts
          </h1>
        </div>

        {isFinance && (
          <Button
            onClick={() => setFormOpen(true)}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <FileText className="size-4" />
            New Credit Contract
          </Button>
        )}
      </div>

      {/* Sales information */}
      

      {/* Statistics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card
            key={stat.label}
            className="border-border bg-card shadow-none"
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {stat.label}
                </span>

                <stat.icon className="size-4 text-muted-foreground/70" />
              </div>

              <div className="mt-2 text-lg font-semibold tabular-nums text-foreground">
                {stat.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contract, customer, TIN, or FS No"
            className="h-9 w-full rounded-md border border-input bg-popover pl-8 text-sm text-foreground placeholder:text-muted-foreground/70"
          />
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-48 border-input bg-popover text-sm text-foreground">
            <SelectValue />
          </SelectTrigger>

          <SelectContent className="border-input bg-popover">
            <SelectItem value="ALL">All statuses</SelectItem>

            {Object.values(CREDIT_CONTRACT_STATUS).map((value) => (
              <SelectItem key={value} value={value}>
                {CREDIT_CONTRACT_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Ethiopian date filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <EthiopianDatePicker
              value={from}
              onChange={setFrom}
              placeholder="From date"
            />
          </div>

          <span className="text-xs text-muted-foreground/70">to</span>

          <div className="w-44">
            <EthiopianDatePicker
              value={to}
              onChange={setTo}
              placeholder="To date"
            />
          </div>
        </div>

        {(from || to) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
            className="h-9 text-xs text-muted-foreground"
          >
            Clear dates
          </Button>
        )}
      </div>

      {/* Contract table */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="p-0">
          {visible.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">
                      Contract ID
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Customer
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      FS No
                    </th>

                    <th className="px-4 py-2.5 text-right font-medium">
                      Contract Value
                    </th>

                    <th className="px-4 py-2.5 text-right font-medium">
                      Fulfilled
                    </th>

                    <th className="px-4 py-2.5 text-right font-medium">
                      Remaining
                    </th>

                    <th className="px-4 py-2.5 text-right font-medium">
                      Orders
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Contract Date
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Status
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {visible.map((contract) => {
                    const contractOrders =
                      ordersByContract.get(contract.id) ?? [];

                    const progress = getCreditContractProgress(
                      contract,
                      contractOrders,
                    );

                    return (
                      <tr
                        key={contract.id}
                        className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs font-medium">
                          <Link
                            to={`${portalBase}/credit-contracts/${contract.id}`}
                            className="text-info hover:underline"
                          >
                            {contract.contractNumber}
                          </Link>
                        </td>

                        <td className="px-4 py-2.5 text-foreground">
                          {contract.customer.name}
                        </td>

                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {contract.fsNo || "—"}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                          {formatCurrency(progress.contractValue)}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                          {formatCurrency(progress.fulfilledValue)}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatCurrency(progress.remainingValue)}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {contractOrders.length}
                        </td>

                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {formatEthiopianDate(contract.contractDate)}
                        </td>

                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`border text-[10px] font-medium ${
                              CREDIT_CONTRACT_STATUS_UI[contract.status]
                                .className
                            }`}
                          >
                            {CREDIT_CONTRACT_STATUS_UI[contract.status].label}
                          </Badge>
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
                No credit contracts match the current view
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {isFinance
                  ? "Create a credit contract to make it available to the Sales team."
                  : "Finance has not published an active credit contract yet."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* New contract dialog */}
      {isFinance && (
        <CreditContractFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          onSaved={() => undefined}
        />
      )}

      {/* Order dialog */}
      {(isFinance || (!isFinance && user?.role === USER_ROLES.SALES)) && (
        <CreditOrderDialog
          open={orderDialogOpen}
          onOpenChange={setOrderDialogOpen}
          contract={selectedContract}
          onSaved={() => {
            setSelectedContract(null);
            setOrderDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}
