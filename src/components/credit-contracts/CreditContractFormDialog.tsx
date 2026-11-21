
/**
 * Create / edit a credit contract (Finance only).
 *
 * New paper contract files are held locally until the contract exists.
 * They are then uploaded through the credit-contract-specific endpoint.
 *
 * Only a Draft contract can be edited.
 */

import { useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  CREDIT_CONTRACT_STATUS,
  type CreditContract,
  type CreditContractInput,
} from "@/services/creditContracts/types";

import {
  CONTRACT_ATTACHMENT_ACCEPT,
  validateContractAttachment,
  type ContractAttachment,
} from "@/services/contracts/types";

import { AttachmentViewer } from "@/components/contracts/AttachmentViewer";

import { creditContractsRepository } from "@/services/creditContracts/repository";

import { toast } from "sonner";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Info,
  Loader2,
  Paperclip,
  Trash2,
} from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  initialContract?: CreditContract | null;
}

/* -------------------------------------------------------------------------- */
/* Ethiopian calendar helpers                                                 */
/* -------------------------------------------------------------------------- */

const ETHIOPIAN_EPOCH = 1724221;

const ETHIOPIAN_MONTHS = [
  "Meskerem",
  "Tikimt",
  "Hidar",
  "Tahsas",
  "Tir",
  "Yekatit",
  "Megabit",
  "Miazia",
  "Gnbot",
  "Sene",
  "Hamle",
  "Nehase",
  "Puagme",
];

const ETHIOPIAN_WEEKDAYS = [
  "እሑድ",
  "ሰኞ",
  "ማክሰኞ",
  "ረቡዕ",
  "ሐሙስ",
  "ዓርብ",
  "ቅዳሜ",
];

interface EthiopianDate {
  year: number;
  month: number;
  day: number;
}

function padDate(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Ethiopian leap years have six days in Pagume.
 */
function isEthiopianLeapYear(year: number): boolean {
  return year % 4 === 3;
}

function getEthiopianMonthDays(
  year: number,
  month: number,
): number {
  if (month >= 1 && month <= 12) {
    return 30;
  }

  if (month === 13) {
    return isEthiopianLeapYear(year) ? 6 : 5;
  }

  return 0;
}

/**
 * Convert an Ethiopian date to Julian Day Number.
 */
function ethiopianToJdn(
  year: number,
  month: number,
  day: number,
): number {
  return (
    ETHIOPIAN_EPOCH +
    365 * (year - 1) +
    Math.floor(year / 4) +
    30 * (month - 1) +
    day -
    1
  );
}

/**
 * Convert Julian Day Number to Gregorian date.
 */
function jdnToGregorian(jdn: number): {
  year: number;
  month: number;
  day: number;
} {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);

  const day =
    e - Math.floor((153 * m + 2) / 5) + 1;

  const month = m + 3 - 12 * Math.floor(m / 10);

  const year =
    100 * b + d - 4800 + Math.floor(m / 10);

  return { year, month, day };
}

/**
 * Convert Gregorian date to Julian Day Number.
 */
function gregorianToJdn(
  year: number,
  month: number,
  day: number,
): number {
  const a = Math.floor((14 - month) / 12);

  const y = year + 4800 - a;
  const m = month + 12 * a - 3;

  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/**
 * Convert Gregorian date to Ethiopian date.
 */
function gregorianToEthiopian(
  year: number,
  month: number,
  day: number,
): EthiopianDate {
  const jdn = gregorianToJdn(year, month, day);

  const elapsedDays = jdn - ETHIOPIAN_EPOCH;

  const ethiopianYear = Math.floor(
    (4 * elapsedDays + 1463) / 1461,
  );

  const firstDayOfYear = ethiopianToJdn(
    ethiopianYear,
    1,
    1,
  );

  const dayOfYear = jdn - firstDayOfYear;

  const ethiopianMonth =
    Math.floor(dayOfYear / 30) + 1;

  const ethiopianDay =
    (dayOfYear % 30) + 1;

  return {
    year: ethiopianYear,
    month: ethiopianMonth,
    day: ethiopianDay,
  };
}

/**
 * Convert Ethiopian date to Gregorian ISO date.
 */
function ethiopianToGregorianISO(
  year: number,
  month: number,
  day: number,
): string {
  const jdn = ethiopianToJdn(year, month, day);

  const gregorian = jdnToGregorian(jdn);

  return `${gregorian.year}-${padDate(
    gregorian.month,
  )}-${padDate(gregorian.day)}`;
}

/**
 * Convert a Gregorian ISO date into Ethiopian date.
 */
function isoToEthiopianDate(
  value: string,
): EthiopianDate | null {
  if (!value) {
    return null;
  }

  const parts = value.split("-").map(Number);

  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return null;
  }

  const [year, month, day] = parts;

  const date = new Date(
    Date.UTC(year, month - 1, day),
  );

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return gregorianToEthiopian(year, month, day);
}

