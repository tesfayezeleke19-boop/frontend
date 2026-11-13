
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileUp, Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BANKS } from "@/services/sales/banks";
import { contractsApi } from "@/services/contracts/api";
import type { FileEvidence } from "@/services/sales/invoice";
import {
  validatePaymentInformation,
  validateWithholdingInformation,
  type ContractFinancialInput,
  type ContractFinancialReport,
  type ContractPaymentInput,
} from "@/services/contracts/financials";
import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";

const inputClass =
  "h-9 border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30";

const selectTriggerClass =
  "h-9 w-full border-input bg-popover text-sm text-foreground";

interface Props {
  contractId: string;
  contractNumber: string;
  report: ContractFinancialReport;
  onClose: () => void;
  onSave: (input: ContractFinancialInput) => Promise<void>;
}

function toDateInput(value?: number): string {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function ContractPaymentDialog({
  contractId,
  contractNumber,
  report,
  onClose,
  onSave,
}: Props) {
  const existing = report.payment;

  const [bank, setBank] = useState(existing?.bank ?? "");
  const [paymentSender, setPaymentSender] = useState(
    existing?.paymentSender ?? "",
  );
  const [paymentAmount, setPaymentAmount] = useState(
    existing ? String(existing.paymentAmount) : "",
  );
  const [paymentDate, setPaymentDate] = useState(
    toDateInput(existing?.paymentDate),
  );
  const [paymentReferenceNumber, setPaymentReferenceNumber] =
    useState(existing?.paymentReferenceNumber ?? "");
  const [remark, setRemark] = useState(existing?.remark ?? "");
  const [paymentEvidence, setPaymentEvidence] =
    useState<FileEvidence | null>(
      existing?.paymentEvidence ?? null,
    );

  const [withholdingEnabled, setWithholdingEnabled] = useState(
    Boolean(report.withholding?.enabled),
  );

  const [withholdingEvidence, setWithholdingEvidence] =
    useState<FileEvidence | null>(
      report.withholding?.evidence ?? null,
    );

  const [uploading, setUploading] = useState<
    "payment" | "withholding" | null
  >(null);

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const hasPaymentInput =
    Boolean(bank.trim()) ||
    Boolean(paymentSender.trim()) ||
    Boolean(paymentReferenceNumber.trim()) ||
    Boolean(paymentAmount.trim()) ||
    Boolean(paymentEvidence);

  const buildPayment = (): ContractPaymentInput => ({
    bank,
    paymentSender,
    paymentAmount: Number(paymentAmount) || 0,
    paymentDate: paymentDate
      ? new Date(`${paymentDate}T12:00:00`).getTime()
      : undefined,
    paymentReferenceNumber,
    paymentEvidence: paymentEvidence ?? undefined,
    remark: remark.trim() || undefined,
  });

  const handleUpload = async (
    file: File | null,
    target: "payment" | "withholding",
  ) => {
    if (!file) return;

    if (uploading || busy) {
      toast.error("Please wait for the current operation to finish");
      return;
    }

    setUploading(target);

    try {
      // Upload through the Contracts API so the attachment is associated
      // with this contract and has the correct attachment_type.
      const evidence = await contractsApi.uploadAttachment(
        contractId,
        file,
        target === "payment" ? "PAYMENT" : "WITHHOLDING",
      );

      if (target === "payment") {
        setPaymentEvidence(evidence);

        setErrors((previous) => {
          const next = { ...previous };
          delete next.paymentEvidence;
          return next;
        });
      } else {
        setWithholdingEvidence(evidence);

        setErrors((previous) => {
          const next = { ...previous };
          delete next.withholdingEvidence;
          return next;
        });
      }

      toast.success(`${file.name} uploaded`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Evidence upload failed",
      );
    } finally {
      setUploading(null);
    }
  };

  const handleSave = async () => {
    if (uploading) {
      toast.error("Please wait for the evidence upload to finish");
      return;
    }

    const next: Record<string, string> = {};

    if (hasPaymentInput) {
      const validation =
        validatePaymentInformation(buildPayment());

      if (!validation.valid) {
        Object.assign(next, validation.errors);
      }
    }

    const withholdingValidation =
      validateWithholdingInformation({
        enabled: withholdingEnabled,
        evidence: withholdingEvidence ?? undefined,
      });

    if (!withholdingValidation.valid) {
      Object.assign(next, withholdingValidation.errors);
    }

    setErrors(next);

    if (Object.keys(next).length > 0) return;

    setBusy(true);

    try {
      await onSave({
        payment: hasPaymentInput ? buildPayment() : undefined,
        withholding: {
          enabled: withholdingEnabled,
          evidence: withholdingEnabled
            ? withholdingEvidence ?? undefined
            : undefined,
        },
      });

      toast.success("Contract payment information saved");
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Payment information could not be saved",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleClearPayment = async () => {
    if (uploading) {
      toast.error("Please wait for the evidence upload to finish");
      return;
    }

    const confirmed = window.confirm(
      "Remove the recorded payment information from this contract? The audit history keeps a record of the removal.",
    );

    if (!confirmed) return;

    setBusy(true);

    try {
      await onSave({
        payment: null,
        withholding: {
          enabled: withholdingEnabled,
          evidence: withholdingEnabled
            ? withholdingEvidence ?? undefined
            : undefined,
        },
      });

      toast.success("Recorded payment information removed");
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Payment information could not be removed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto border-input bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            Payment Information
          </DialogTitle>

          <DialogDescription className="text-sm text-muted-foreground">
            {contractNumber} · optional at creation and after completion.
            Recorded details never mark the contract as paid — confirmed
            payment comes from the Sales Invoice.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Bank
              </Label>

              <Select value={bank} onValueChange={setBank}>
                <SelectTrigger
                  className={`${selectTriggerClass} mt-1 ${
                    errors.bank ? "border-destructive" : ""
                  }`}
                >
                  <SelectValue placeholder="Select bank" />
                </SelectTrigger>

                <SelectContent className="border-input bg-popover">
                  {BANKS.map((option) => (
                    <SelectItem
                      key={option}
                      value={option}
                      className="text-sm text-foreground focus:bg-accent"
                    >
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {errors.bank && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.bank}
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Payment Sent By
              </Label>

              <Input
                value={paymentSender}
                onChange={(event) =>
                  setPaymentSender(event.target.value)
                }
                placeholder="e.g. Abebe Kebede"
                className={`${inputClass} mt-1 ${
                  errors.paymentSender ? "border-destructive" : ""
                }`}
              />

              {errors.paymentSender && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.paymentSender}
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Reported Payment Amount (ETB)
              </Label>

              <Input
                type="number"
                min="0"
                step="0.01"
                value={paymentAmount}
                onChange={(event) =>
                  setPaymentAmount(event.target.value)
                }
                placeholder="0"
                className={`${inputClass} mt-1 ${
                  errors.paymentAmount ? "border-destructive" : ""
                }`}
              />

              {errors.paymentAmount ? (
                <p className="mt-1 text-xs text-destructive">
                  {errors.paymentAmount}
                </p>
              ) : (
                <p className="mt-1 text-[10px] text-muted-foreground/70">
                  Informational only — this is not a confirmed payment.
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Payment Date
              </Label>

              <div className="mt-1">
                <EthiopianDatePicker
                  value={paymentDate}
                  onChange={setPaymentDate}
                  placeholder="Select payment date"
                />
              </div>

              {errors.paymentDate && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.paymentDate}
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Transaction / Reference Number
              </Label>

              <Input
                value={paymentReferenceNumber}
                onChange={(event) =>
                  setPaymentReferenceNumber(event.target.value)
                }
                placeholder="e.g. TXN-12345"
                className={`${inputClass} mt-1 font-mono text-xs ${
                  errors.paymentReferenceNumber
                    ? "border-destructive"
                    : ""
                }`}
              />

              {errors.paymentReferenceNumber && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.paymentReferenceNumber}
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Remark
              </Label>

              <Textarea
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
                rows={2}
                placeholder="Any payment notes…"
                className="mt-1 resize-none border-input bg-popover text-sm text-foreground"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-sidebar p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">
                Payment Evidence
              </Label>

              {paymentEvidence && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || uploading !== null}
                  onClick={() => setPaymentEvidence(null)}
                  className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                  Remove
                </Button>
              )}
            </div>

            {paymentEvidence ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-success">
                <Paperclip className="size-3.5" />
                <span className="truncate font-medium">
                  {paymentEvidence.fileName}
                </span>
              </div>
            ) : (
              <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input p-3 text-xs text-muted-foreground transition-colors hover:border-success/40 hover:text-foreground">
                <FileUp className="size-4" />

                {uploading === "payment"
                  ? "Uploading payment evidence…"
                  : "Upload payment confirmation (optional)"}

                <input
                  type="file"
                  accept="image/*,.pdf"
                  disabled={busy || uploading !== null}
                  className="hidden"
                  onChange={(event) => {
                    void handleUpload(
                      event.target.files?.[0] ?? null,
                      "payment",
                    );
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            )}
          </div>

          <Separator className="bg-muted" />

          <div className="rounded-lg border border-border bg-sidebar p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Withholding (3%)
                </div>

                <div className="font-mono text-[10px] text-muted-foreground/70">
                  Applied to the VAT-inclusive total on the resulting invoice.
                  Not a payment, not fulfillment.
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {withholdingEnabled ? "ON" : "OFF"}
                </span>

                <Switch
                  checked={withholdingEnabled}
                  disabled={busy || uploading !== null}
                  onCheckedChange={(checked) => {
                    setWithholdingEnabled(checked);

                    if (!checked) {
                      setErrors((previous) => {
                        const next = { ...previous };
                        delete next.withholdingEvidence;
                        return next;
                      });
                    }
                  }}
                  className="data-[state=checked]:bg-success"
                />
              </div>
            </div>

            {withholdingEnabled && (
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Withholding Evidence
                  </Label>

                  {withholdingEvidence && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || uploading !== null}
                      onClick={() =>
                        setWithholdingEvidence(null)
                      }
                      className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                      Remove
                    </Button>
                  )}
                </div>

                {withholdingEvidence ? (
                  <div className="mt-2 flex items-center gap-2 text-xs text-success">
                    <Paperclip className="size-3.5" />
                    <span className="truncate font-medium">
                      {withholdingEvidence.fileName}
                    </span>
                  </div>
                ) : (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input p-3 text-xs text-muted-foreground transition-colors hover:border-success/40 hover:text-foreground">
                    <FileUp className="size-4" />

                    {uploading === "withholding"
                      ? "Uploading withholding evidence…"
                      : "Upload withholding evidence (required when ON)"}

                    <input
                      type="file"
                      accept="image/*,.pdf"
                      disabled={busy || uploading !== null}
                      className="hidden"
                      onChange={(event) => {
                        void handleUpload(
                          event.target.files?.[0] ?? null,
                          "withholding",
                        );
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                )}

                {errors.withholdingEvidence && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.withholdingEvidence}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div>
            {existing && (
              <Button
                variant="ghost"
                onClick={() => void handleClearPayment()}
                disabled={busy || uploading !== null}
                className="text-xs text-destructive hover:text-destructive"
              >
                Remove payment information
              </Button>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={busy || uploading !== null}
              className="border-input text-foreground hover:bg-accent"
            >
              Cancel
            </Button>

            <Button
              onClick={() => void handleSave()}
              disabled={busy || uploading !== null}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
