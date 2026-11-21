
/**
 * Contract order dialog — ONE form for completing a new order under a
 * contract and for correcting an existing one.
 *
 * Aggregate types and unit prices are fetched from the Sales API.
 * The fulfillment amount is VAT-inclusive and can be entered directly;
 * quantity and amount update each other using the database unit price.
 *
 * The order's VAT-inclusive total cannot exceed the contract's available
 * remaining value. When correcting an existing order, its current value
 * is added back to the available amount so it is not counted twice.
 *
 * The responsible salesperson is recorded by the repository.
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
import { VAT_DIVISOR } from "@/services/sales/calc";
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
  fulfillmentAmount: string;
  royaltyInvoiceNumber: string;
  orderDate: string;
}

const EMPTY_FORM: FormState = {
  aggregate: "",
  quantity: "",
  unitPrice: "",
  fulfillmentAmount: "",
  royaltyInvoiceNumber: "",
  orderDate: dateInputValue(),
};

function formFromOrder(order: ContractOrder): FormState {
  const totals = calculateContractOrderTotals(order);

  return {
    aggregate: order.aggregate,
    quantity: String(order.quantity),
    unitPrice: String(order.unitPrice),
    fulfillmentAmount: String(totals.lineTotalInclVat),
    royaltyInvoiceNumber: order.royaltyInvoiceNumber ?? "",
    orderDate: dateInputValue(order.orderDate),
  };
}

interface ContractOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: Contract;
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

  // Contract capacity information.
  const [availableContractValue, setAvailableContractValue] = useState(0);
  const [loadingContractValue, setLoadingContractValue] = useState(true);
  const [contractValueLoadError, setContractValueLoadError] = useState("");

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

  // Load the contract's available value from the backend.
  useEffect(() => {
    let cancelled = false;

    const loadContractCapacity = async () => {
      setLoadingContractValue(true);
      setContractValueLoadError("");

      try {
        const progress = await contractsRepository.getContractProgress(
          contract.id,
        );

        if (cancelled) return;

        // availableValue accounts for both completed and reserved orders.
        // remainingValue is retained as a fallback for older responses.
        const backendAvailableValue = Number(
          progress?.availableValue ?? progress?.remainingValue ?? 0,
        );

        if (
          !Number.isFinite(backendAvailableValue) ||
          backendAvailableValue < 0
        ) {
          throw new Error("The contract's available value is invalid.");
        }

        // During correction, the existing order is already included in
        // the backend's completed/reserved totals. Add it back so the
        // edited order is compared against capacity excluding itself.
        const existingOrderValue = order
          ? calculateContractOrderTotals(order).lineTotalInclVat
          : 0;

        setAvailableContractValue(
          Math.max(0, backendAvailableValue + existingOrderValue),
        );
      } catch (error) {
        if (cancelled) return;

        const message =
          error instanceof Error
            ? error.message
            : "Could not load the contract's remaining value.";

        setContractValueLoadError(message);
        toast.error(`Failed to load contract balance: ${message}`);
      } finally {
        if (!cancelled) {
          setLoadingContractValue(false);
        }
      }
    };

    void loadContractCapacity();

    return () => {
      cancelled = true;
    };
  }, [contract.id, order]);

  const update = (field: keyof FormState, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };

      // Quantity is the source value when it is edited.
      if (field === "quantity") {
        const quantity = parseFloat(value) || 0;
        const unitPrice = parseFloat(prev.unitPrice) || 0;

        next.fulfillmentAmount = String(
          quantity * unitPrice * VAT_DIVISOR,
        );
      }

      return next;
    });

    setErrors((prev) => {
      if (!prev[field]) return prev;

      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleFulfillmentAmountChange = (value: string) => {
    setForm((prev) => {
      const amount = parseFloat(value) || 0;
      const unitPrice = parseFloat(prev.unitPrice) || 0;

      return {
        ...prev,
        fulfillmentAmount: value,
        quantity:
          unitPrice > 0
            ? String(amount / (unitPrice * VAT_DIVISOR))
            : prev.quantity,
      };
    });

    setErrors((prev) => {
      const next = { ...prev };
      delete next.quantity;
      delete next.fulfillmentAmount;
      return next;
    });
  };

  // Selecting an aggregate also selects its database-defined unit price.
  const handleAggregateChange = (aggregateName: string) => {
    const selectedAggregate = aggregateTypes.find(
      (item) => item.name === aggregateName,
    );

    setForm((prev) => {
      const unitPrice = selectedAggregate?.pricePerM3 ?? 0;
      const quantity = parseFloat(prev.quantity) || 0;

      return {
        ...prev,
        aggregate: aggregateName,
        unitPrice: selectedAggregate ? String(unitPrice) : "",
        fulfillmentAmount: String(
          quantity * unitPrice * VAT_DIVISOR,
        ),
      };
    });

    setErrors((prev) => {
      const next = { ...prev };
      delete next.aggregate;
      delete next.unitPrice;
      delete next.fulfillmentAmount;
      return next;
    });
  };

  const input: ContractOrderInput = {
    aggregate: form.aggregate,
    quantity: parseFloat(form.quantity) || 0,
    unitPrice: parseFloat(form.unitPrice) || 0,
    royaltyInvoiceNumber: form.royaltyInvoiceNumber,
    orderDate: new Date(`${form.orderDate}T12:00:00.000Z`).getTime(),
  };

  const totals = calculateContractOrderTotals(input);
  const isCorrection = Boolean(order);

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

  const fulfillmentAmount = parseFloat(form.fulfillmentAmount) || 0;

  const exceedsContractValue =
    fulfillmentAmount > availableContractValue + 0.01;

  const remainingAfterOrder = Math.max(
    0,
    availableContractValue - fulfillmentAmount,
  );

  const handleSubmit = async () => {
  if (loadingAggregates && !isCorrection) {
    toast.error("Please wait while aggregate types are loading.");
    return;
  }

  if (loadingContractValue) {
    toast.error("Please wait while the contract balance is loading.");
    return;
  }

  if (contractValueLoadError) {
    toast.error(
      "The contract balance could not be verified. Please try again.",
    );
    return;
  }

  if (
    !isCorrection &&
    !aggregateTypes.some((item) => item.name === form.aggregate)
  ) {
    toast.error("Please select an active aggregate type from the database.");
    return;
  }

  const parsed: ContractOrderInput = {
    ...input,
    orderDate: Number.isNaN(input.orderDate) ? 0 : input.orderDate,
  };

  const validation = validateContractOrderInput(parsed);
  const nextErrors = { ...validation.errors };

  if (fulfillmentAmount <= 0) {
    nextErrors.fulfillmentAmount =
      "Fulfillment amount must be greater than zero.";
  }

  if (
    Number.isFinite(fulfillmentAmount) &&
    Math.abs(fulfillmentAmount - totals.lineTotalInclVat) > 0.01
  ) {
    nextErrors.fulfillmentAmount =
      "Fulfillment amount does not match the quantity and unit price.";
  }

  if (fulfillmentAmount > availableContractValue + 0.01) {
    nextErrors.fulfillmentAmount =
      `Order total cannot exceed the available contract value of ${formatCurrency(
        availableContractValue,
      )}.`;
  }

  setErrors(nextErrors);

  if (Object.keys(nextErrors).length > 0) return;

  setSaving(true);

  try {
    const saved = order
      ? await contractsRepository.updateOrder(order.id, parsed)
      : await contractsRepository.completeOrder(contract.id, parsed);

    if (order) {
      toast.success(`Order ${saved.orderNumber} corrected successfully.`);
    } else {
      toast.success(
        `Order ${saved.orderNumber} created successfully and is pending Finance approval.`,
      );
    }

    onSaved(saved);
    onCancel();
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Order could not be saved.",
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
            : "Create Contract Order"}
        </DialogTitle>

        <DialogDescription className="text-sm text-muted-foreground">
          {contract.contractNumber} · {contract.customer.name} · FS No{" "}
          {contract.fsNo}. 
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        {/* Contract remaining value */}
        <div className="rounded-lg border border-border bg-sidebar p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                Available Contract Value
              </p>

              <p className="mt-1 text-base font-semibold tabular-nums text-foreground">
                {loadingContractValue ? (
                  <span className="inline-flex items-center gap-2 text-sm font-normal text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading contract balance...
                  </span>
                ) : contractValueLoadError ? (
                  <span className="text-sm text-destructive">
                    Could not load balance
                  </span>
                ) : (
                  formatCurrency(availableContractValue)
                )}
              </p>
            </div>

            {!loadingContractValue && !contractValueLoadError && (
              <div className="text-right">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  After This Order
                </p>
                <p
                  className={`mt-1 text-sm font-semibold tabular-nums ${
                    exceedsContractValue
                      ? "text-destructive"
                      : "text-foreground"
                  }`}
                >
                  {formatCurrency(remainingAfterOrder)}
                </p>
              </div>
            )}
          </div>

          {contractValueLoadError && (
            <p className="mt-2 text-xs text-destructive">
              {contractValueLoadError}
            </p>
          )}
        </div>

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
                  <SelectItem key={aggregate.id} value={aggregate.name}>
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

        {/* VAT-inclusive fulfillment amount */}
        <div>
          <Label className="text-xs text-muted-foreground">
            Fulfillment Amount (ETB, VAT-inclusive) *
          </Label>

          <Input
            inputMode="decimal"
            value={form.fulfillmentAmount}
            onChange={(e) =>
              handleFulfillmentAmountChange(e.target.value)
            }
            placeholder="Enter amount or quantity above"
            className={`${inputClass} mt-1 ${
              exceedsContractValue ? "border-destructive" : ""
            }`}
          />

          {errors.fulfillmentAmount && (
            <p className="mt-1 text-xs text-destructive">
              {errors.fulfillmentAmount}
            </p>
          )}

          {exceedsContractValue && !errors.fulfillmentAmount && (
            <p className="mt-1 text-xs text-destructive">
              This amount exceeds the available contract value.
            </p>
          )}

          <p className="mt-1 text-[10px] text-muted-foreground/70">
            Entering an amount recalculates quantity using the selected
            aggregate unit price and 15% VAT.
          </p>
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
              Fulfillment Value (VAT-incl)
            </div>

            <div
              className={`mt-1 text-sm font-medium tabular-nums ${
                exceedsContractValue ? "text-destructive" : "text-foreground"
              }`}
            >
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
            loadingContractValue ||
            Boolean(contractValueLoadError) ||
            (loadingAggregates && !isCorrection) ||
            (!isCorrection && aggregateTypes.length === 0) ||
            exceedsContractValue
          }
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ||
          loadingContractValue ||
          (loadingAggregates && !isCorrection) ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}

          {isCorrection ? "Save Correction" : "Create Order"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
