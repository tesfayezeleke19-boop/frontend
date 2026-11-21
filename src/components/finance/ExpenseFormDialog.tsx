/**
 * Shared expense form dialog — ONE form for both workflows (Finance-owned
 * and Admin-originated). The workflow is chosen by the host page, never by
 * the user: the source is assigned by the repository from the signed-in
 * role. Fields, validation, and the centralized calculation engine are
 * identical for both workflows.
 */
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Paperclip,
  FileUp,
  Link2,
  Send,
  PenLine,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { actorLabel } from "@/services/auth/profile";
import { expensesRepository } from "@/services/finance/expenses";
import { financeApi, adminExpensesApi } from "@/services/finance/api";
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
  type Expense,
  type ExpenseAttachment,
  type ExpenseInput,
  type ExpenseType,
} from "@/services/finance/types";
import { formatCurrency } from "@/services/sales/format";

const inputClass =
  "h-9 border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30";

const selectTriggerClass =
  "h-9 w-full border-input bg-background text-sm text-foreground";

/* -------------------------------------------------------------------------- */
/* Ethiopian calendar                                                         */
/* -------------------------------------------------------------------------- */

interface EthiopianDate {
  year: number;
  month: number;
  day: number;
}

const ETHIOPIAN_MONTHS = [
  "Meskerem",
  "Tikimt",
  "Hidar",
  "Tahsas",
  "Tir",
  "Yekatit",
  "Megabit",
  "Miyazya",
  "Ginbot",
  "Sene",
  "Hamle",
  "Nehase",
  "Pagume",
];

const ETHIOPIAN_WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

const ETHIOPIAN_DATE_FORMATTER = new Intl.DateTimeFormat(
  "en-u-ca-ethiopic-nu-latn",
  {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  },
);

function getEthiopianPartsFromDate(date: Date): EthiopianDate {
  const parts = ETHIOPIAN_DATE_FORMATTER.formatToParts(date);

  const getPart = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
  };
}

function getEthiopianPartsFromGregorian(
  dateString: string,
): EthiopianDate {
  const [year, month, day] = dateString.split("-").map(Number);

  const date = new Date(
    Date.UTC(year, month - 1, day, 12),
  );

  return getEthiopianPartsFromDate(date);
}

function isEthiopianLeapYear(year: number): boolean {
  return year % 4 === 3;
}

function getEthiopianMonthDays(
  year: number,
  month: number,
): number {
  if (month === 13) {
    return isEthiopianLeapYear(year) ? 6 : 5;
  }

  return 30;
}

/**
 * Finds the Gregorian date corresponding to Ethiopian New Year.
 * Ethiopian New Year normally falls between September 11 and 12.
 */
function getEthiopianNewYear(year: number): Date {
  const gregorianYear = year + 7;

  for (let day = 8; day <= 14; day++) {
    const candidate = new Date(
      Date.UTC(gregorianYear, 8, day, 12),
    );

    const parts = getEthiopianPartsFromDate(candidate);

    if (
      parts.year === year &&
      parts.month === 1 &&
      parts.day === 1
    ) {
      return candidate;
    }
  }

  throw new Error("Unable to determine Ethiopian New Year.");
}

/**
 * Convert an Ethiopian date to a Gregorian YYYY-MM-DD value.
 * The Gregorian value is retained internally for the existing API.
 */
function ethiopianDateToGregorian(
  value: EthiopianDate,
): string {
  const { year, month, day } = value;

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1 ||
    month < 1 ||
    month > 13 ||
    day < 1 ||
    day > getEthiopianMonthDays(year, month)
  ) {
    throw new Error("Invalid Ethiopian date.");
  }

  const newYear = getEthiopianNewYear(year);

  const daysToAdd =
    (month - 1) * 30 + (day - 1);

  newYear.setUTCDate(
    newYear.getUTCDate() + daysToAdd,
  );

  const gregorianYear = newYear.getUTCFullYear();
  const gregorianMonth = String(
    newYear.getUTCMonth() + 1,
  ).padStart(2, "0");
  const gregorianDay = String(
    newYear.getUTCDate(),
  ).padStart(2, "0");

  return `${gregorianYear}-${gregorianMonth}-${gregorianDay}`;
}

