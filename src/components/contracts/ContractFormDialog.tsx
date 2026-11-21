/**
 * Contract form dialog (Finance) — create or edit a contract header.
 *
 * All contract attachments are handled by the Contracts module.
 * Original files are retained as browser blob URLs until the repository
 * converts them to Files and sends them to the Contracts API.
 *
 * Payment evidence is mandatory at creation.
 * Withholding evidence is mandatory when withholding is enabled.
 */

import { useRef, useState } from "react";

import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";
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
  FileUp,
  Info,
  Loader2,
  Paperclip,
  ReceiptText,
  Trash2,
} from "lucide-react";

import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

import { contractsRepository } from "@/services/contracts";

import {
  CONTRACT_ATTACHMENT_ACCEPT,
  validateContractAttachment,
  validateContractInput,
  type Contract,
  type ContractAttachment,
} from "@/services/contracts/types";

import {
  WITHHOLDING_RATE_LABEL,
  formatPaymentDateInput,
  parsePaymentDateInput,
  validatePaymentInformation,
  validateWithholdingInformation,
  type ContractPaymentInput,
} from "@/services/contracts/financials";

import { calculateSalesInvoiceTotals } from "@/services/sales/invoice";
import { VAT_DIVISOR } from "@/services/sales/calc";
import { AttachmentViewer } from "./AttachmentViewer";
import { formatCurrency } from "@/services/sales/format";

const inputClass =
  "h-9 border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30";

function dateInputValue(ts?: number): string {
  const date = new Date(ts && Number.isFinite(ts) ? ts : Date.now());

  const pad = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

interface FormState {
  customerName: string;
  tin: string;
  contractValue: string;
  fsNo: string;
  contractDate: string;
  remark: string;

  bank: string;
  paymentSender: string;
  paymentAmount: string;
  paymentDate: string;
  paymentReferenceNumber: string;
  paymentRemark: string;
}

const EMPTY_FORM: FormState = {
  customerName: "",
  tin: "",
  contractValue: "",
  fsNo: "",
  contractDate: dateInputValue(),
  remark: "",

  bank: "",
  paymentSender: "",
  paymentAmount: "",
  paymentDate: "",
  paymentReferenceNumber: "",
  paymentRemark: "",
};

function formFromContract(contract: Contract): FormState {
  const payment = contract.payment;

  return {
    customerName: contract.customer.name,
    tin: contract.customer.tin,
    contractValue: String(contract.contractValue),
    fsNo: contract.fsNo,
    contractDate: dateInputValue(contract.contractDate),
    remark: contract.remark ?? "",

    bank: payment?.bank ?? "",
    paymentSender: payment?.paymentSender ?? "",
    paymentAmount: payment ? String(payment.paymentAmount) : "",
    paymentDate: formatPaymentDateInput(payment?.paymentDate),
    paymentReferenceNumber: payment?.paymentReferenceNumber ?? "",
    paymentRemark: payment?.remark ?? "",
  };
}

interface ContractFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract?: Contract | null;
  onSaved: (contract: Contract) => void;
}

