
/**
 * Contract order dialog — ONE form for completing a new order under a
 * contract and for correcting an existing one.
 *
 * Aggregate types and their unit prices are fetched from the Sales API.
 * Selecting an aggregate automatically fills its database unit price.
 *
 * The form captures ONLY the individual order: aggregate, quantity, unit
 * price, Royalty Invoice Number, and order date.
 *
 * The responsible salesperson is NEVER chosen in this form — the repository
 * records the authenticated session's identity when the order is completed.
 *
 * The form body mounts only while the dialog is open, so each open starts
 * from the current order/contract state without a state-syncing effect.
 */
import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { contractsRepository } from "@/services/contracts";
import {
  calculateContractOrderTotals,
  validateContractOrderInput,
  type Contract,
  type ContractOrder,
  type ContractOrderInput,
} from "@/services/contracts/types";
import {
  getSalesAggregateTypes,
  type SalesAggregateTypeOption,
} from "@/services/sales/apiInvoiceRepo";
import { formatCurrency, formatQuantity } from "@/services/sales/format";

const inputClass =
  "h-9 border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30";

const selectTriggerClass =
  "h-9 w-full border-input bg-popover text-sm text-foreground";

function dateInputValue(ts?: number): string {
  const date = new Date(ts && Number.isFinite(ts) ? ts : Date.now());
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

interface FormState {
  aggregate: string;
  quantity: string;
  unitPrice: string;
  royaltyInvoiceNumber: string;
  orderDate: string;
}

const EMPTY_FORM: FormState = {
  aggregate: "",
  quantity: "",
  unitPrice: "",
  royaltyInvoiceNumber: "",
  orderDate: dateInputValue(),
};

function formFromOrder(order: ContractOrder): FormState {
  return {
    aggregate: order.aggregate,
    quantity: String(order.quantity),
    unitPrice: String(order.unitPrice),
    royaltyInvoiceNumber: order.royaltyInvoiceNumber ?? "",
    orderDate: dateInputValue(order.orderDate),
  };
}

interface ContractOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: Contract;
  /** Present when correcting an existing order. */
  order?: ContractOrder | null;
  onSaved: (order: ContractOrder) => void;
}