/**
 * Preserve the existing Gregorian date format used by the API.
 */
function dateInputValue(ts?: number | string): string {
  if (!ts) {
    return "";
  }

  const date =
    typeof ts === "number"
      ? new Date(ts)
      : new Date(ts);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1,
  )}-${pad(date.getDate())}`;
}

/**
 * Get the weekday position for an Ethiopian calendar date.
 * Sunday = 0, Monday = 1, ... Saturday = 6.
 */
function getEthiopianWeekday(
  year: number,
  month: number,
  day: number,
): number {
  const jdn = ethiopianToJdn(year, month, day);

  return (jdn + 1) % 7;
}

/* -------------------------------------------------------------------------- */
/* Ethiopian calendar picker                                                  */
/* -------------------------------------------------------------------------- */

interface EthiopianDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hasError?: boolean;
}

function EthiopianDatePicker({
  value,
  onChange,
  disabled,
  hasError,
}: EthiopianDatePickerProps) {
  const selectedEthiopianDate = isoToEthiopianDate(value);

  const today = new Date();

  const todayEthiopianDate = gregorianToEthiopian(
    today.getFullYear(),
    today.getMonth() + 1,
    today.getDate(),
  );

  const [calendarOpen, setCalendarOpen] = useState(false);

  const [visibleYear, setVisibleYear] = useState(
    selectedEthiopianDate?.year ??
      todayEthiopianDate.year,
  );

  const [visibleMonth, setVisibleMonth] = useState(
    selectedEthiopianDate?.month ??
      todayEthiopianDate.month,
  );

  const monthName =
    ETHIOPIAN_MONTHS[visibleMonth - 1];

  const daysInMonth = getEthiopianMonthDays(
    visibleYear,
    visibleMonth,
  );

  const firstWeekday = getEthiopianWeekday(
    visibleYear,
    visibleMonth,
    1,
  );

  const calendarDays: Array<number | null> = [
    ...Array.from(
      { length: firstWeekday },
      () => null,
    ),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => index + 1,
    ),
  ];

  const goToPreviousMonth = () => {
    if (visibleMonth === 1) {
      setVisibleMonth(13);
      setVisibleYear((year) => year - 1);
    } else {
      setVisibleMonth((month) => month - 1);
    }
  };

  const goToNextMonth = () => {
    if (visibleMonth === 13) {
      setVisibleMonth(1);
      setVisibleYear((year) => year + 1);
    } else {
      setVisibleMonth((month) => month + 1);
    }
  };

  const handleSelectDate = (day: number) => {
    const gregorianDate = ethiopianToGregorianISO(
      visibleYear,
      visibleMonth,
      day,
    );

    onChange(gregorianDate);
    setCalendarOpen(false);
  };

  const openCalendar = () => {
    if (disabled) {
      return;
    }

    if (selectedEthiopianDate) {
      setVisibleYear(selectedEthiopianDate.year);
      setVisibleMonth(selectedEthiopianDate.month);
    } else {
      setVisibleYear(todayEthiopianDate.year);
      setVisibleMonth(todayEthiopianDate.month);
    }

    setCalendarOpen((previous) => !previous);
  };

  const selectedLabel = selectedEthiopianDate
    ? `${selectedEthiopianDate.day} ${
        ETHIOPIAN_MONTHS[
          selectedEthiopianDate.month - 1
        ]
      } ${selectedEthiopianDate.year}`
    : "ቀን ይምረጡ";

  return (
    <div className="relative mt-1">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={openCalendar}
        className={`h-9 w-full justify-between rounded-md border-input bg-popover px-3 text-sm font-normal text-foreground hover:bg-accent ${
          hasError ? "border-destructive" : ""
        }`}
      >
        <span className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />

          <span>{selectedLabel}</span>
        </span>

        <ChevronRight
          className={`size-4 text-muted-foreground transition-transform ${
            calendarOpen ? "rotate-90" : ""
          }`}
        />
      </Button>

      {calendarOpen && (
        <div className="absolute left-0 top-11 z-50 w-full min-w-[280px] rounded-lg border border-border bg-popover p-3 shadow-xl">
          {/* Calendar header */}
          <div className="mb-3 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={goToPreviousMonth}
              className="size-8"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Button>

            <div className="text-center">
              <div className="text-sm font-semibold text-foreground">
                {monthName} {visibleYear}
              </div>

              <div className="text-[10px] text-muted-foreground">
                የኢትዮጵያ የዘመን አቆጣጠር
              </div>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={goToNextMonth}
              className="size-8"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          {/* Weekday headings */}
          <div className="grid grid-cols-7 gap-1">
            {ETHIOPIAN_WEEKDAYS.map((weekday) => (
              <div
                key={weekday}
                className="flex h-8 items-center justify-center text-[10px] font-medium text-muted-foreground"
              >
                {weekday}
              </div>
            ))}

            {/* Calendar dates */}
            {calendarDays.map((day, index) => {
              if (day === null) {
                return (
                  <div
                    key={`empty-${index}`}
                    className="h-9"
                  />
                );
              }

              const isSelected =
                selectedEthiopianDate?.year ===
                  visibleYear &&
                selectedEthiopianDate?.month ===
                  visibleMonth &&
                selectedEthiopianDate?.day === day;

              const isToday =
                todayEthiopianDate.year === visibleYear &&
                todayEthiopianDate.month === visibleMonth &&
                todayEthiopianDate.day === day;

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleSelectDate(day)}
                  className={`flex h-9 items-center justify-center rounded-md text-xs transition-colors ${
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : isToday
                        ? "border border-primary text-primary"
                        : "text-foreground hover:bg-accent"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Calendar footer */}
          <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setVisibleYear(todayEthiopianDate.year);
                setVisibleMonth(todayEthiopianDate.month);
              }}
              className="h-7 px-2 text-xs text-muted-foreground"
            >
              Today
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCalendarOpen(false)}
              className="h-7 px-2 text-xs"
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Credit contract form                                                        */
/* -------------------------------------------------------------------------- */

