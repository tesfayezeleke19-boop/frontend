/**
 * Shared expense form dialog — ONE form for both workflows (Finance-owned
 * and Admin-originated). The workflow is chosen by the host page, never by
 * the user: the source is assigned by the repository from the signed-in
 * role. Fields, validation, and the centralized calculation engine are
 * identical for both workflows.
 */
import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Paperclip,
  FileUp,
  Link2,
  Send,
  PenLine,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { actorLabel } from "@/services/auth/profile";
import { expensesRepository } from "@/services/finance/expenses";
import { adminExpensesApi } from "@/services/finance/api";
import {
  calculateExpenseTotals,
  EXPENSE_WHT_RATE,
} from "@/services/finance/expenseCalculations";
import {
  expenseFieldRequirements,
  validateExpenseFields,
  isExpenseComplete,
} from "@/services/finance/expenseValidation";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_TYPE,
  EXPENSE_TYPE_LABELS,
  expenseTypeOf,
  type Expense,
  type ExpenseAttachment,
  type ExpenseInput,
  type ExpenseType,
} from "@/services/finance/types";
import { formatCurrency } from "@/services/sales/format";

const inputClass =
  "h-9 border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30";

const selectTriggerClass =
  "h-9 w-full border-input bg-popover text-sm text-foreground";

/**
 * Return a local-calendar date as YYYY-MM-DD.
 * This avoids timezone shifts caused by converting a date-only value
 * through toISOString().
 */
function formatDateInput(ts?: number | string | null): string {
  if (ts === null || ts === undefined || ts === "") {
    return getTodayDate();
  }

  // Existing API records may contain a date-only string.
  if (typeof ts === "string") {
    const trimmed = ts.trim();

    // Preserve a valid YYYY-MM-DD value exactly as a calendar date.
    const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch && isValidDateOnly(trimmed)) {
      return trimmed;
    }

    // Handle date-time strings and numeric timestamp strings.
    const parsed =
      /^\d+$/.test(trimmed) ? new Date(Number(trimmed)) : new Date(trimmed);

    if (!Number.isNaN(parsed.getTime())) {
      return formatLocalDate(parsed);
    }

    return getTodayDate();
  }

  if (!Number.isFinite(ts)) {
    return getTodayDate();
  }

  return formatLocalDate(new Date(ts));
}

function getTodayDate(): string {
  return formatLocalDate(new Date());
}

function formatLocalDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

/**
 * Strictly validate a date-only value without relying on browser parsing.
 */
function isValidDateOnly(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

interface FormState {
  date: string;
  expenseType: ExpenseType;
  category: string;
  item: string;
  amountBeforeVat: string;
  whtEnabled: boolean;
  bank: string;
  paymentReference: string;
  paymentParty: string;
  remark: string;
}

const EMPTY_FORM: FormState = {
  date: getTodayDate(),
  expenseType: EXPENSE_TYPE.STANDARD,
  category: "",
  item: "",
  amountBeforeVat: "",
  whtEnabled: false,
  bank: "",
  paymentReference: "",
  paymentParty: "",
  remark: "",
};

function formFromExpense(expense: Expense | null): FormState {
  if (!expense) {
    return {
      ...EMPTY_FORM,
      date: getTodayDate(),
    };
  }

  return {
    date: formatDateInput(expense.date),
    expenseType: expenseTypeOf(expense),
    category: expense.category ?? "",
    item: expense.item ?? "",
    amountBeforeVat: String(expense.amountBeforeVat ?? 0),
    whtEnabled: !!expense.whtEnabled,
    bank: expense.bank ?? "",
    paymentReference: expense.paymentReference ?? "",
    paymentParty: expense.paymentParty ?? "",
    remark: expense.remark ?? "",
  };
}

export interface ExpenseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which workflow this form belongs to — source is assigned by role. */
  mode: "finance" | "admin";
  /** When set, the dialog edits that record instead of creating one. */
  initial?: Expense | null;
  /** Called after a successful save (or save+submit). */
  onSaved?: (saved: Expense, submitted: boolean) => void;
}

