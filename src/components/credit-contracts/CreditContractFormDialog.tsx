import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  CreditContract,
  CREDIT_CONTRACT_STATUS,
  type CreditContractInput,
} from "@/services/creditContracts/types";
import { creditContractsRepository } from "@/services/creditContracts/repository";
import { Loader2 } from "lucide-react";
import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  initialContract?: CreditContract | null;
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

export function CreditContractFormDialog({
  open,
  onOpenChange,
  onSaved,
  initialContract,
}: Props) {
  const isEditing = !!(
    initialContract &&
    initialContract.status === CREDIT_CONTRACT_STATUS.DRAFT
  );

  const [customerName, setCustomerName] = useState("");
  const [tin, setTin] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [fsNo, setFsNo] = useState("");

  const [contractDate, setContractDate] = useState(
    initialContract
      ? toLocalDateInput(initialContract.contractDate)
      : "",
  );

  const [remark, setRemark] = useState(
    initialContract?.remark ?? "",
  );

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const formKey = `${open ? "open" : "closed"}:${
    initialContract?.id ?? "new"
  }:${initialContract?.updatedAt ?? 0}`;

  const [seededKey, setSeededKey] = useState(formKey);

  if (seededKey !== formKey) {
    setSeededKey(formKey);
    setCustomerName(initialContract?.customer.name ?? "");
    setTin(initialContract?.customer.tin ?? "");
    setContractValue(
      initialContract
        ? String(initialContract.contractValue)
        : "",
    );
    setFsNo(initialContract?.fsNo ?? "");
    setRemark(initialContract?.remark ?? "");
    setContractDate(
      initialContract
        ? toLocalDateInput(initialContract.contractDate)
        : "",
    );
    setErrors({});
  }

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (!customerName.trim()) {
      next.customerName = "Customer / Company Name is required";
    }

    if (!tin.trim()) {
      next.tin = "Customer TIN Number is required";
    }

    if (
      !contractValue ||
      !Number.isFinite(Number(contractValue)) ||
      Number(contractValue) <= 0
    ) {
      next.contractValue =
        "Enter a contract value greater than zero";
    }

    if (!contractDate) {
      next.contractDate = "A valid contract date is required";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setBusy(true);

    try {
      const input: CreditContractInput = {
        customerName: customerName.trim(),
        tin: tin.trim(),
        contractValue: Number(contractValue),
        fsNo: fsNo.trim() || undefined,
        contractDate: new Date(
          `${contractDate}T12:00:00`,
        ).getTime(),
        remark: remark.trim() || undefined,
      };

      if (isEditing && initialContract) {
        await creditContractsRepository.updateContract(
          initialContract.id,
          input,
        );
      } else {
        await creditContractsRepository.createContract(input);
      }

      onSaved();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-input bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-semibold text-foreground">
            {isEditing
              ? "Edit Credit Contract"
              : "New Credit Contract"}
          </DialogTitle>

          <DialogDescription className="text-sm text-muted-foreground">
            
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 pt-2">
          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Customer / Company Name *
            </Label>

            <Input
              value={customerName}
              onChange={(event) =>
                setCustomerName(event.target.value)
              }
              placeholder="e.g. Combolcha Cement PLC"
              className={`mt-1 h-9 rounded-md border-input bg-popover text-sm ${
                errors.customerName
                  ? "border-destructive focus:border-destructive"
                  : ""
              }`}
            />

            {errors.customerName && (
              <p className="mt-1 text-xs text-destructive">
                {errors.customerName}
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Customer TIN Number *
            </Label>

            <Input
              value={tin}
              onChange={(event) => setTin(event.target.value)}
              placeholder="e.g. 0012345678"
              className={`mt-1 h-9 rounded-md border-input bg-popover text-sm ${
                errors.tin
                  ? "border-destructive focus:border-destructive"
                  : ""
              }`}
            />

            {errors.tin && (
              <p className="mt-1 text-xs text-destructive">
                {errors.tin}
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Contract Value (ETB) *
            </Label>

            <Input
              value={contractValue}
              onChange={(event) =>
                setContractValue(event.target.value)
              }
              placeholder="e.g. 5000000"
              className={`mt-1 h-9 rounded-md border-input bg-popover text-sm ${
                errors.contractValue
                  ? "border-destructive focus:border-destructive"
                  : ""
              }`}
            />

            {errors.contractValue && (
              <p className="mt-1 text-xs text-destructive">
                {errors.contractValue}
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              FS No — optional
            </Label>

            <Input
              value={fsNo}
              onChange={(event) => setFsNo(event.target.value)}
              placeholder="Leave empty if not yet assigned"
              className="mt-1 h-9 rounded-md border-input bg-popover text-sm"
            />

            <p className="mt-1 text-xs text-muted-foreground">
              Required only when finalizing the contract.
            </p>
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Contract Date *
            </Label>

            <div className="mt-1">
              <EthiopianDatePicker
                value={contractDate}
                onChange={setContractDate}
                placeholder="Select contract date"
              />
            </div>

            {errors.contractDate && (
              <p className="mt-1 text-xs text-destructive">
                {errors.contractDate}
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Remark (optional)
            </Label>

            <Textarea
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              placeholder="Any additional notes…"
              rows={3}
              className="mt-1 resize-y rounded-md border-input bg-popover text-sm"
            />
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
            disabled={busy}
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
              "Create Contract"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}