export function CreditContractFormDialog({
  open,
  onOpenChange,
  onSaved,
  initialContract,
}: Props) {
  const isEditing = Boolean(
    initialContract &&
      initialContract.status === CREDIT_CONTRACT_STATUS.DRAFT,
  );

  const [customerName, setCustomerName] = useState("");
  const [tin, setTin] = useState("");

  const [contractDate, setContractDate] = useState(
    initialContract
      ? dateInputValue(initialContract.contractDate)
      : "",
  );

  const [remark, setRemark] = useState(
    initialContract?.remark ?? "",
  );

  const [attachments, setAttachments] = useState<
    ContractAttachment[]
  >(initialContract?.attachments ?? []);

  // Files selected in this dialog but not yet uploaded.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // If contract creation succeeds but an attachment upload fails,
  // retain the created draft ID so retrying does not create a duplicate.
  const [createdContract, setCreatedContract] =
    useState<CreditContract | null>(null);

  const [viewingAttachment, setViewingAttachment] =
    useState<ContractAttachment | null>(null);

  const [attachmentError, setAttachmentError] =
    useState<string | null>(null);

  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [busy, setBusy] = useState(false);

  const [errors, setErrors] = useState<
    Record<string, string>
  >({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset form values when opening a different contract.
  const formKey = `${open ? "open" : "closed"}:${
    initialContract?.id ?? "new"
  }:${initialContract?.updatedAt ?? 0}`;

  const [seededKey, setSeededKey] = useState(formKey);

  if (seededKey !== formKey) {
    setSeededKey(formKey);

    setCustomerName(initialContract?.customer.name ?? "");
    setTin(initialContract?.customer.tin ?? "");

    setRemark(initialContract?.remark ?? "");

    setAttachments(initialContract?.attachments ?? []);
    setPendingFiles([]);
    setCreatedContract(null);

    setContractDate(
      initialContract
        ? dateInputValue(initialContract.contractDate)
        : "",
    );

    setAttachmentError(null);
    setErrors({});
    setViewingAttachment(null);
  }

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0 || busy) {
      return;
    }

    const selected = Array.from(files);

    // Validate the complete selection before adding any files.
    for (const file of selected) {
      const validation = validateContractAttachment(file);

      if (!validation.valid) {
        setAttachmentError(
          `${file.name}: ${Object.values(validation.errors)[0]}`,
        );

        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }

        return;
      }
    }

    setAttachmentError(null);

    setPendingFiles((previous) => {
      const existingKeys = new Set(
        previous.map(
          (file) => `${file.name}:${file.size}:${file.lastModified}`,
        ),
      );

      const additions = selected.filter(
        (file) =>
          !existingKeys.has(
            `${file.name}:${file.size}:${file.lastModified}`,
          ),
      );

      return [...previous, ...additions];
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removePendingFile = (fileToRemove: File) => {
    setPendingFiles((previous) =>
      previous.filter((file) => file !== fileToRemove),
    );
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (!customerName.trim()) {
      next.customerName =
        "Customer / Company Name is required";
    }

    if (!tin.trim()) {
      next.tin = "Customer TIN Number is required";
    }

    if (!contractDate) {
      next.contractDate =
        "A valid contract date is required";
    }

    if (attachmentError) {
      next.attachments = attachmentError;
    }

    setErrors(next);

    return Object.keys(next).length === 0;
  };

  const uploadPendingFiles = async (
    contractId: string,
  ): Promise<void> => {
    if (pendingFiles.length === 0) {
      return;
    }

    setUploadingFiles(true);
    setAttachmentError(null);

    let uploadedCount = 0;

    try {
      for (const file of pendingFiles) {
        const uploaded =
          await creditContractsRepository.uploadAttachment(
            contractId,
            file,
          );

        setAttachments((previous) => [
          ...previous,
          uploaded,
        ]);

        setPendingFiles((previous) =>
          previous.filter((item) => item !== file),
        );

        uploadedCount += 1;
      }

      if (uploadedCount > 0) {
        toast.success(
          uploadedCount === 1
            ? "Paper contract file uploaded"
            : `${uploadedCount} paper contract files uploaded`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Attachment upload failed";

      setAttachmentError(message);

      toast.error(
        `The contract was saved, but an attachment could not be uploaded: ${message}`,
      );

      throw error;
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleSubmit = async () => {
    if (busy || uploadingFiles) {
      return;
    }

    if (attachmentError) {
      setErrors((previous) => ({
        ...previous,
        attachments: attachmentError,
      }));

      toast.error(
        "Resolve the attachment error before saving.",
      );

      return;
    }

    if (!validate()) {
      return;
    }

    setBusy(true);

    try {
      const input: CreditContractInput = {
        customerName: customerName.trim(),
        tin: tin.trim(),
        contractDate: new Date(
          `${contractDate}T00:00:00`,
        ).getTime(),
        // Only server attachment metadata is sent here.
        // Newly selected files are uploaded after saving the contract.
        attachments,
        remark: remark.trim() || undefined,
      };

      let savedContract: CreditContract;

      if (isEditing && initialContract) {
        savedContract =
          await creditContractsRepository.updateContract(
            initialContract.id,
            input,
          );
      } else if (createdContract) {
        // Retry path after a contract was created but an attachment
        // upload failed. Update the existing draft instead of creating
        // another contract.
        savedContract =
          await creditContractsRepository.updateContract(
            createdContract.id,
            input,
          );
      } else {
        savedContract =
          await creditContractsRepository.createContract({
            ...input,
            attachments: [],
          });

        setCreatedContract(savedContract);
      }

      // Upload new files only after the contract has a backend ID.
      if (pendingFiles.length > 0) {
        await uploadPendingFiles(savedContract.id);
      }

      toast.success(
        isEditing || createdContract
          ? `${savedContract.contractNumber} updated`
          : `${savedContract.contractNumber} created — activate it to make it available to Sales`,
      );

      onSaved();
      onOpenChange(false);
    } catch (error) {
      // Attachment upload errors are already displayed by
      // uploadPendingFiles. Keep the dialog open so the user can retry.
      if (!(error instanceof Error && attachmentError)) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Credit contract could not be saved",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const isSaving = busy || uploadingFiles;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto border-input bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-semibold text-foreground">
            {isEditing || createdContract
              ? "Edit Credit Contract"
              : "New Credit Contract"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Customer */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Customer / Company Name *
              </Label>

              <Input
                value={customerName}
                onChange={(e) =>
                  setCustomerName(e.target.value)
                }
                placeholder="e.g. Combolcha Cement PLC"
                className={`mt-1 h-9 rounded-md border-input bg-popover text-sm ${
                  errors.customerName
                    ? "border-destructive"
                    : ""
                }`}
              />

              {errors.customerName && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.customerName}
                </p>
              )}
            </div>

            {/* TIN */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Customer TIN Number *
              </Label>

              <Input
                value={tin}
                onChange={(e) => setTin(e.target.value)}
                placeholder="e.g. 0012345678"
                className={`mt-1 h-9 rounded-md border-input bg-popover text-sm ${
                  errors.tin
                    ? "border-destructive"
                    : ""
                }`}
              />

              {errors.tin && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.tin}
                </p>
              )}
            </div>

            {/* Contract date - Ethiopian calendar */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Contract Date *
              </Label>

              <EthiopianDatePicker
                value={contractDate}
                onChange={(value) => {
                  setContractDate(value);

                  setErrors((previous) => {
                    const next = { ...previous };
                    delete next.contractDate;
                    return next;
                  });
                }}
                disabled={isSaving}
                hasError={Boolean(errors.contractDate)}
              />

              {errors.contractDate && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.contractDate}
                </p>
              )}
            </div>

            {/* Remark */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Remark (optional)
              </Label>

              <Input
                value={remark}
                onChange={(e) =>
                  setRemark(e.target.value)
                }
                placeholder="Any additional notes…"
                className="mt-1 h-9 rounded-md border-input bg-popover text-sm"
              />
            </div>
          </div>

          {/* Paper contract attachments */}
          <div className="rounded-lg border border-border bg-sidebar p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium text-foreground">
                  Paper Contract Files
                </div>

                <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                  PDF, JPG, or PNG up to 10 MB each. The
                  signed/scanned agreement is attached to the
                  credit contract.
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  fileInputRef.current?.click()
                }
                disabled={isSaving}
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
                onChange={(e) =>
                  handleFiles(e.target.files)
                }
              />
            </div>

            {attachmentError && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive">
                <span>{attachmentError}</span>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAttachmentError(null);

                    setErrors((previous) => {
                      const next = { ...previous };
                      delete next.attachments;
                      return next;
                    });
                  }}
                  className="h-6 text-xs text-muted-foreground hover:text-foreground"
                >
                  Dismiss
                </Button>
              </div>
            )}

            {attachments.length > 0 || pendingFiles.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className="flex items-center gap-3 rounded-md border border-border bg-card p-2"
                  >
                    <span className="flex size-10 items-center justify-center rounded border border-input bg-popover">
                      <Paperclip className="size-4 text-muted-foreground" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">
                        {attachment.fileName}
                      </div>

                      <div className="font-mono text-[10px] text-muted-foreground/70">
                        {attachment.mimeType || "unknown"} ·{" "}
                        {Math.max(
                          1,
                          Math.round(
                            attachment.fileSize / 1024,
                          ),
                        )}{" "}
                        KB
                      </div>
                    </div>

                    {attachment.fileUrl?.startsWith("/api/") ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setViewingAttachment(attachment)
                        }
                        className="h-7 font-mono text-[10px] uppercase tracking-[0.14em] text-info hover:underline"
                      >
                        View
                      </Button>
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                        Saved
                      </span>
                    )}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setAttachments((previous) =>
                          previous.filter(
                            (item) =>
                              item.id !== attachment.id,
                          ),
                        )
                      }
                      disabled={isSaving}
                      className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                      Remove
                    </Button>
                  </li>
                ))}

                {pendingFiles.map((file) => (
                  <li
                    key={`${file.name}:${file.size}:${file.lastModified}`}
                    className="flex items-center gap-3 rounded-md border border-dashed border-primary/40 bg-card p-2"
                  >
                    <span className="flex size-10 items-center justify-center rounded border border-input bg-popover">
                      <Paperclip className="size-4 text-primary" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">
                        {file.name}
                      </div>

                      <div className="font-mono text-[10px] text-muted-foreground/70">
                        {(file.type || "File")} ·{" "}
                        {Math.max(
                          1,
                          Math.round(file.size / 1024),
                        )}{" "}
                        KB · Waiting to upload
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removePendingFile(file)}
                      disabled={isSaving}
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
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="border-input"
          >
            Cancel
          </Button>

          <Button
            onClick={handleSubmit}
            disabled={
              isSaving ||
              Boolean(attachmentError)
            }
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {uploadingFiles
                  ? "Uploading files…"
                  : "Saving…"}
              </>
            ) : isEditing || createdContract ? (
              "Save Changes"
            ) : (
              "Create Contract"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AttachmentViewer
        evidence={viewingAttachment}
        open={Boolean(viewingAttachment)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setViewingAttachment(null);
          }
        }}
      />
    </Dialog>
  );
}