export default function ExpenseFormDialog({
  open,
  onOpenChange,
  mode,
  initial = null,
  onSaved,
}: ExpenseFormDialogProps) {
  const { user } = useAuth();
  const actor = actorLabel(user);
  const isEdit = !!initial;
  const isAdminMode = mode === "admin";

  const [form, setForm] = useState<FormState>(() => formFromExpense(initial));

  const [invoiceAttachment, setInvoiceAttachment] =
    useState<ExpenseAttachment | null>(initial?.invoiceAttachment ?? null);

  const [whtAttachment, setWhtAttachment] = useState<ExpenseAttachment | null>(
    initial?.whtAttachment ?? null,
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const isCasual = form.expenseType === EXPENSE_TYPE.CASUAL;
  const requirements = expenseFieldRequirements(form.expenseType);

  /* Live calculations — always through the central engine ---------------- */
  const amounts = useMemo(() => {
    return calculateExpenseTotals({
      amountBeforeVat: parseFloat(form.amountBeforeVat) || 0,
      vatApplicable: form.expenseType === EXPENSE_TYPE.STANDARD,
      whtEnabled: form.whtEnabled,
    });
  }, [form.amountBeforeVat, form.expenseType, form.whtEnabled]);

  const updateField = (field: keyof FormState, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));

    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleAttachment = async (
    file: globalThis.File | null,
    target: "invoice" | "wht",
  ) => {
    if (!file) return;

    const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Only PDF, JPG, PNG, and WebP files are allowed.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must not exceed 10 MB.");
      return;
    }

    setUploading(true);
    try {
      let attachment: ExpenseAttachment;

      if (isAdminMode) {
        // Admin expense attachments must be uploaded first so the API returns
        // a real database UUID (never a locally generated att-* identifier).
        const uploaded = await adminExpensesApi.uploadAttachment(file);
        attachment = {
          id: uploaded.id,
          fileName: uploaded.fileName,
          fileUrl: "",
          mimeType: uploaded.mimeType,
          fileSize: uploaded.fileSize,
        };
      } else {
        // Finance-owned expenses retain the existing Finance workflow behavior.
        attachment = {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: file.name,
          fileUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
        };
      }

      setErrors((prev) => {
        const next = { ...prev };
        delete next[target === "invoice" ? "invoiceAttachment" : "whtAttachment"];
        return next;
      });

      if (target === "invoice") setInvoiceAttachment(attachment);
      else setWhtAttachment(attachment);
      toast.success("Attachment uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Attachment upload failed");
      console.error(error);
    } finally {
      setUploading(false);
    }
  };

  /**
   * Keep the validator's existing timestamp-based date input if required
   * by expenseValidation.ts, while the API payload below uses YYYY-MM-DD.
   */
  const validationInput = () => ({
    date: isValidDateOnly(form.date)
      ? new Date(`${form.date}T00:00:00`).getTime()
      : NaN,
    category: form.category,
    item: form.item,
    amountBeforeVat:
      form.amountBeforeVat === "" ? NaN : parseFloat(form.amountBeforeVat),
    expenseType: form.expenseType,
    bank: form.bank,
    invoiceAttachment: invoiceAttachment ?? undefined,
    whtEnabled: form.whtEnabled,
    whtAttachment: whtAttachment ?? undefined,
  });

  /** Same conditional rules the repository enforces on submission. */
  const validateForm = (): boolean => {
    const errs = validateExpenseFields(validationInput());

    setErrors((prev) => {
      const next = { ...prev };

      for (const key of Object.keys(next)) {
        if (!next[key]) delete next[key];
      }

      return { ...next, ...errs };
    });

    return Object.values(errs).every((value) => !value);
  };

  /**
   * Build the expense payload.
   *
   * ExpenseInput stores dates as milliseconds. Convert the validated
   * YYYY-MM-DD form value to a local-calendar timestamp.
   */
  const buildInput = (): ExpenseInput => ({
    item: form.item.trim(),
    category: form.category,
    expenseType: form.expenseType,
    amountBeforeVat: amounts.amountBeforeVat,
    vatAmount: amounts.vatAmount,
    whtEnabled: form.whtEnabled,
    whtAmount: amounts.whtAmount,
    totalTransferred: amounts.totalTransferred,
    amount: amounts.totalAfterVat,
    bank: form.bank.trim(),
    paymentReference: form.paymentReference.trim() || undefined,
    paymentParty: form.paymentParty.trim() || undefined,
    invoiceAttachment: invoiceAttachment ?? undefined,
    whtAttachment: form.whtEnabled ? whtAttachment ?? undefined : undefined,
    remark: form.remark.trim() || undefined,
    date: new Date(`${form.date}T00:00:00`).getTime(),
  });

  const resetAndClose = () => {
    setForm(formFromExpense(null));
    setInvoiceAttachment(null);
    setWhtAttachment(null);
    setErrors({});
    onOpenChange(false);
  };

  const save = async (submitAfterSave: boolean) => {
    if (!validateForm()) {
      toast.error("Please fix the highlighted fields");
      return;
    }

    if (!isValidDateOnly(form.date)) {
      setErrors((prev) => ({
        ...prev,
        date: "Please enter a valid date.",
      }));
      toast.error("Please enter a valid date.");
      return;
    }

    setSaving(true);

    try {
      const input = buildInput();

      let saved: Expense;

      if (isEdit && initial) {
        saved =
          mode === "admin"
            ? await expensesRepository.updateAdminExpense(
                initial.id,
                input,
                actor,
              )
            : await expensesRepository.updateExpense(initial.id, input, actor);
      } else {
        saved =
          mode === "admin"
            ? await expensesRepository.createAdminExpense(input, actor)
            : await expensesRepository.createExpense(input, actor);
      }

      if (submitAfterSave) {
        // Submission validates the full record server-side (attachments,
        // required fields) — a draft can never slip into review incomplete.
        saved = await expensesRepository.submitAdminExpense(saved.id, actor);
      }

      toast.success(
        submitAfterSave
          ? "Expense submitted to Finance for review"
          : isEdit
            ? "Changes saved"
            : mode === "admin"
              ? "Expense saved as draft"
              : "Expense recorded",
      );

      onSaved?.(saved, submitAfterSave);
      resetAndClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save expense",
      );
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  // Submission is gated by the SAME shared validator — a casual draft needs
  // no bank details or payment evidence, so it is submittable once complete.
  const canSubmitDraft =
    isAdminMode && isExpenseComplete(validationInput());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-input bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-semibold text-foreground">
            {isEdit
              ? isAdminMode
                ? "Edit Admin Expense"
                : "Edit Expense"
              : isAdminMode
                ? "Create Expense"
                : "Add Expense"}
          </DialogTitle>

          <DialogDescription className="text-sm text-muted-foreground">
            
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Classification */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Expense Type *
            </Label>

            <div className="mt-1 grid grid-cols-2 gap-2">
              {(
                [EXPENSE_TYPE.STANDARD, EXPENSE_TYPE.CASUAL] as const
              ).map((type) => {
                const selected = form.expenseType === type;

                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      updateField("expenseType", type);

                      if (type === EXPENSE_TYPE.CASUAL) {
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.bank;
                          delete next.invoiceAttachment;
                          return next;
                        });
                      }
                    }}
                    aria-pressed={selected}
                    className={`cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors ${
                      selected
                        ? "border-success/60 bg-success/10"
                        : "border-input bg-popover hover:border-border"
                    }`}
                  >
                    <span
                      className={`block text-sm font-medium ${
                        selected ? "text-success" : "text-foreground"
                      }`}
                    >
                      {EXPENSE_TYPE_LABELS[type]}
                    </span>

                    <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                      {type === EXPENSE_TYPE.STANDARD
                        ? "VAT applies; bank details and evidence required"
                        : "No VAT, bank details, or payment evidence"}
                    </span>
                  </button>
                );
              })}
            </div>

          </div>

          {/* Expense Information */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Date *
              </Label>

              <EthiopianDatePicker
  value={form.date}
  onChange={(value) => updateField("date", value)}
  className={`mt-1 ${
    errors.date ? "border-destructive" : ""
  }`}
/>

              {errors.date && (
                <p className="mt-1 text-xs text-destructive">{errors.date}</p>
              )}
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Expense Category *
              </Label>

              <Select
                value={form.category}
                onValueChange={(value) => updateField("category", value)}
              >
                <SelectTrigger
                  className={`${selectTriggerClass} mt-1 ${
                    errors.category ? "border-destructive" : ""
                  }`}
                >
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>

                <SelectContent className="border-input bg-popover">
                  {EXPENSE_CATEGORIES.map((category) => (
                    <SelectItem
                      key={category}
                      value={category}
                      className="text-sm text-foreground focus:bg-accent"
                    >
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {errors.category && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.category}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Equipment / Item *
            </Label>

            <Input
              value={form.item}
              onChange={(e) => updateField("item", e.target.value)}
              placeholder="e.g. Loader rental, diesel purchase"
              className={`${inputClass} mt-1 ${
                errors.item ? "border-destructive" : ""
              }`}
            />

            {errors.item && (
              <p className="mt-1 text-xs text-destructive">{errors.item}</p>
            )}
          </div>

          {/* Financial Information */}
          <div className="rounded-lg border border-border bg-sidebar p-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  {isCasual
                    ? "Amount (ETB) *"
                    : "Amount Before VAT (ETB) *"}
                </Label>

                <Input
                  type="number"
                  value={form.amountBeforeVat}
                  onChange={(e) =>
                    updateField("amountBeforeVat", e.target.value)
                  }
                  placeholder="0"
                  min="0"
                  step="0.01"
                  className={`${inputClass} mt-1 ${
                    errors.amountBeforeVat ? "border-destructive" : ""
                  }`}
                />

                {errors.amountBeforeVat && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.amountBeforeVat}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">
                    VAT
                  </Label>

                  <div
                    className={`mt-1 h-9 pt-2 text-sm font-medium tabular-nums ${
                      isCasual ? "text-muted-foreground/70" : "text-warning"
                    }`}
                  >
                    {isCasual
                      ? "Not applicable"
                      : formatCurrency(amounts.vatAmount)}
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-medium text-muted-foreground">
                    {isCasual ? "Total" : "Total / After VAT"}
                  </Label>

                  <div className="mt-1 h-9 pt-2 text-sm font-semibold tabular-nums text-foreground">
                    {formatCurrency(amounts.totalAfterVat)}
                  </div>
                </div>
              </div>
            </div>

            {/* WHT toggle */}
            <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-popover p-3">
              <div>
                <div className="text-sm font-medium text-foreground">
                  WHT ({Math.round(EXPENSE_WHT_RATE * 100)}% of{" "}
                  {isCasual ? "Amount" : "Amount Before VAT"})
                </div>

                <div className="font-mono text-[10px] text-muted-foreground/70">
                  WHT is {form.whtEnabled ? "ON" : "OFF"} — Total Transferred{" "}
                  {formatCurrency(amounts.totalTransferred)}
                </div>
              </div>

              <Switch
                checked={form.whtEnabled}
                onCheckedChange={(checked) => {
                  updateField("whtEnabled", checked);

                  if (!checked) {
                    setWhtAttachment(null);
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.whtAttachment;
                      return next;
                    });
                  }
                }}
                className="data-[state=checked]:bg-success"
              />
            </div>

            <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-popover px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Total Transferred
              </span>

              <span className="text-sm font-semibold tabular-nums text-success">
                {formatCurrency(amounts.totalTransferred)}
              </span>
            </div>
          </div>

          {/* WHT attachment */}
          {form.whtEnabled && (
            <div className="rounded-lg border border-border bg-sidebar p-3">
              <Label className="text-xs font-medium text-muted-foreground">
                WHT Attachment *
              </Label>

              {whtAttachment ? (
                <div className="mt-2 flex items-center gap-2 text-xs text-success">
                  <Paperclip className="size-3.5" />

                  <span className="truncate font-medium">
                    {whtAttachment.fileName}
                  </span>

                  {whtAttachment.fileUrl && (
                    <a
                      href={whtAttachment.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-info hover:underline"
                    >
                      <Link2 className="size-3" />
                      open
                    </a>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setWhtAttachment(null)}
                    className="ml-auto h-6 gap-1 text-xs text-destructive"
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input p-3 text-xs text-muted-foreground transition-colors hover:border-success/40 hover:text-foreground">
                  <FileUp className="size-4" />
                  Upload the withholding document (required when WHT is ON)

                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) =>
                      handleAttachment(e.target.files?.[0] ?? null, "wht")
                    }
                  />
                </label>
              )}

              {errors.whtAttachment && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.whtAttachment}
                </p>
              )}
            </div>
          )}

          {/* Payment Information */}
          {isCasual && (
            <p className="rounded-lg border border-border bg-sidebar px-3 py-2 text-[11px] text-muted-foreground">
              Payment details and evidence are optional for casual expenses.
              Leave them blank — nothing is generated or filled in for you.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Bank {requirements.bank ? "*" : "(optional)"}
              </Label>

              <Input
                value={form.bank}
                onChange={(e) => updateField("bank", e.target.value)}
                placeholder={isCasual ? "Not necessary" : "e.g. CBE"}
                className={`${inputClass} mt-1 ${
                  errors.bank ? "border-destructive" : ""
                }`}
              />

              {errors.bank && (
                <p className="mt-1 text-xs text-destructive">{errors.bank}</p>
              )}
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Payment Reference
              </Label>

              <Input
                value={form.paymentReference}
                onChange={(e) =>
                  updateField("paymentReference", e.target.value)
                }
                placeholder="Transaction number"
                className={`${inputClass} mt-1 font-mono text-xs`}
              />
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Sent By / Recipient
              </Label>

              <Input
                value={form.paymentParty}
                onChange={(e) => updateField("paymentParty", e.target.value)}
                placeholder="Payment party"
                className={`${inputClass} mt-1`}
              />
            </div>
          </div>

          {/* Invoice / supporting attachment */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              {requirements.invoiceAttachment
                ? "Invoice Attachment *"
                : "Supporting Document (optional)"}
            </Label>

            {invoiceAttachment ? (
              <div className="mt-1 flex items-center gap-2 text-xs text-success">
                <Paperclip className="size-3.5" />

                <span className="truncate font-medium">
                  {invoiceAttachment.fileName}
                </span>

                {invoiceAttachment.fileUrl && (
                  <a
                    href={invoiceAttachment.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-info hover:underline"
                  >
                    <Link2 className="size-3" />
                    open
                  </a>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setInvoiceAttachment(null)}
                  className="ml-auto h-6 gap-1 text-xs text-destructive"
                >
                  Remove
                </Button>
              </div>
            ) : (
              <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input p-3 text-xs text-muted-foreground transition-colors hover:border-success/40 hover:text-foreground">
                <FileUp className="size-4" />

                {requirements.invoiceAttachment
                  ? "Upload the supplier invoice or supporting document"
                  : "Attach a receipt if one exists — not required"}

                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) =>
                    handleAttachment(e.target.files?.[0] ?? null, "invoice")
                  }
                />
              </label>
            )}

            {errors.invoiceAttachment && (
              <p className="mt-1 text-xs text-destructive">
                {errors.invoiceAttachment}
              </p>
            )}
          </div>

          {/* Optional remarks / explanation */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Remark {isAdminMode ? "(optional explanation for Finance)" : ""}
            </Label>

            <Textarea
              value={form.remark}
              onChange={(e) => updateField("remark", e.target.value)}
              placeholder="Optional remark..."
              rows={2}
              className="mt-1 resize-none border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving || uploading}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>

          {isAdminMode && (
            <Button
              onClick={() => save(true)}
              disabled={saving || uploading || !canSubmitDraft}
              title={
                canSubmitDraft
                  ? "Submit this expense to Finance for review"
                  : "Complete the required fields to enable submission"
              }
              className="gap-2 bg-success text-primary-foreground hover:bg-success"
            >
              <Send className="size-4" />
              Submit for Review
            </Button>
          )}

          <Button
            onClick={() => save(false)}
            disabled={saving || uploading}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving || uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isEdit ? (
              <PenLine className="size-4" />
            ) : (
              <Plus className="size-4" />
            )}

            {isEdit
              ? "Save Changes"
              : isAdminMode
                ? "Save Draft"
                : "Save Expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}