export function ContractOrderDialog({
  open,
  onOpenChange,
  contract,
  order,
  onSaved,
}: ContractOrderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ContractOrderForm
          contract={contract}
          order={order ?? null}
          onCancel={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function ContractOrderForm({
  contract,
  order,
  onCancel,
  onSaved,
}: {
  contract: Contract;
  order: ContractOrder | null;
  onCancel: () => void;
  onSaved: (order: ContractOrder) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    order ? formFromOrder(order) : EMPTY_FORM,
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [aggregateTypes, setAggregateTypes] = useState<
    SalesAggregateTypeOption[]
  >([]);
  const [loadingAggregates, setLoadingAggregates] = useState(true);
  const [aggregateLoadError, setAggregateLoadError] = useState("");

  // Load active aggregate types and their prices from the database.
  // This form mounts only when the dialog opens.
  useEffect(() => {
    let cancelled = false;

    const loadAggregateTypes = async () => {
      setLoadingAggregates(true);
      setAggregateLoadError("");

      try {
        const result = await getSalesAggregateTypes();

        if (cancelled) return;

        setAggregateTypes(result);

        if (result.length === 0) {
          setAggregateLoadError(
            "No active aggregate types were returned from the database.",
          );
        }
      } catch (error) {
        if (cancelled) return;

        const message =
          error instanceof Error
            ? error.message
            : "Could not load aggregate types.";

        setAggregateLoadError(message);
        toast.error(`Failed to load aggregate types: ${message}`);
      } finally {
        if (!cancelled) {
          setLoadingAggregates(false);
        }
      }
    };

    void loadAggregateTypes();

    return () => {
      cancelled = true;
    };
  }, []);

  const update = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));

    setErrors((prev) => {
      if (!prev[field]) return prev;

      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // Selecting an aggregate also selects its database-defined unit price.
  const handleAggregateChange = (aggregateName: string) => {
    const selectedAggregate = aggregateTypes.find(
      (item) => item.name === aggregateName,
    );

    setForm((prev) => ({
      ...prev,
      aggregate: aggregateName,
      unitPrice: selectedAggregate
        ? String(selectedAggregate.pricePerM3)
        : "",
    }));

    setErrors((prev) => {
      const next = { ...prev };
      delete next.aggregate;
      delete next.unitPrice;
      return next;
    });
  };

  const input: ContractOrderInput = {
    aggregate: form.aggregate,
    quantity: parseFloat(form.quantity) || 0,
    unitPrice: parseFloat(form.unitPrice) || 0,
    royaltyInvoiceNumber: form.royaltyInvoiceNumber,
    orderDate: new Date(`${form.orderDate}T00:00:00`).getTime(),
  };

  const totals = calculateContractOrderTotals(input);
  const isCorrection = Boolean(order);

  // Keep the original aggregate visible when correcting an old order,
  // even if it is no longer active in the database.
  const aggregateOptions = [...aggregateTypes];

  if (
    order &&
    order.aggregate &&
    !aggregateOptions.some((item) => item.name === order.aggregate)
  ) {
    aggregateOptions.unshift({
      id: -1,
      name: order.aggregate,
      pricePerM3: order.unitPrice,
      description: "Previously recorded aggregate",
    });
  }

  const handleSubmit = async () => {
    if (loadingAggregates && !isCorrection) {
      toast.error("Please wait while aggregate types are loading.");
      return;
    }

    if (
      !isCorrection &&
      !aggregateTypes.some((item) => item.name === form.aggregate)
    ) {
      toast.error(
        "Please select an active aggregate type from the database.",
      );
      return;
    }

    const parsed: ContractOrderInput = {
      ...input,
      orderDate: Number.isNaN(input.orderDate) ? 0 : input.orderDate,
    };

    const validation = validateContractOrderInput(parsed);
    setErrors(validation.errors);

    if (!validation.valid) return;

    setSaving(true);

    try {
      const saved = order
        ? await contractsRepository.updateOrder(order.id, parsed)
        : await contractsRepository.completeOrder(contract.id, parsed);

      toast.success(
        order
          ? `Order ${saved.orderNumber} corrected`
          : `Order ${saved.orderNumber} completed`,
      );

      onSaved(saved);
      onCancel();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Order could not be saved",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="border-input bg-card sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="text-foreground">
          {isCorrection
            ? `Correct Order ${order?.orderNumber}`
            : "Complete Order"}
        </DialogTitle>

        <DialogDescription className="text-sm text-muted-foreground">
          {contract.contractNumber} · {contract.customer.name} · FS No{" "}
          {contract.fsNo}. Customer, contract value, and the paper contract stay
          on the parent contract.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {/* Aggregate type */}
          <div>
            <Label className="text-xs text-muted-foreground">
              Aggregate Type *
            </Label>

            <Select
              value={form.aggregate}
              onValueChange={handleAggregateChange}
              disabled={loadingAggregates || aggregateOptions.length === 0}
            >
              <SelectTrigger className={`${selectTriggerClass} mt-1`}>
                <SelectValue
                  placeholder={
                    loadingAggregates
                      ? "Loading aggregates..."
                      : "Select aggregate"
                  }
                />
              </SelectTrigger>

              <SelectContent className="border-input bg-popover">
                {aggregateOptions.map((aggregate) => (
                  <SelectItem
                    key={aggregate.id}
                    value={aggregate.name}
                  >
                    {aggregate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {loadingAggregates && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Loading from database...
              </p>
            )}

            {!loadingAggregates && aggregateLoadError && (
              <p className="mt-1 text-xs text-destructive">
                {aggregateLoadError}
              </p>
            )}

            {errors.aggregate && (
              <p className="mt-1 text-xs text-destructive">
                {errors.aggregate}
              </p>
            )}
          </div>

          {/* Order date */}
          <div>
            <Label className="text-xs text-muted-foreground">
              Order Date *
            </Label>

            <EthiopianDatePicker
              value={form.orderDate}
              onChange={(value) => update("orderDate", value)}
              className="mt-1"
            />

            {errors.orderDate && (
              <p className="mt-1 text-xs text-destructive">
                {errors.orderDate}
              </p>
            )}
          </div>

          {/* Quantity */}
          <div>
            <Label className="text-xs text-muted-foreground">
              Quantity (m³) *
            </Label>

            <Input
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) => update("quantity", e.target.value)}
              placeholder="0.00"
              className={`${inputClass} mt-1`}
            />

            {errors.quantity && (
              <p className="mt-1 text-xs text-destructive">
                {errors.quantity}
              </p>
            )}
          </div>

          {/* Database unit price */}
          <div>
            <Label className="text-xs text-muted-foreground">
              Unit Price (ETB/m³) *
            </Label>

            <Input
              inputMode="decimal"
              value={form.unitPrice}
              placeholder="Automatically loaded"
              readOnly
              className={`${inputClass} mt-1 cursor-not-allowed opacity-80`}
            />

            {errors.unitPrice && (
              <p className="mt-1 text-xs text-destructive">
                {errors.unitPrice}
              </p>
            )}

            {form.aggregate && (
              <p className="mt-1 text-[10px] text-muted-foreground/70">
                Price supplied by the aggregate database record.
              </p>
            )}
          </div>
        </div>

        {/* Royalty invoice number */}
        <div>
          <Label className="text-xs text-muted-foreground">
            Royalty Invoice Number *
          </Label>

          <Input
            value={form.royaltyInvoiceNumber}
            onChange={(e) =>
              update("royaltyInvoiceNumber", e.target.value)
            }
            placeholder="e.g. RI-2026-001"
            className={`${inputClass} mt-1`}
          />

          {errors.royaltyInvoiceNumber && (
            <p className="mt-1 text-xs text-destructive">
              {errors.royaltyInvoiceNumber}
            </p>
          )}
        </div>

        {/* Order totals */}
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-sidebar p-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              Order Total (VAT-excl — royalty base)
            </div>

            <div className="mt-1 text-sm font-medium tabular-nums text-foreground">
              {formatCurrency(totals.lineTotalExclVat)}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              Fulfillment value (VAT-incl)
            </div>

            <div className="mt-1 text-sm font-medium tabular-nums text-foreground">
              {formatCurrency(totals.lineTotalInclVat)}
            </div>
          </div>

          <div className="col-span-2 text-[11px] text-muted-foreground/70">
            3% royalty on this order:{" "}
            {formatCurrency(totals.lineTotalExclVat * 0.03)} ·{" "}
            {formatQuantity(input.quantity, "m³")}
          </div>
        </div>

        {/* Correction audit information */}
        {isCorrection && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-[11px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-info" />

            <p>
              Completed By stays{" "}
              <span className="font-medium text-foreground">
                {order?.completedByName}
              </span>{" "}
              — your correction is recorded separately as the editor. The
              order's royalty entry is updated, never duplicated.
            </p>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={saving}
          className="border-input text-foreground hover:bg-accent"
        >
          Cancel
        </Button>

        <Button
          onClick={handleSubmit}
          disabled={
            saving ||
            (loadingAggregates && !isCorrection) ||
            (!isCorrection && aggregateTypes.length === 0)
          }
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving || (loadingAggregates && !isCorrection) ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}

          {isCorrection ? "Save Correction" : "Complete Order"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