function createEvidence(file: File): ContractAttachment {
  return {
    id: `contract-file-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    fileName: file.name,
    // Keep the original file accessible to repository.evidenceToFile().
    // This works for PDFs as well as images.
    fileUrl: URL.createObjectURL(file),
    mimeType: file.type || "application/octet-stream",
    fileSize: file.size,
  };
}

function revokeBlobUrl(evidence?: ContractAttachment | null) {
  const url = evidence?.fileUrl;

  if (url && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

export function ContractFormDialog({
  open,
  onOpenChange,
  contract,
  onSaved,
}: ContractFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ContractFormBody
          contract={contract ?? null}
          onCancel={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function ContractFormBody({
  contract,
  onCancel,
  onSaved,
}: {
  contract: Contract | null;
  onCancel: () => void;
  onSaved: (contract: Contract) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    contract ? formFromContract(contract) : EMPTY_FORM,
  );

  const [attachments, setAttachments] = useState<ContractAttachment[]>(
    () => contract?.attachments ?? [],
  );

  const [paymentEvidence, setPaymentEvidence] =
    useState<ContractAttachment | null>(
      () => contract?.payment?.paymentEvidence ?? null,
    );

  const [withholdingEnabled, setWithholdingEnabled] = useState(
    () => contract?.withholding?.enabled ?? false,
  );

  const [withholdingEvidence, setWithholdingEvidence] =
    useState<ContractAttachment | null>(
      () => contract?.withholding?.evidence ?? null,
    );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [viewingEvidence, setViewingEvidence] =
    useState<ContractAttachment | null>(null);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * An activated contract is restricted to contract-value editing.
   */
  const isActivatedContract =
    Boolean(contract) && contract?.status !== "DRAFT";

  const update = (field: keyof FormState, value: string) => {
    setForm((prev) => {
      const next = {
        ...prev,
        [field]: value,
      };

      if (field === "contractValue" && !prev.paymentAmount.trim()) {
        next.paymentAmount = "";
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

  /**
   * Paper contract files are retained as blob URLs.
   * The Contracts repository converts these URLs into actual Files.
   */
  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const next: ContractAttachment[] = [];
    let firstError: string | null = null;

    for (const file of Array.from(files)) {
      const validation = validateContractAttachment(file);

      if (!validation.valid) {
        firstError =
          `${file.name}: ${Object.values(validation.errors)[0]}`;
        continue;
      }

      next.push(createEvidence(file));
    }

    if (next.length > 0) {
      setAttachmentError(null);
      setAttachments((prev) => [...prev, ...next]);
    }

    if (firstError) {
      setAttachmentError(firstError);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  /**
   * Payment and withholding evidence are NOT uploaded through Sales.
   * They remain available as local blob URLs until the Contracts
   * repository sends them with the contract creation request.
   */
  const handleEvidence = (
    file: File | null,
    target: "payment" | "withholding",
  ) => {
    if (!file) return;

    const validation = validateContractAttachment(file);

    if (!validation.valid) {
      const message =
        `${file.name}: ${Object.values(validation.errors)[0]}`;

      setErrors((prev) => ({
        ...prev,
        [target === "payment"
          ? "paymentEvidence"
          : "withholdingEvidence"]: message,
      }));

      return;
    }

    const evidence = createEvidence(file);

    if (target === "payment") {
      setPaymentEvidence((previous) => {
        revokeBlobUrl(previous);
        return evidence;
      });

      setErrors((prev) => {
        const next = { ...prev };
        delete next.paymentEvidence;
        return next;
      });
    } else {
      setWithholdingEvidence((previous) => {
        revokeBlobUrl(previous);
        return evidence;
      });

      setErrors((prev) => {
        const next = { ...prev };
        delete next.withholdingEvidence;
        return next;
      });
    }

    toast.success(`${file.name} attached`);
  };

  const contractValue = parseFloat(form.contractValue) || 0;

  const projection = calculateSalesInvoiceTotals({
    orders: [
      {
        quantity: 1,
        unitPrice: contractValue / VAT_DIVISOR,
      },
    ],
    withholdingEnabled,
  });

  const effectivePaymentAmount =
    form.paymentAmount.trim() === ""
      ? contractValue
      : parseFloat(form.paymentAmount) || 0;

  const payment: ContractPaymentInput = {
    bank: form.bank,
    paymentSender: form.paymentSender,
    paymentAmount: effectivePaymentAmount,
    paymentDate: parsePaymentDateInput(form.paymentDate),
    paymentReferenceNumber: form.paymentReferenceNumber,
    paymentEvidence,
    remark: form.paymentRemark,
  };

  const handleSubmit = async () => {
    const parsed = {
      customerName: form.customerName,
      tin: form.tin,
      contractValue,
      fsNo: form.fsNo,
      contractDate: new Date(
        `${form.contractDate}T00:00:00`,
      ).getTime(),
      attachments,
      remark: form.remark,
      payment,
      withholding: {
        enabled: withholdingEnabled,
        evidence: withholdingEvidence,
      },
    };

    const validation = validateContractInput({
      ...parsed,
      contractDate: Number.isNaN(parsed.contractDate)
        ? 0
        : parsed.contractDate,
    });

    const paymentValidation = validatePaymentInformation(payment);

    const withholdingValidation = validateWithholdingInformation({
      enabled: withholdingEnabled,
      evidence: withholdingEvidence,
    });

    const nextErrors: Record<string, string> = {
      ...validation.errors,
      ...paymentValidation.errors,
      ...withholdingValidation.errors,
    };

    // Payment evidence is mandatory for contract creation.
    if (!paymentEvidence) {
      nextErrors.paymentEvidence =
        "Payment evidence attachment is mandatory.";
    }

    if (effectivePaymentAmount < contractValue) {
      nextErrors.paymentAmount =
        "Reported amount cannot be less than the contract value.";
    }

    if (effectivePaymentAmount <= 0) {
      nextErrors.paymentAmount =
        "Reported amount must be greater than zero.";
    }

    // Withholding evidence is mandatory whenever withholding is enabled.
    if (withholdingEnabled && !withholdingEvidence) {
      nextErrors.withholdingEvidence =
        "Withholding evidence attachment is required when withholding is enabled.";
    }

    if (isActivatedContract && contract) {
      const originalFieldsChanged =
        form.customerName.trim() !== contract.customer.name ||
        form.tin.trim() !== contract.customer.tin ||
        form.fsNo.trim() !== contract.fsNo ||
        parsed.contractDate !== contract.contractDate ||
        form.remark !== (contract.remark ?? "");

      if (originalFieldsChanged) {
        nextErrors.contractValue =
          "Only the contract value can be changed after activation.";
      }
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);

    try {
      const saved = contract
        ? await contractsRepository.updateContract(contract.id, parsed)
        : await contractsRepository.createContract(parsed);

      toast.success(
        contract
          ? `${saved.contractNumber} updated`
          : `${saved.contractNumber} created — activate it to make it available to Sales`,
      );

      onSaved(saved);
      onCancel();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Contract could not be saved",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-input bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {contract
              ? `Edit ${contract.contractNumber}`
              : "New Contract"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {isActivatedContract && (
            <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-info" />
              <p>
                This contract is already activated. You can update its
                contract value, but the original customer, TIN, FS number,
                contract date, attachments, and payment information are
                protected.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-muted-foreground">
                Customer / Company Name *
              </Label>
              <Input
                value={form.customerName}
                onChange={(e) => update("customerName", e.target.value)}
                disabled={isActivatedContract}
                className={`${inputClass} mt-1`}
              />
              {errors.customerName && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.customerName}
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">
                Customer TIN *
              </Label>
              <Input
                value={form.tin}
                onChange={(e) => update("tin", e.target.value)}
                disabled={isActivatedContract}
                className={`${inputClass} mt-1`}
              />
              {errors.tin && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.tin}
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">
                Contract Value (ETB, VAT-inclusive) *
              </Label>
              <Input
                inputMode="decimal"
                value={form.contractValue}
                onChange={(e) => update("contractValue", e.target.value)}
                placeholder="e.g. 10000000"
                className={`${inputClass} mt-1`}
              />
              {errors.contractValue && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.contractValue}
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">
                FS No (one per contract) *
              </Label>
              <Input
                value={form.fsNo}
                onChange={(e) => update("fsNo", e.target.value)}
                disabled={isActivatedContract}
                placeholder="e.g. 2704301"
                className={`${inputClass} mt-1`}
              />
              {errors.fsNo && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.fsNo}
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">
                Contract Date *
              </Label>

              {isActivatedContract ? (
                <Input
                  value={form.contractDate}
                  disabled
                  className={`${inputClass} mt-1`}
                />
              ) : (
                <EthiopianDatePicker
                  value={form.contractDate}
                  onChange={(value) => update("contractDate", value)}
                  className="mt-1"
                />
              )}

              {errors.contractDate && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.contractDate}
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">
                Remarks
              </Label>
              <Input
                value={form.remark}
                onChange={(e) => update("remark", e.target.value)}
                disabled={isActivatedContract}
                className={`${inputClass} mt-1`}
              />
            </div>
          </div>

          {/* Paper contract attachments */}
          <div className="rounded-lg border border-border bg-sidebar p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-foreground">
                  Paper Contract Attachment
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                  PDF, JPG, or PNG — one or more files. Optional at creation.
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isActivatedContract}
                onClick={() => fileInputRef.current?.click()}
                className="gap-2 border-input text-foreground hover:bg-accent"
              >
                <FileUp className="size-3.5" />
                Attach files
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={CONTRACT_ATTACHMENT_ACCEPT}
                className="hidden"
                disabled={isActivatedContract}
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>

            {attachmentError && (
              <p className="mt-2 text-xs text-destructive">
                {attachmentError}
              </p>
            )}

            {attachments.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className="flex items-center gap-3 rounded-md border border-border bg-card p-2"
                  >
                    {attachment.mimeType?.startsWith("image/") &&
                    attachment.fileUrl ? (
                      <img
                        src={attachment.fileUrl}
                        alt={attachment.fileName}
                        className="size-10 rounded border border-input object-cover"
                      />
                    ) : (
                      <span className="flex size-10 items-center justify-center rounded border border-input bg-popover">
                        <Paperclip className="size-4 text-muted-foreground" />
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">
                        {attachment.fileName}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground/70">
                        {attachment.mimeType || "unknown"} ·{" "}
                        {Math.max(
                          1,
                          Math.round(attachment.fileSize / 1024),
                        )}{" "}
                        KB
                      </div>
                    </div>

                    {attachment.fileUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewingEvidence(attachment)}
                        className="h-7 gap-1 text-xs text-info"
                      >
                        Open
                      </Button>
                    )}

                    {!isActivatedContract && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          revokeBlobUrl(attachment);
                          setAttachments((prev) =>
                            prev.filter((item) => item.id !== attachment.id),
                          );
                        }}
                        className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3" />
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[11px] text-muted-foreground/70">
                No paper contract attached yet.
              </p>
            )}

           
          </div>

          {/* Mandatory Payment Information */}
          <div className="rounded-lg border border-border bg-sidebar p-3">
            <div className="flex items-start gap-2">
              <ReceiptText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <div className="text-xs font-medium text-foreground">
                  Payment Information *
                </div>
                
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-muted-foreground">
                  Bank *
                </Label>
                <Input
                  value={form.bank}
                  onChange={(e) => update("bank", e.target.value)}
                  disabled={isActivatedContract}
                  placeholder="e.g. CBE"
                  className={`${inputClass} mt-1`}
                />
                {errors.bank && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.bank}
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">
                  Payment Sent By *
                </Label>
                <Input
                  value={form.paymentSender}
                  onChange={(e) => update("paymentSender", e.target.value)}
                  disabled={isActivatedContract}
                  placeholder="Sender name"
                  className={`${inputClass} mt-1`}
                />
                {errors.paymentSender && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.paymentSender}
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">
                  Reported Amount (ETB) *
                </Label>
                <Input
                  inputMode="decimal"
                  value={
                    form.paymentAmount === ""
                      ? form.contractValue
                      : form.paymentAmount
                  }
                  onChange={(e) => update("paymentAmount", e.target.value)}
                  disabled={isActivatedContract}
                  placeholder="Defaults to contract value"
                  className={`${inputClass} mt-1`}
                />
                {errors.paymentAmount && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.paymentAmount}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-muted-foreground/70">
                  Minimum: {formatCurrency(contractValue)}
                </p>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">
                  Payment Date *
                </Label>
                <EthiopianDatePicker
                  value={form.paymentDate}
                  onChange={(value) => update("paymentDate", value)}
                  className="mt-1"
                />
                {errors.paymentDate && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.paymentDate}
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">
                  Reference Number *
                </Label>
                <Input
                  value={form.paymentReferenceNumber}
                  onChange={(e) =>
                    update("paymentReferenceNumber", e.target.value)
                  }
                  disabled={isActivatedContract}
                  placeholder="Transaction reference"
                  className={`${inputClass} mt-1 font-mono text-xs`}
                />
                {errors.paymentReferenceNumber && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.paymentReferenceNumber}
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">
                  Payment Remark
                </Label>
                <Input
                  value={form.paymentRemark}
                  onChange={(e) => update("paymentRemark", e.target.value)}
                  disabled={isActivatedContract}
                  className={`${inputClass} mt-1`}
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <label
                className={`inline-flex items-center gap-2 rounded-md border border-dashed border-input px-3 py-2 text-muted-foreground transition-colors ${
                  isActivatedContract
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer hover:border-success/40 hover:text-foreground"
                }`}
              >
                <FileUp className="size-3.5" />
                {paymentEvidence
                  ? "Replace payment evidence"
                  : "Attach payment evidence (required)"}

                <input
                  type="file"
                  accept={CONTRACT_ATTACHMENT_ACCEPT}
                  className="hidden"
                  disabled={isActivatedContract}
                  onChange={(e) => {
                    handleEvidence(
                      e.target.files?.[0] ?? null,
                      "payment",
                    );
                    e.currentTarget.value = "";
                  }}
                />
              </label>

              {paymentEvidence && (
                <>
                  <Paperclip className="size-3.5 text-muted-foreground" />
                  <span className="truncate font-medium text-foreground">
                    {paymentEvidence.fileName}
                  </span>

                  {paymentEvidence.fileUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewingEvidence(paymentEvidence)}
                      className="h-6 gap-1 text-xs text-info"
                    >
                      Open
                    </Button>
                  )}

                  {!isActivatedContract && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        revokeBlobUrl(paymentEvidence);
                        setPaymentEvidence(null);
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.paymentEvidence;
                          return next;
                        });
                      }}
                      className="h-6 gap-1 text-xs text-destructive"
                    >
                      <Trash2 className="size-3" />
                      Remove
                    </Button>
                  )}
                </>
              )}
            </div>

            {errors.paymentEvidence && (
              <p className="mt-1 text-xs text-destructive">
                {errors.paymentEvidence}
              </p>
            )}
          </div>

          {/* Finance Summary */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-foreground">
                  Finance Summary (projection)
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Withholding {WITHHOLDING_RATE_LABEL}
                </span>
                <Switch
                  checked={withholdingEnabled}
                  disabled={isActivatedContract}
                  onCheckedChange={(checked) => {
                    setWithholdingEnabled(checked);

                    if (!checked) {
                      revokeBlobUrl(withholdingEvidence);
                      setWithholdingEvidence(null);

                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.withholdingEvidence;
                        return next;
                      });
                    }
                  }}
                  className="data-[state=checked]:bg-success"
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Subtotal (excl. VAT)
                </div>
                <div className="mt-1 text-sm font-medium tabular-nums text-foreground">
                  {formatCurrency(projection.subtotalExclVat)}
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  VAT (15%)
                </div>
                <div className="mt-1 text-sm font-medium tabular-nums text-foreground">
                  {formatCurrency(projection.totalVat)}
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Total (incl. VAT)
                </div>
                <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  {formatCurrency(projection.totalPriceInclVat)}
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Withholding
                </div>
                <div className="mt-1 text-sm font-medium tabular-nums text-foreground">
                  {withholdingEnabled
                    ? `${formatCurrency(
                        projection.withholdingAmount,
                      )} (${Math.round(
                        projection.withholdingRate * 100,
                      )}%)`
                    : "Not applied"}
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Net After Withholding
                </div>
                <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  {formatCurrency(
                    projection.netAmountAfterWithholding,
                  )}
                </div>
              </div>
            </div>

            {withholdingEnabled && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <label
                  className={`inline-flex items-center gap-2 rounded-md border border-dashed border-input px-3 py-2 text-muted-foreground transition-colors ${
                    isActivatedContract
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer hover:border-success/40 hover:text-foreground"
                  }`}
                >
                  <FileUp className="size-3.5" />
                  {withholdingEvidence
                    ? "Replace withholding evidence"
                    : "Attach withholding evidence (required)"}

                  <input
                    type="file"
                    accept={CONTRACT_ATTACHMENT_ACCEPT}
                    className="hidden"
                    disabled={isActivatedContract}
                    onChange={(e) => {
                      handleEvidence(
                        e.target.files?.[0] ?? null,
                        "withholding",
                      );
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                {withholdingEvidence && (
                  <>
                    <Paperclip className="size-3.5 text-muted-foreground" />
                    <span className="truncate font-medium text-foreground">
                      {withholdingEvidence.fileName}
                    </span>

                    {withholdingEvidence.fileUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setViewingEvidence(withholdingEvidence)
                        }
                        className="h-6 gap-1 text-xs text-info"
                      >
                        Open
                      </Button>
                    )}

                    {!isActivatedContract && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          revokeBlobUrl(withholdingEvidence);
                          setWithholdingEvidence(null);
                          setErrors((prev) => {
                            const next = { ...prev };
                            delete next.withholdingEvidence;
                            return next;
                          });
                        }}
                        className="h-6 gap-1 text-xs text-destructive"
                      >
                        <Trash2 className="size-3" />
                        Remove
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}

            {errors.withholdingEvidence && (
              <p className="mt-1 text-xs text-destructive">
                {errors.withholdingEvidence}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            className="border-input text-foreground hover:bg-accent"
          >
            Cancel
          </Button>

          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {contract ? "Save Contract" : "Create Contract"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AttachmentViewer
        evidence={viewingEvidence}
        open={Boolean(viewingEvidence)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setViewingEvidence(null);
        }}
      />
    </>
  );
}