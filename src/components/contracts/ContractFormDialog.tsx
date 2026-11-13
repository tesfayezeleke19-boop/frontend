/**
 * Contract form dialog (Finance) — create or edit a contract header.
 *
 * Distinct from the ordinary Sales Invoice form: saving here creates a
 * CONTRACT only, never a Sales Invoice, and carries ONE FS No plus the
 * signed paper-contract attachments.
 *
 * Attachment behaviour follows the existing project convention (expenses /
 * payment evidence): files become API-ready metadata
 * ({ id, fileName, fileUrl, mimeType, fileSize }) and images also get a
 * browser object URL preview. Object URLs are session-scoped — the
 * metadata persists, the file bytes do not until the PHP backend stores
 * them. The dialog says so instead of implying permanent storage.
 */
import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";
import { useRef, useState } from "react";
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
import { FileUp, Info, Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { contractsRepository } from "@/services/contracts";
import {
  CONTRACT_ATTACHMENT_ACCEPT,
  validateContractAttachment,
  validateContractInput,
  type Contract,
  type ContractAttachment,
} from "@/services/contracts/types";

const inputClass =
  "h-9 border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30";

function dateInputValue(ts?: number): string {
  const date = new Date(ts && Number.isFinite(ts) ? ts : Date.now());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface FormState {
  customerName: string;
  tin: string;
  contractValue: string;
  fsNo: string;
  contractDate: string;
  remark: string;
}

const EMPTY_FORM: FormState = {
  customerName: "",
  tin: "",
  contractValue: "",
  fsNo: "",
  contractDate: dateInputValue(),
  remark: "",
};

function formFromContract(contract: Contract): FormState {
  return {
    customerName: contract.customer.name,
    tin: contract.customer.tin,
    contractValue: String(contract.contractValue),
    fsNo: contract.fsNo,
    contractDate: dateInputValue(contract.contractDate),
    remark: contract.remark ?? "",
  };
}

interface ContractFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing a Draft contract. */
  contract?: Contract | null;
  onSaved: (contract: Contract) => void;
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const update = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: ContractAttachment[] = [];
    for (const file of Array.from(files)) {
      const validation = validateContractAttachment(file);
      if (!validation.valid) {
        setAttachmentError(
          `${file.name}: ${Object.values(validation.errors)[0]}`,
        );
        continue;
      }
      const isImage = file.type.startsWith("image/");
      next.push({
        id: `contract-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fileName: file.name,
        fileUrl: isImage ? URL.createObjectURL(file) : "",
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
      });
    }
    if (next.length > 0) {
      setAttachmentError(null);
      setAttachments((prev) => [...prev, ...next]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    const parsed = {
      customerName: form.customerName,
      tin: form.tin,
      contractValue: parseFloat(form.contractValue) || 0,
      fsNo: form.fsNo,
      contractDate: new Date(`${form.contractDate}T00:00:00`).getTime(),
      attachments,
      remark: form.remark,
    };
    const validation = validateContractInput({
      ...parsed,
      contractDate: Number.isNaN(parsed.contractDate) ? 0 : parsed.contractDate,
    });
    setErrors(validation.errors);
    if (!validation.valid) return;

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
        error instanceof Error ? error.message : "Contract could not be saved",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
      <DialogContent className="max-h-[90vh] overflow-y-auto border-input bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {contract ? `Edit ${contract.contractNumber}` : "New Contract"}
          </DialogTitle>
          
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-muted-foreground">
                Customer / Company Name *
              </Label>
              <Input
                value={form.customerName}
                onChange={(e) => update("customerName", e.target.value)}
                className={`${inputClass} mt-1`}
              />
              {errors.customerName && (
                <p className="mt-1 text-xs text-destructive">{errors.customerName}</p>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Customer TIN *</Label>
              <Input
                value={form.tin}
                onChange={(e) => update("tin", e.target.value)}
                className={`${inputClass} mt-1`}
              />
              {errors.tin && (
                <p className="mt-1 text-xs text-destructive">{errors.tin}</p>
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
              <Label className="text-xs text-muted-foreground">FS No (one per contract) *</Label>
              <Input
                value={form.fsNo}
                onChange={(e) => update("fsNo", e.target.value)}
                placeholder="e.g. 2704301"
                className={`${inputClass} mt-1`}
              />
              {errors.fsNo && (
                <p className="mt-1 text-xs text-destructive">{errors.fsNo}</p>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Contract Date *</Label>
              <EthiopianDatePicker
  value={form.contractDate}
  onChange={(value) => update("contractDate", value)}
  className="mt-1"
/>
              {errors.contractDate && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.contractDate}
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Remarks</Label>
              <Input
                value={form.remark}
                onChange={(e) => update("remark", e.target.value)}
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
                
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
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
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>

            {attachmentError && (
              <p className="mt-2 text-xs text-destructive">{attachmentError}</p>
            )}

            {attachments.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className="flex items-center gap-3 rounded-md border border-border bg-card p-2"
                  >
                    {attachment.fileUrl ? (
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
                        {Math.max(1, Math.round(attachment.fileSize / 1024))} KB
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setAttachments((prev) =>
                          prev.filter((item) => item.id !== attachment.id),
                        )
                      }
                      className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[11px] text-muted-foreground/70">
                No paper contract attached yet.
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
  );
}
