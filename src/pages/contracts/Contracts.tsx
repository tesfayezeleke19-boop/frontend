
/**
 * Contract Orders — shared list page (Finance and Sales).
 *
 * Contracts are company-wide: every authorized Sales user sees the same
 * active contracts and can work on any of them. There is no assignment, no
 * claim/accept step, and no per-salesperson queue.
 *
 * Finance can create and manage contracts here; Sales gets a read-only view
 * of the list plus the ability to open a contract and complete an order.
 */
import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Loader2,
  Plus,
  Search,
  ScrollText,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { USER_ROLES } from "@/services/auth";
import {
  useAllContractOrders,
  useContracts,
} from "@/hooks/use-contracts-data";
import {
  CONTRACT_STATUS,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_UI,
  getContractProgress,
  type ContractOrder,
} from "@/services/contracts/types";
import { formatCurrency, formatDate } from "@/services/sales/format";
import { ContractFormDialog } from "@/components/contracts/ContractFormDialog";

function matchesDateRange(
  timestamp: number,
  from: string,
  to: string,
): boolean {
  if (!from && !to) return true;
  const date = new Date(timestamp);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

export default function Contracts() {
  const location = useLocation();
  const { user } = useAuth();
  const isFinance = user?.role === USER_ROLES.FINANCE;
  const portalBase = location.pathname.startsWith("/finance")
    ? "/finance"
    : "/sales";

  const {
    data: contracts,
    loading,
    refresh: refreshContracts,
  } = useContracts();

  const { data: orders } = useAllContractOrders();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const ordersByContract = useMemo(() => {
    const map = new Map<string, ContractOrder[]>();
    for (const order of orders ?? []) {
      const list = map.get(order.contractId);
      if (list) list.push(order);
      else map.set(order.contractId, [order]);
    }
    return map;
  }, [orders]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (contracts ?? []).filter((contract) => {
      if (status !== "ALL" && contract.status !== status) return false;
      if (!matchesDateRange(contract.contractDate, from, to)) return false;
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
      const contractOrders = ordersByContract.get(contract.id) ?? [];
      const progress = getContractProgress(contract, contractOrders);

      contractValue += progress.contractValue;
      fulfilled += progress.fulfilledValue;
      orderCount += contractOrders.length;

      if (contract.status === CONTRACT_STATUS.ACTIVE) active += 1;
    }

    return { contractValue, fulfilled, active, orderCount };
  }, [contracts, ordersByContract]);

  const stats = [
    {
      label: "Contracts",
      value: String(contracts?.length ?? 0),
      icon: ScrollText,
    },
    {
      label: "Active Contracts",
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
      icon: FileText,
    },
  ];

  if (loading && !contracts) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Contract Orders
          </h1>
        </div>

        {isFinance && (
          <Button
            onClick={() => setFormOpen(true)}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            New Contract
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-border bg-card shadow-none">
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
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contract, customer, TIN, or FS No"
            className="h-9 border-input bg-popover pl-8 text-sm text-foreground placeholder:text-muted-foreground/70"
          />
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-48 border-input bg-popover text-sm text-foreground">
            <SelectValue />
          </SelectTrigger>

          <SelectContent className="border-input bg-popover">
            <SelectItem value="ALL">All statuses</SelectItem>

            {Object.values(CONTRACT_STATUS).map((value) => (
              <SelectItem key={value} value={value}>
                {CONTRACT_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <div className="w-40">
            <EthiopianDatePicker
              value={from}
              onChange={setFrom}
              placeholder="From date"
            />
          </div>

          <span className="text-xs text-muted-foreground/70">to</span>

          <div className="w-40">
            <EthiopianDatePicker
              value={to}
              onChange={setTo}
              placeholder="To date"
            />
          </div>
        </div>
      </div>

      {/* Contract table */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="p-0">
          {visible.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">Contract ID</th>
                    <th className="px-4 py-2.5 font-medium">Customer</th>
                    <th className="px-4 py-2.5 font-medium">FS No</th>
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
                    <th className="px-4 py-2.5 font-medium">Contract Date</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>

                <tbody>
                  {visible.map((contract) => {
                    const contractOrders =
                      ordersByContract.get(contract.id) ?? [];

                    const progress = getContractProgress(
                      contract,
                      contractOrders,
                    );

                    const statusUi =
                      CONTRACT_STATUS_UI[
                        contract.status as keyof typeof CONTRACT_STATUS_UI
                      ] ?? {
                        label: "Unknown status",
                        className:
                          "border-muted-foreground/30 bg-muted text-muted-foreground",
                      };

                    return (
                      <tr
                        key={contract.id}
                        className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs font-medium">
                          <Link
                            to={`${portalBase}/contracts/${contract.id}`}
                            className="text-info hover:underline"
                          >
                            {contract.contractNumber}
                          </Link>
                        </td>

                        <td className="px-4 py-2.5 text-foreground">
                          {contract.customer.name}
                        </td>

                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {contract.fsNo}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                          {formatCurrency(progress.contractValue)}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                          {formatCurrency(progress.fulfilledValue)}

                          {progress.reachedValue && (
                            <div className="font-mono text-[9px] uppercase tracking-wide text-success">
                              100% — order entry closed
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatCurrency(progress.remainingValue)}
                        </td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {progress.orderCount}
                        </td>

                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {formatDate(contract.contractDate)}
                        </td>

                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`border text-[10px] font-medium ${statusUi.className}`}
                          >
                            {statusUi.label}
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
                No contracts match the current view
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                {isFinance
                  ? "Create a contract to make it available to the Sales team."
                  : "Finance has not published an active contract yet."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {isFinance && (
        <ContractFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          onSaved={() => {
            refreshContracts();
          }}
        />
      )}
    </div>
  );
}
