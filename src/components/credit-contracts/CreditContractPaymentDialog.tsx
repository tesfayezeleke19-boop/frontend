
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
import { Switch } from "@/components/ui/switch";
import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";

import { Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { formatCurrency } from "@/services/sales/format";

export interface CreditContractCompletionInput {
  fsNo: string;
  creditAmount: number;
  paymentAmount: number;
  bank: string;
  paymentSender: string;
  paymentDate: string;
  paymentReferenceNumber: string;
  remark: string;
  paymentEvidence: File | null;
  withholdingEnabled: boolean;
  withholdingEvidence: File | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractNumber: string;
  customerName: string;
  creditAmount: number;
  onComplete: (input: CreditContractCompletionInput) => Promise<void>;
}

export function CreditContractPaymentDialog({
  open,
  onOpenChange,
  contractNumber,
  customerName,
  creditAmount,
  onComplete,
}: Props) {
  const [fsNo, setFsNo] = useState("");
  const [paymentAmount, setPaymentAmount] = useState(
    String(creditAmount),
  );
  const [bank, setBank] = useState("");
  const [paymentSender, setPaymentSender] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentReferenceNumber, setPaymentReferenceNumber] =
    useState("");
  const [remark, setRemark] = useState("");

  const [paymentEvidence, setPaymentEvidence] =
    useState<File | null>(null);

  const [withholdingEnabled, setWithholdingEnabled] =
    useState(false);

  const [withholdingEvidence, setWithholdingEvidence] =
    useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const parsedAmount = Number(paymentAmount);

  const resetForm = () => {
    setFsNo("");
    setPaymentAmount(String(creditAmount));
    setBank("");
    setPaymentSender("");
    setPaymentDate("");
    setPaymentReferenceNumber("");
    setRemark("");
    setPaymentEvidence(null);
    setWithholdingEnabled(false);
    setWithholdingEvidence(null);
    setErrors({});
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !busy) {
      resetForm();
      onOpenChange(false);
    }
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};

    if (!fsNo.trim()) {
      nextErrors.fsNo = "FS No is required";
    }

    if (
      !Number.isFinite(parsedAmount) ||
      parsedAmount < creditAmount
    ) {
      nextErrors.paymentAmount =
        `Payment amount cannot be less than ${formatCurrency(creditAmount)}`;
    }

    if (!bank.trim()) {
      nextErrors.bank = "Bank is required";
    }

    if (!paymentSender.trim()) {
      nextErrors.paymentSender = "Payment sender is required";
    }

    if (!paymentDate) {
      nextErrors.paymentDate = "Payment date is required";
    }

    if (!paymentReferenceNumber.trim()) {
      nextErrors.paymentReferenceNumber =
        "Payment reference number is required";
    }

    if (withholdingEnabled && !withholdingEvidence) {
      nextErrors.withholdingEvidence =
        "Withholding evidence is required";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setBusy(true);

    try {
      await onComplete({
        fsNo: fsNo.trim(),
        creditAmount,
        paymentAmount: parsedAmount,
        bank: bank.trim(),
        paymentSender: paymentSender.trim(),
        paymentDate,
        paymentReferenceNumber: paymentReferenceNumber.trim(),
        remark: remark.trim(),
        paymentEvidence,
        withholdingEnabled,
        withholdingEvidence: withholdingEnabled
          ? withholdingEvidence
          : null,
      });

      toast.success("Credit contract completed successfully");
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not complete the credit contract",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Wallet className="size-5" />
            Complete Credit Contract
          </DialogTitle>

          <DialogDescription className="text-muted-foreground">
            {contractNumber} · {customerName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <div className="text-xs text-muted-foreground">
              Contract Credit Amount
            </div>

            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {formatCurrency(creditAmount)}
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              The payment amount is initially set to the contract
              credit amount. You may increase it, but you cannot
              enter a lower amount.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>FS No *</Label>
              <Input
                value={fsNo}
                onChange={(e) => setFsNo(e.target.value)}
                placeholder="Enter FS number"
                className="border-input bg-background"
              />
              {errors.fsNo && (
                <p className="text-xs text-destructive">
                  {errors.fsNo}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Payment Amount *</Label>
              <Input
                type="number"
                min={creditAmount}
                step="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="border-input bg-background"
              />
              {errors.paymentAmount && (
                <p className="text-xs text-destructive">
                  {errors.paymentAmount}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Bank *</Label>
              <Input
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                placeholder="Bank name"
                className="border-input bg-background"
              />
              {errors.bank && (
                <p className="text-xs text-destructive">
                  {errors.bank}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Payment Sent By *</Label>
              <Input
                value={paymentSender}
                onChange={(e) => setPaymentSender(e.target.value)}
                placeholder="Sender name"
                className="border-input bg-background"
              />
              {errors.paymentSender && (
                <p className="text-xs text-destructive">
                  {errors.paymentSender}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Payment Date *</Label>
              <EthiopianDatePicker
                value={paymentDate}
                onChange={setPaymentDate}
                placeholder="Select payment date"
              />
              {errors.paymentDate && (
                <p className="text-xs text-destructive">
                  {errors.paymentDate}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Payment Reference Number *</Label>
              <Input
                value={paymentReferenceNumber}
                onChange={(e) =>
                  setPaymentReferenceNumber(e.target.value)
                }
                placeholder="Transaction/reference number"
                className="border-input bg-background"
              />
              {errors.paymentReferenceNumber && (
                <p className="text-xs text-destructive">
                  {errors.paymentReferenceNumber}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Payment Evidence</Label>
            <Input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) =>
                setPaymentEvidence(e.target.files?.[0] ?? null)
              }
              className="border-input bg-background"
            />
            {paymentEvidence && (
              <p className="text-xs text-muted-foreground">
                Selected: {paymentEvidence.name}
              </p>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-sm font-medium">
                  Apply Withholding (3%)
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Enable withholding for this credit contract.
                </p>
              </div>

              <Switch
                checked={withholdingEnabled}
                onCheckedChange={(checked) => {
                  setWithholdingEnabled(checked);
                  if (!checked) setWithholdingEvidence(null);
                }}
              />
            </div>

            {withholdingEnabled && (
              <div className="space-y-2">
                <Label>Withholding Evidence *</Label>
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) =>
                    setWithholdingEvidence(
                      e.target.files?.[0] ?? null,
                    )
                  }
                  className="border-input bg-background"
                />

                {withholdingEvidence && (
                  <p className="text-xs text-muted-foreground">
                    Selected: {withholdingEvidence.name}
                  </p>
                )}

                {errors.withholdingEvidence && (
                  <p className="text-xs text-destructive">
                    {errors.withholdingEvidence}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Remark</Label>
            <Textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Additional payment information..."
              rows={3}
              className="border-input bg-background"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            className="gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Completing...
              </>
            ) : (
              "Complete Credit"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
