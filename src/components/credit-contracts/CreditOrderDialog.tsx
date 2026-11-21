
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  CreditContract,
  CreditContractOrder,
  type CreditContractOrderInput,
} from "@/services/creditContracts/types";
import { creditContractsRepository } from "@/services/creditContracts/repository";
import {
  getSalesAggregateTypes,
  type SalesAggregateTypeOption,
} from "@/services/sales/apiInvoiceRepo";
import { formatCurrency } from "@/services/sales/format";
import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract?: CreditContract | null;
  onSaved: () => void;
  initialOrder?: CreditContractOrder | null;
}

function toLocalDateInput(value?: number): string {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function todayDateInput(): string {
  return toLocalDateInput(Date.now());
}

export function CreditOrderDialog({
  open,
  onOpenChange,
  contract,
  onSaved,
  initialOrder,
}: Props) {
  const isEditing = !!(
    initialOrder && initialOrder.status === "COMPLETED"
  );

  const [selectedContractId, setSelectedContractId] = useState(
    initialOrder?.creditContractId ?? contract?.id ?? "",
  );

  const [aggregate, setAggregate] = useState(
    initialOrder?.aggregate ?? "",
  );

  const [aggregateOptions, setAggregateOptions] = useState<
    SalesAggregateTypeOption[]
  >([]);

  const [aggregatesLoading, setAggregatesLoading] = useState(false);
  const [aggregateError, setAggregateError] = useState("");

  const [quantity, setQuantity] = useState(
    initialOrder ? String(initialOrder.quantity) : "",
  );

  const [unitPrice, setUnitPrice] = useState(
    initialOrder ? String(initialOrder.unitPrice) : "",
  );

  const [royaltyInvoiceNumber, setRoyaltyInvoiceNumber] = useState(
    initialOrder?.royaltyInvoiceNumber ?? "",
  );

  const [orderDate, setOrderDate] = useState(
    initialOrder
      ? toLocalDateInput(initialOrder.orderDate)
      : todayDateInput(),
  );

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const loadAggregates = async () => {
      setAggregatesLoading(true);
      setAggregateError("");

      try {
        const result = await getSalesAggregateTypes();

        if (!cancelled) {
          setAggregateOptions(result);
        }
      } catch (error) {
        if (!cancelled) {
          setAggregateError(
            error instanceof Error
              ? error.message
              : "Unable to load aggregate types.",
          );
        }
      } finally {
        if (!cancelled) {
          setAggregatesLoading(false);
        }
      }
    };

    void loadAggregates();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const formKey = `${open ? "open" : "closed"}:${
    initialOrder?.id ?? "new"
  }:${contract?.id ?? ""}:${initialOrder?.updatedAt ?? 0}`;

  const [seededKey, setSeededKey] = useState(formKey);

  if (seededKey !== formKey) {
    setSeededKey(formKey);

    if (initialOrder) {
      setSelectedContractId(initialOrder.creditContractId);
      setAggregate(initialOrder.aggregate);
      setQuantity(String(initialOrder.quantity));
      setUnitPrice(String(initialOrder.unitPrice));
      setRoyaltyInvoiceNumber(
        initialOrder.royaltyInvoiceNumber ?? "",
      );
      setOrderDate(toLocalDateInput(initialOrder.orderDate));
    } else {
      setSelectedContractId(contract?.id ?? "");
      setAggregate("");
      setQuantity("");
      setUnitPrice("");
      setRoyaltyInvoiceNumber("");
      setOrderDate(todayDateInput());
    }

    setErrors({});
  }

  const handleAggregateChange = (value: string) => {
    setAggregate(value);

    const selected = aggregateOptions.find(
      (option) => option.name === value,
    );

    if (selected) {
      setUnitPrice(String(selected.pricePerM3));
    }

    setErrors((previous) => {
      const next = { ...previous };
      delete next.aggregate;
      delete next.unitPrice;
      return next;
    });
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (!aggregate.trim()) {
      next.aggregate = "Aggregate is required";
    }

    if (
      !quantity ||
      !Number.isFinite(Number(quantity)) ||
      Number(quantity) <= 0
    ) {
      next.quantity = "Quantity must be greater than zero";
    }

    if (
      !unitPrice ||
      !Number.isFinite(Number(unitPrice)) ||
      Number(unitPrice) <= 0
    ) {
      next.unitPrice = "Enter a valid unit price";
    }

    if (!royaltyInvoiceNumber.trim()) {
      next.royaltyInvoiceNumber =
        "Royalty Invoice Number is required";
    }

    if (!orderDate) {
      next.orderDate = "A valid order date is required";
    }

    if (!selectedContractId) {
      next.contract = "Select a contract";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const lineTotalExclVat =
    Number.isFinite(Number(quantity)) &&
    Number.isFinite(Number(unitPrice)) &&
    quantity !== "" &&
    unitPrice !== ""
      ? Number(quantity) * Number(unitPrice)
      : null;

  const handleSubmit = async () => {
    if (!validate()) return;

    setBusy(true);

    try {
      const input: CreditContractOrderInput = {
        aggregate: aggregate.trim(),
        quantity: Number(quantity),
        unitPrice: Number(unitPrice),
        royaltyInvoiceNumber: royaltyInvoiceNumber.trim(),
        orderDate: new Date(`${orderDate}T12:00:00`).getTime(),
      };

      if (isEditing && initialOrder) {
        await creditContractsRepository.updateOrder(
          initialOrder.id,
          input,
        );
      } else {
        await creditContractsRepository.addOrder(
          selectedContractId,
          input,
        );
      }

      onSaved();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const activeContracts = contract ? [contract] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-input bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-semibold text-foreground">
            {isEditing ? "Edit Order" : "Add Order"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 pt-2">
          {!isEditing && (
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Credit Contract *
              </Label>

              <Select
                value={selectedContractId}
                onValueChange={setSelectedContractId}
              >
                <SelectTrigger className="mt-1 h-9 rounded-md border-input bg-popover text-sm">
                  <SelectValue placeholder="Select a contract" />
                </SelectTrigger>

                <SelectContent className="border-input bg-popover">
                  {activeContracts?.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.contractNumber} — {item.customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {errors.contract && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.contract}
                </p>
              )}
            </div>
          )}

          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Aggregate *
            </Label>

            <Select
              value={aggregate}
              onValueChange={handleAggregateChange}
              disabled={aggregatesLoading}
            >
              <SelectTrigger className="mt-1 h-9 rounded-md border-input bg-popover text-sm">
                <SelectValue
                  placeholder={
                    aggregatesLoading
                      ? "Loading aggregates..."
                      : "Select aggregate"
                  }
                />
              </SelectTrigger>

              <SelectContent className="border-input bg-popover">
                {aggregateOptions.map((option) => (
                  <SelectItem
                    key={option.id}
                    value={option.name}
                  >
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {aggregateError && (
              <p className="mt-1 text-xs text-destructive">
                {aggregateError}
              </p>
            )}

            {errors.aggregate && (
              <p className="mt-1 text-xs text-destructive">
                {errors.aggregate}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Quantity (m³) *
              </Label>

              <Input
                type="number"
                step="0.01"
                min="0"
                value={quantity}
                onChange={(event) =>
                  setQuantity(event.target.value)
                }
                placeholder="0.00"
                className={`mt-1 h-9 rounded-md border-input bg-popover text-sm ${
                  errors.quantity
                    ? "border-destructive focus:border-destructive"
                    : ""
                }`}
              />

              {errors.quantity && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.quantity}
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Unit Price (ETB/m³) *
              </Label>

              <Input
                type="number"
                step="0.01"
                min="0"
                value={unitPrice}
                onChange={(event) =>
                  setUnitPrice(event.target.value)
                }
                placeholder="0.00"
                className={`mt-1 h-9 rounded-md border-input bg-popover text-sm ${
                  errors.unitPrice
                    ? "border-destructive focus:border-destructive"
                    : ""
                }`}
              />

              {errors.unitPrice && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.unitPrice}
                </p>
              )}
            </div>
          </div>

          {lineTotalExclVat !== null && (
            <div className="rounded-lg border border-border bg-sidebar p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Line total (excl. VAT)
                </span>

                <span className="font-medium tabular-nums text-foreground">
                  {formatCurrency(lineTotalExclVat)}
                </span>
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Royalty Invoice Number *
            </Label>

            <Input
              value={royaltyInvoiceNumber}
              onChange={(event) =>
                setRoyaltyInvoiceNumber(event.target.value)
              }
              placeholder="e.g. RI-2026-001"
              className={`mt-1 h-9 rounded-md border-input bg-popover text-sm ${
                errors.royaltyInvoiceNumber
                  ? "border-destructive focus:border-destructive"
                  : ""
              }`}
            />

            {errors.royaltyInvoiceNumber && (
              <p className="mt-1 text-xs text-destructive">
                {errors.royaltyInvoiceNumber}
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Order Date *
            </Label>

            <div className="mt-1">
              <EthiopianDatePicker
                value={orderDate}
                onChange={setOrderDate}
                placeholder="Select order date"
              />
            </div>

            {errors.orderDate && (
              <p className="mt-1 text-xs text-destructive">
                {errors.orderDate}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-input"
          >
            Cancel
          </Button>

          <Button
            onClick={handleSubmit}
            disabled={busy || aggregatesLoading}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : isEditing ? (
              "Save Changes"
            ) : (
              "Add Order"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