function getEthiopianMonthGrid(
  year: number,
  month: number,
): Array<number | null> {
  const newYear = getEthiopianNewYear(year);

  const daysBeforeMonth = (month - 1) * 30;

  const firstDay = new Date(newYear);
  firstDay.setUTCDate(
    firstDay.getUTCDate() + daysBeforeMonth,
  );

  const startingWeekday = firstDay.getUTCDay();
  const totalDays = getEthiopianMonthDays(year, month);

  const cells: Array<number | null> = [];

  for (let i = 0; i < startingWeekday; i++) {
    cells.push(null);
  }

  for (let day = 1; day <= totalDays; day++) {
    cells.push(day);
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function formatEthiopianDate(value: EthiopianDate): string {
  return `${value.day} ${ETHIOPIAN_MONTHS[value.month - 1]} ${value.year}`;
}

/* -------------------------------------------------------------------------- */
/* Existing Gregorian date helpers                                           */
/* -------------------------------------------------------------------------- */

/**
 * Return a local-calendar date as YYYY-MM-DD.
 * This avoids timezone shifts caused by converting a date-only value
 * through toISOString().
 */
function formatDateInput(ts?: number | string | null): string {
  if (ts === null || ts === undefined || ts === "") {
    return getTodayDate();
  }

  if (typeof ts === "string") {
    const trimmed = ts.trim();

    const dateOnlyMatch = trimmed.match(
      /^(\d{4})-(\d{2})-(\d{2})$/,
    );

    if (dateOnlyMatch && isValidDateOnly(trimmed)) {
      return trimmed;
    }

    const parsed =
      /^\d+$/.test(trimmed)
        ? new Date(Number(trimmed))
        : new Date(trimmed);

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
  const pad = (n: number) =>
    String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1,
  )}-${pad(date.getDate())}`;
}

/**
 * Strictly validate a Gregorian date-only value.
 */
function isValidDateOnly(value: string): boolean {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})$/,
  );

  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(
    Date.UTC(year, month - 1, day),
  );

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/* -------------------------------------------------------------------------- */
/* Form state                                                                 */
/* -------------------------------------------------------------------------- */

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

/**
 * The backend keeps these as separate values:
 *
 * expense_category = STANDARD / CASUAL
 * expense_type     = Fuel / Rent / Maintenance / etc.
 */
function formFromExpense(
  expense: Expense | null,
): FormState {
  if (!expense) {
    return {
      ...EMPTY_FORM,
      date: getTodayDate(),
    };
  }

  const raw = expense as any;

  const rawClassification =
    raw.expense_category ??
    raw.expenseCategory ??
    raw.category ??
    raw.expenseType;

  const classification =
    String(rawClassification ?? "").toUpperCase() === "CASUAL"
      ? EXPENSE_TYPE.CASUAL
      : EXPENSE_TYPE.STANDARD;

  const actualType =
    raw.expense_type ??
    raw.expenseType ??
    raw.type ??
    (
      raw.category &&
      !["STANDARD", "CASUAL"].includes(
        String(raw.category).toUpperCase(),
      )
        ? raw.category
        : ""
    );

  return {
    date: formatDateInput(expense.date),
    expenseType: classification,
    category: String(actualType ?? ""),
    item: expense.item ?? "",
    amountBeforeVat: String(
      expense.amountBeforeVat ?? 0,
    ),
    whtEnabled: !!expense.whtEnabled,
    bank: expense.bank ?? "",
    paymentReference: expense.paymentReference ?? "",
    paymentParty: expense.paymentParty ?? "",
    remark: expense.remark ?? "",
  };
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export interface ExpenseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "finance" | "admin";
  initial?: Expense | null;
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

  const [form, setForm] = useState<FormState>(
    () => formFromExpense(initial),
  );

  const [invoiceAttachment, setInvoiceAttachment] =
    useState<ExpenseAttachment | null>(
      initial?.invoiceAttachment ?? null,
    );

  const [whtAttachment, setWhtAttachment] =
    useState<ExpenseAttachment | null>(
      initial?.whtAttachment ?? null,
    );

  const [errors, setErrors] = useState<
    Record<string, string>
  >({});

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [calendarOpen, setCalendarOpen] = useState(false);

  const selectedEthiopianDate = useMemo(
    () => getEthiopianPartsFromGregorian(form.date),
    [form.date],
  );

  const [calendarView, setCalendarView] =
    useState<EthiopianDate>(
      () => getEthiopianPartsFromGregorian(form.date),
    );

  const calendarDays = useMemo(
    () =>
      getEthiopianMonthGrid(
        calendarView.year,
        calendarView.month,
      ),
    [calendarView.year, calendarView.month],
  );

  const isCasual =
    form.expenseType === EXPENSE_TYPE.CASUAL;

  const requirements = expenseFieldRequirements(
    form.expenseType,
  );

  /* Live calculations — always through the central engine */
  const amounts = useMemo(() => {
    return calculateExpenseTotals({
      amountBeforeVat:
        parseFloat(form.amountBeforeVat) || 0,
      vatApplicable:
        form.expenseType === EXPENSE_TYPE.STANDARD,
      whtEnabled: form.whtEnabled,
    });
  }, [
    form.amountBeforeVat,
    form.expenseType,
    form.whtEnabled,
  ]);

  const updateField = (
    field: keyof FormState,
    value: string | boolean,
  ) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));

    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  /**
   * Update the visible Ethiopian calendar month.
   */
  const changeCalendarMonth = (direction: -1 | 1) => {
    setCalendarView((prev) => {
      let year = prev.year;
      let month = prev.month + direction;

      if (month < 1) {
        month = 13;
        year -= 1;
      } else if (month > 13) {
        month = 1;
        year += 1;
      }

      return {
        year,
        month,
        day: 1,
      };
    });
  };

  /**
   * Open the calendar at the currently selected Ethiopian date.
   */
  const openEthiopianCalendar = () => {
    setCalendarView({
      ...selectedEthiopianDate,
    });
    setCalendarOpen(true);
  };

  /**
   * Save the selected Ethiopian date as a Gregorian date internally.
   */
  const selectEthiopianDay = (day: number) => {
    try {
      const selectedDate: EthiopianDate = {
        year: calendarView.year,
        month: calendarView.month,
        day,
      };

      const gregorianDate =
        ethiopianDateToGregorian(selectedDate);

      updateField("date", gregorianDate);
      setCalendarOpen(false);
    } catch (error) {
      toast.error("Unable to select this Ethiopian date.");
      console.error(error);
    }
  };

  const handleAttachment = async (
    file: globalThis.File | null,
    target: "invoice" | "wht",
  ) => {
    if (!file) return;

    const extension =
      file.name.split(".").pop()?.toLowerCase() ?? "";

    const imageExtensions = new Set([
      "jpg",
      "jpeg",
      "png",
      "webp",
      "gif",
      "bmp",
      "dib",
      "tif",
      "tiff",
      "avif",
      "heic",
      "heif",
      "jxl",
      "ico",
    ]);

    const isSvg =
      file.type === "image/svg+xml" ||
      extension === "svg";

    const isPdf =
      file.type === "application/pdf" ||
      extension === "pdf";

    const isImage =
      !isSvg &&
      (
        file.type.startsWith("image/") ||
        imageExtensions.has(extension)
      );

    if (!isPdf && !isImage) {
      toast.error(
        "Choose a PDF or image file (JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC, etc.). SVG files are not supported.",
      );
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must not exceed 10 MB.");
      return;
    }

    setUploading(true);

    try {
      const uploaded = isAdminMode
        ? await adminExpensesApi.uploadAttachment(file)
        : await financeApi.uploadExpenseAttachment(file);

      const attachment: ExpenseAttachment = {
        id: uploaded.id,
        fileName: uploaded.fileName,
        fileUrl: "",
        mimeType: uploaded.mimeType,
        fileSize: uploaded.fileSize,
      };

      setErrors((prev) => {
        const next = { ...prev };

        delete next[
          target === "invoice"
            ? "invoiceAttachment"
            : "whtAttachment"
        ];

        return next;
      });

      if (target === "invoice") {
        setInvoiceAttachment(attachment);
      } else {
        setWhtAttachment(attachment);
      }

      toast.success("Attachment uploaded");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Attachment upload failed",
      );

      console.error(error);
    } finally {
      setUploading(false);
    }
  };

  /**
   * The validator continues receiving its existing timestamp-based date.
   * The form date is internally Gregorian YYYY-MM-DD.
   */
  const validationInput = () => ({
    date: isValidDateOnly(form.date)
      ? new Date(`${form.date}T00:00:00`).getTime()
      : NaN,
    category: form.category,
    item: form.item,
    amountBeforeVat:
      form.amountBeforeVat === ""
        ? NaN
        : parseFloat(form.amountBeforeVat),
    expenseType: form.expenseType,
    bank: form.bank,
    invoiceAttachment:
      invoiceAttachment ?? undefined,
    whtEnabled: form.whtEnabled,
    whtAttachment:
      whtAttachment ?? undefined,
  });

  const validateForm = (): boolean => {
    const errs = validateExpenseFields(
      validationInput(),
    );

    setErrors((prev) => {
      const next = { ...prev };

      for (const key of Object.keys(next)) {
        if (!next[key]) delete next[key];
      }

      return {
        ...next,
        ...errs,
      };
    });

    return Object.values(errs).every(
      (value) => !value,
    );
  };

  /**
   * Build the expense payload.
   * The existing API continues receiving a Gregorian timestamp.
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
    paymentReference:
      form.paymentReference.trim() || undefined,
    paymentParty:
      form.paymentParty.trim() || undefined,
    invoiceAttachment:
      invoiceAttachment ?? undefined,
    whtAttachment: form.whtEnabled
      ? whtAttachment ?? undefined
      : undefined,
    remark: form.remark.trim() || undefined,
    date: new Date(
      `${form.date}T00:00:00`,
    ).getTime(),
  });

  const resetAndClose = () => {
    setForm(formFromExpense(null));
    setInvoiceAttachment(null);
    setWhtAttachment(null);
    setErrors({});
    setCalendarOpen(false);
    onOpenChange(false);
  };

  const save = async (
    submitAfterSave: boolean,
  ) => {
    if (!validateForm()) {
      toast.error(
        "Please fix the highlighted fields",
      );
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
            : await expensesRepository.updateExpense(
                initial.id,
                input,
                actor,
              );
      } else {
        saved =
          mode === "admin"
            ? await expensesRepository.createAdminExpense(
                input,
                actor,
              )
            : await expensesRepository.createExpense(
                input,
                actor,
              );
      }

      if (submitAfterSave) {
        saved =
          await expensesRepository.submitAdminExpense(
            saved.id,
            actor,
          );
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
        error instanceof Error
          ? error.message
          : "Failed to save expense",
      );

      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const canSubmitDraft =
    isAdminMode &&
    isExpenseComplete(validationInput());

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card text-card-foreground sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-semibold text-card-foreground">
            {isEdit
              ? isAdminMode
                ? "Edit Admin Expense"
                : "Edit Expense"
              : isAdminMode
                ? "Create Expense"
                : "Add Expense"}
          </DialogTitle>

    
        </DialogHeader>

        <div className="space-y-4">
          {/* Classification */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Expense Type *
            </Label>

            <div className="mt-1 grid grid-cols-2 gap-2">
              {(
                [
                  EXPENSE_TYPE.STANDARD,
                  EXPENSE_TYPE.CASUAL,
                ] as const
              ).map((type) => {
                const selected =
                  form.expenseType === type;

                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      updateField(
                        "expenseType",
                        type,
                      );

                      if (
                        type === EXPENSE_TYPE.CASUAL
                      ) {
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
                        ? "border-primary/60 bg-primary/10"
                        : "border-border bg-background hover:border-ring"
                    }`}
                  >
                    <span
                      className={`block text-sm font-medium ${
                        selected
                          ? "text-primary"
                          : "text-foreground"
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

            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Classification is stored with the expense. Casual is a company
              recording choice, not a tax or legal determination.
            </p>
          </div>

          {/* Expense Information */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Ethiopian Calendar Date Picker */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Date (Ethiopian Calendar) *
              </Label>

              <Popover
                open={calendarOpen}
                onOpenChange={(nextOpen) => {
                  if (nextOpen) {
                    openEthiopianCalendar();
                  } else {
                    setCalendarOpen(false);
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openEthiopianCalendar}
                    className={`mt-1 h-9 w-full justify-start gap-2 border-input bg-background px-3 text-left text-sm font-normal text-foreground hover:bg-accent ${
                      errors.date
                        ? "border-destructive"
                        : ""
                    }`}
                  >
                    <CalendarDays className="size-4 text-muted-foreground" />

                    <span>
                      {formatEthiopianDate(
                        selectedEthiopianDate,
                      )}
                    </span>
                  </Button>
                </PopoverTrigger>

                <PopoverContent
                  align="start"
                  className="w-[300px] border-border bg-popover p-3 text-popover-foreground"
                >
                  {/* Calendar header */}
                  <div className="mb-3 flex items-center justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        changeCalendarMonth(-1)
                      }
                      className="size-8"
                      aria-label="Previous month"
                    >
                      <ChevronLeft className="size-4" />
                    </Button>

                    <div className="text-center">
                      <p className="text-sm font-semibold text-foreground">
                        {ETHIOPIAN_MONTHS[
                          calendarView.month - 1
                        ]}
                      </p>

                      <p className="text-xs text-muted-foreground">
                        {calendarView.year}
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        changeCalendarMonth(1)
                      }
                      className="size-8"
                      aria-label="Next month"
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>

                  {/* Weekday headings */}
                  <div className="mb-1 grid grid-cols-7">
                    {ETHIOPIAN_WEEKDAYS.map(
                      (weekday) => (
                        <div
                          key={weekday}
                          className="flex h-8 items-center justify-center text-[10px] font-medium text-muted-foreground"
                        >
                          {weekday}
                        </div>
                      ),
                    )}
                  </div>

                  {/* Calendar days */}
                  <div className="grid grid-cols-7 gap-y-1">
                    {calendarDays.map(
                      (day, index) => {
                        if (day === null) {
                          return (
                            <div
                              key={`empty-${index}`}
                              className="h-9"
                            />
                          );
                        }

                        const isSelected =
                          selectedEthiopianDate.year ===
                            calendarView.year &&
                          selectedEthiopianDate.month ===
                            calendarView.month &&
                          selectedEthiopianDate.day ===
                            day;

                        const isToday = (() => {
                          const today =
                            getEthiopianPartsFromGregorian(
                              getTodayDate(),
                            );

                          return (
                            today.year ===
                              calendarView.year &&
                            today.month ===
                              calendarView.month &&
                            today.day === day
                          );
                        })();

                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() =>
                              selectEthiopianDay(day)
                            }
                            aria-pressed={isSelected}
                            className={`mx-auto flex size-9 items-center justify-center rounded-md text-sm transition-colors ${
                              isSelected
                                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                : isToday
                                  ? "border border-primary/60 text-primary hover:bg-accent"
                                  : "text-foreground hover:bg-accent"
                            }`}
                          >
                            {day}
                          </button>
                        );
                      },
                    )}
                  </div>

                  {/* Calendar footer */}
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
                    <span className="text-[10px] text-muted-foreground">
                      Ethiopian Calendar
                    </span>

                    <button
                      type="button"
                      onClick={() => {
                        const today =
                          getEthiopianPartsFromGregorian(
                            getTodayDate(),
                          );

                        setCalendarView(today);
                        selectEthiopianDay(today.day);
                      }}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Today
                    </button>
                  </div>
                </PopoverContent>
              </Popover>

              {errors.date && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.date}
                </p>
              )}
            </div>

            {/* Actual Expense Category */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Expense Category *
              </Label>

              <Select
                value={form.category}
                onValueChange={(value) =>
                  updateField("category", value)
                }
              >
                <SelectTrigger
                  className={`${selectTriggerClass} mt-1 ${
                    errors.category
                      ? "border-destructive"
                      : ""
                  }`}
                >
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>

                <SelectContent className="border-border bg-popover text-popover-foreground">
                  {EXPENSE_CATEGORIES.map(
                    (category) => (
                      <SelectItem
                        key={category}
                        value={category}
                        className="text-sm text-foreground focus:bg-accent"
                      >
                        {category}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>

              {errors.category && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.category}
                </p>
              )}
            </div>
          </div>

          {/* Equipment / Item */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Equipment / Item *
            </Label>

            <Input
              value={form.item}
              onChange={(e) =>
                updateField("item", e.target.value)
              }
              placeholder="e.g. Loader rental, diesel purchase"
              className={`${inputClass} mt-1 ${
                errors.item
                  ? "border-destructive"
                  : ""
              }`}
            />

            {errors.item && (
              <p className="mt-1 text-xs text-destructive">
                {errors.item}
              </p>
            )}
          </div>

          {/* Financial Information */}
          <div className="rounded-lg border border-border bg-muted/50 p-3">
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
                    updateField(
                      "amountBeforeVat",
                      e.target.value,
                    )
                  }
                  placeholder="0"
                  min="0"
                  step="0.01"
                  className={`${inputClass} mt-1 ${
                    errors.amountBeforeVat
                      ? "border-destructive"
                      : ""
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
                      isCasual
                        ? "text-muted-foreground"
                        : "text-amber-500"
                    }`}
                  >
                    {isCasual
                      ? "Not applicable"
                      : formatCurrency(
                          amounts.vatAmount,
                        )}
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-medium text-muted-foreground">
                    {isCasual
                      ? "Total"
                      : "Total / After VAT"}
                  </Label>

                  <div className="mt-1 h-9 pt-2 text-sm font-semibold tabular-nums text-card-foreground">
                    {formatCurrency(
                      amounts.totalAfterVat,
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* WHT toggle */}
            <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-background p-3">
              <div>
                <div className="text-sm font-medium text-foreground">
                  WHT (
                  {Math.round(
                    EXPENSE_WHT_RATE * 100,
                  )}
                  % of{" "}
                  {isCasual
                    ? "Amount"
                    : "Amount Before VAT"}
                  )
                </div>

                <div className="font-mono text-[10px] text-muted-foreground">
                  WHT is{" "}
                  {form.whtEnabled ? "ON" : "OFF"} — Total
                  Transferred{" "}
                  {formatCurrency(
                    amounts.totalTransferred,
                  )}
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
                className="data-[state=checked]:bg-primary"
              />
            </div>

            <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Total Transferred
              </span>

              <span className="text-sm font-semibold tabular-nums text-success">
                {formatCurrency(
                  amounts.totalTransferred,
                )}
              </span>
            </div>
          </div>

          {/* WHT attachment */}
          {form.whtEnabled && (
            <div className="rounded-lg border border-border bg-muted/50 p-3">
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
                      className="inline-flex items-center gap-1 text-blue-500 hover:underline"
                    >
                      <Link2 className="size-3" />
                      open
                    </a>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setWhtAttachment(null)
                    }
                    className="ml-auto h-6 gap-1 text-xs text-destructive"
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground">
                  <FileUp className="size-4" />
                  Upload the withholding document (required when WHT is ON)

                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) =>
                      handleAttachment(
                        e.target.files?.[0] ?? null,
                        "wht",
                      )
                    }
                  />
                </label>
              )}

              <p className="mt-1 text-[10px] text-muted-foreground">
                PDF or common image formats (JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC). Maximum 10 MB.
              </p>

              {errors.whtAttachment && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.whtAttachment}
                </p>
              )}
            </div>
          )}

          {/* Payment Information */}
          {isCasual && (
            <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
              Payment details and evidence are optional for casual expenses.
              Leave them blank — nothing is generated or filled in for you.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Bank{" "}
                {requirements.bank
                  ? "*"
                  : "(optional)"}
              </Label>

              <Input
                value={form.bank}
                onChange={(e) =>
                  updateField("bank", e.target.value)
                }
                placeholder={
                  isCasual
                    ? "Not necessary"
                    : "e.g. CBE"
                }
                className={`${inputClass} mt-1 ${
                  errors.bank
                    ? "border-destructive"
                    : ""
                }`}
              />

              {errors.bank && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.bank}
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Payment Reference
              </Label>

              <Input
                value={form.paymentReference}
                onChange={(e) =>
                  updateField(
                    "paymentReference",
                    e.target.value,
                  )
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
                onChange={(e) =>
                  updateField(
                    "paymentParty",
                    e.target.value,
                  )
                }
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
                    className="inline-flex items-center gap-1 text-blue-500 hover:underline"
                  >
                    <Link2 className="size-3" />
                    open
                  </a>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setInvoiceAttachment(null)
                  }
                  className="ml-auto h-6 gap-1 text-xs text-destructive"
                >
                  Remove
                </Button>
              </div>
            ) : (
              <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground">
                <FileUp className="size-4" />

                {requirements.invoiceAttachment
                  ? "Upload the supplier invoice or supporting document"
                  : "Attach a receipt if one exists — not required"}

                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) =>
                    handleAttachment(
                      e.target.files?.[0] ?? null,
                      "invoice",
                    )
                  }
                />
              </label>
            )}

            <p className="mt-1 text-[10px] text-muted-foreground">
              PDF or common image formats (JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC). Maximum 10 MB.
            </p>

            {errors.invoiceAttachment && (
              <p className="mt-1 text-xs text-destructive">
                {errors.invoiceAttachment}
              </p>
            )}
          </div>

          {/* Optional remarks / explanation */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Remark{" "}
              {isAdminMode
                ? "(optional explanation for Finance)"
                : ""}
            </Label>

            <Textarea
              value={form.remark}
              onChange={(e) =>
                updateField("remark", e.target.value)
              }
              placeholder="Optional remark..."
              rows={2}
              className="mt-1 resize-none border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30"
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
              disabled={
                saving ||
                uploading ||
                !canSubmitDraft
              }
              title={
                canSubmitDraft
                  ? "Submit this expense to Finance for review"
                  : "Complete the required fields to enable submission"
              }
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
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