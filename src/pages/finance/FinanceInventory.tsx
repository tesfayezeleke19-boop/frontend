
/**
 * Finance Inventory — Monthly Inventory Report form.
 *
 * Aggregate types are loaded dynamically from Admin Operational Settings.
 * Finance records actual remaining unsold quantities (m³).
 *
 * New reports use Ethiopian reporting periods.
 * Historical Gregorian reports remain visible and read-only.
 * Historical aggregate names and quantities are preserved as snapshots.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";
import {
  History,
  Loader2,
  PenLine,
  Save,
  Send,
} from "lucide-react";

import {
  MONTHLY_REPORT_STATUS,
  monthlyInventoryReportsRepository,
  listEligiblePeriods,
  periodLabel,
  validateQuantitiesForSubmit,
  type AggregateType,
  type MonthlyInventoryReport,
  type MonthlyQuantityInput,
  type PeriodCompleteness,
} from "@/services/finance/monthlyInventoryReports";

import { formatDate } from "@/services/sales/format";

const inputClass =
  "h-9 border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30";

const selectTriggerClass =
  "h-9 w-full border-input bg-popover text-sm text-foreground sm:w-[220px]";

const STATUS_UI: Record<
  PeriodCompleteness,
  { label: string; className: string }
> = {
  MISSING: {
    label: "Not reported yet",
    className: "erp-badge-draft",
  },
  DRAFT: {
    label: "Draft",
    className: "erp-badge-pending",
  },
  SUBMITTED: {
    label: "Submitted",
    className: "erp-badge-approved",
  },
};

interface FormState {
  quantities: Record<string, string>;
  remarks: string;
}

const emptyFormState: FormState = {
  quantities: {},
  remarks: "",
};

/**
 * Display historical reports using their original Gregorian month.
 * New reports use Ethiopian month names.
 */
function reportPeriodLabel(report: MonthlyInventoryReport): string {
  if (report.periodType === "LEGACY_GREGORIAN") {
    const [year, month] = report.period.split("-").map(Number);

    const date = new Date(Date.UTC(year, month - 1, 1));

    const label = new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);

    return `${label} (Legacy)`;
  }

  return periodLabel(report.period);
}

function validateField(raw: string): string {
  if (raw.trim() === "") {
    return "Required";
  }

  const num = Number(raw);

  if (Number.isNaN(num)) {
    return "Enter a valid number";
  }

  if (!Number.isFinite(num)) {
    return "Must be finite (no infinity)";
  }

  if (num < 0) {
    return "Cannot be negative";
  }

  return "";
}

function formatQuantity(value: number): string {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });
}

export default function FinanceInventoryPage() {
  // New reporting periods use the Ethiopian calendar.
  const periods = useMemo(() => listEligiblePeriods(), []);

  const [selectedPeriod, setSelectedPeriod] = useState<string>(
    () => periods[0] ?? "",
  );

  const [reports, setReports] = useState<MonthlyInventoryReport[] | null>(
    null,
  );

  const [aggregateTypes, setAggregateTypes] = useState<AggregateType[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(emptyFormState);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(
    {},
  );

  const [remarksError, setRemarksError] = useState("");

  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);

  const [confirmSubmit, setConfirmSubmit] = useState(false);

  /**
   * Load reports and active aggregate types together.
   *
   * Aggregate types are provided by Admin Operational Settings through
   * the Finance monthly inventory aggregate-types endpoint.
   */
  const refresh = useCallback(async () => {
    try {
      const [reportData, aggregateTypeData] = await Promise.all([
        monthlyInventoryReportsRepository.getReports(),
        monthlyInventoryReportsRepository.getAggregateTypes(),
      ]);

      setReports(reportData);
      setAggregateTypes(aggregateTypeData);

      setLoadError(null);
    } catch (e: unknown) {
      setLoadError(
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    const unsubscribe =
      monthlyInventoryReportsRepository.subscribe(refresh);

    return () => unsubscribe();
  }, [refresh]);

  const selectedReport = useMemo(
    () =>
      reports?.find((report) => report.period === selectedPeriod) ?? null,
    [reports, selectedPeriod],
  );

  const isLegacyReport =
    selectedReport?.periodType === "LEGACY_GREGORIAN";

  const isSubmitted =
    selectedReport?.status === MONTHLY_REPORT_STATUS.SUBMITTED;

  // Historical Gregorian reports are read-only.
  const isReadOnly = Boolean(isLegacyReport);

  /**
   * Initialize form quantities from the selected report.
   *
   * Existing dynamic quantities are matched by aggregate type ID.
   * Newly added active types start empty.
   *
   * Legacy codes are deliberately not mapped to current aggregate IDs.
   */
  const loadKey = [
    selectedPeriod,
    selectedReport?.updatedAt ?? "none",
    aggregateTypes.map((type) => type.id).join(","),
  ].join(":");

  useEffect(() => {
    const quantities: Record<string, string> = {};

    for (const type of aggregateTypes) {
      const existing = selectedReport?.quantities.find(
        (item) => item.aggregateTypeId === type.id,
      );

      quantities[type.id] =
        existing && !existing.isLegacy
          ? String(existing.quantity)
          : "";
    }

    setForm({
      quantities,
      remarks: selectedReport?.remarks ?? "",
    });

    setFieldErrors({});
    setRemarksError("");

    // loadKey controls when the selected report or aggregate types change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);

  const updateQuantity = (aggregateTypeId: string, value: string) => {
    setForm((previous) => ({
      ...previous,
      quantities: {
        ...previous.quantities,
        [aggregateTypeId]: value,
      },
    }));

    setFieldErrors((previous) => {
      if (!previous[aggregateTypeId]) {
        return previous;
      }

      const next = { ...previous };
      delete next[aggregateTypeId];

      return next;
    });
  };

  const updateRemarks = (value: string) => {
    setForm((previous) => ({
      ...previous,
      remarks: value,
    }));

    setRemarksError("");
  };

  /**
   * Validate every active aggregate type.
   *
   * Every active type must have a quantity before saving or submitting.
   */
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    for (const type of aggregateTypes) {
      const error = validateField(
        form.quantities[type.id] ?? "",
      );

      if (error) {
        errors[type.id] = error;
      }
    }

    if (aggregateTypes.length === 0) {
      toast.error(
        "No active aggregate types are available. Configure aggregate types in Admin Operational Settings first.",
      );

      return false;
    }

    if (form.remarks.length > 500) {
      setRemarksError("Remarks must be at most 500 characters");
    } else {
      setRemarksError("");
    }

    setFieldErrors(errors);

    return (
      Object.keys(errors).length === 0 &&
      form.remarks.length <= 500
    );
  };

  /**
   * Convert the form into the dynamic API payload.
   *
   * The backend receives aggregate type IDs instead of fixed codes.
   */
  const toQuantities = (): MonthlyQuantityInput[] =>
    aggregateTypes.map((type) => ({
      aggregateTypeId: type.id,
      quantity: Number(form.quantities[type.id]),
    }));

  const handleSaveDraft = async () => {
    if (isReadOnly) {
      toast.error(
        "Historical Gregorian reports cannot be edited here.",
      );
      return;
    }

    if (!validateForm()) {
      toast.error("Fix the highlighted fields before saving");
      return;
    }

    setBusy("draft");

    try {
      await monthlyInventoryReportsRepository.saveDraft(
        selectedPeriod,
        toQuantities(),
        form.remarks,
      );

      toast.success(
        `Draft saved for ${periodLabel(selectedPeriod)}`,
      );

      await refresh();
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : "Failed to save draft",
      );
    } finally {
      setBusy(null);
    }
  };

  const runSubmit = async () => {
    if (isReadOnly) {
      toast.error(
        "Historical Gregorian reports cannot be edited here.",
      );

      setConfirmSubmit(false);
      return;
    }

    if (!validateForm()) {
      toast.error("Fix the highlighted fields before submitting");
      setConfirmSubmit(false);
      return;
    }

    const quantities = toQuantities();

    const validation = validateQuantitiesForSubmit(quantities);

    if (!validation.valid) {
      toast.error(validation.errors[0]);
      setConfirmSubmit(false);
      return;
    }

    setBusy("submit");

    try {
      if (isSubmitted) {
        await monthlyInventoryReportsRepository.correctSubmittedReport(
          selectedPeriod,
          quantities,
          form.remarks,
        );

        toast.success(
          `Correction recorded for ${periodLabel(selectedPeriod)} — previous submitted values are kept in the report history`,
        );
      } else {
        await monthlyInventoryReportsRepository.submitReport(
          selectedPeriod,
          quantities,
          form.remarks,
        );

        toast.success(
          `Monthly report for ${periodLabel(selectedPeriod)} submitted — now visible to Sales and Admin`,
        );
      }

      setConfirmSubmit(false);

      await refresh();
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : "Failed to submit report",
      );
    } finally {
      setBusy(null);
    }
  };

  if (loading && !reports) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm font-medium text-foreground">
          Unable to load monthly inventory reports.
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          {loadError}
        </p>

        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          className="mt-4 border-input text-foreground"
        >
          Retry
        </Button>
      </div>
    );
  }

  // Keep all reports, including historical Gregorian reports.
  const historyReports = [...(reports ?? [])].sort(
    (a, b) =>
      (b.updatedAt ?? b.createdAt ?? 0) -
      (a.updatedAt ?? a.createdAt ?? 0),
  );

  const submittedCount = historyReports.filter(
    (report) =>
      report.status === MONTHLY_REPORT_STATUS.SUBMITTED,
  ).length;

  const selectedStatus: PeriodCompleteness = !selectedReport
    ? "MISSING"
    : isSubmitted
      ? "SUBMITTED"
      : "DRAFT";

  /**
   * Historical lines without a current aggregate type ID are shown
   * separately. This includes old legacy codes and deleted type snapshots.
   */
  const historicalLines =
    selectedReport?.quantities.filter(
      (line) =>
        line.isLegacy ||
        !line.aggregateTypeId ||
        !aggregateTypes.some(
          (type) => type.id === line.aggregateTypeId,
        ),
    ) ?? [];

  return (
    <div className="space-y-5">
      {/* Page heading */}
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Monthly Inventory Report
        </h1>

      </div>

      {/* Section A — Reporting Information */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Section A — Reporting Information
          </CardTitle>
        </CardHeader>

        <CardContent className="p-4">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  Reporting Month
                </Label>

                <Select
                  value={selectedPeriod}
                  onValueChange={(value) => {
                    setSelectedPeriod(value);
                    setFieldErrors({});
                    setRemarksError("");
                  }}
                >
                  <SelectTrigger
                    className={`${selectTriggerClass} mt-1`}
                  >
                    <SelectValue placeholder="Select a reporting month" />
                  </SelectTrigger>

                  <SelectContent className="border-input bg-popover">
                    {periods.map((period) => {
                      const existing = reports?.find(
                        (report) => report.period === period,
                      );

                      const status: PeriodCompleteness = !existing
                        ? "MISSING"
                        : existing.status ===
                            MONTHLY_REPORT_STATUS.SUBMITTED
                          ? "SUBMITTED"
                          : "DRAFT";

                      return (
                        <SelectItem
                          key={period}
                          value={period}
                          className="text-sm text-foreground focus:bg-accent"
                        >
                          {periodLabel(period)}
                          {status !== "MISSING" &&
                            ` — ${STATUS_UI[status].label}`}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  Status
                </Label>

                <div className="mt-1 flex h-9 items-center">
                  <Badge
                    variant="outline"
                    className={`border text-[10px] font-medium ${
                      STATUS_UI[selectedStatus].className
                    }`}
                  >
                    {STATUS_UI[selectedStatus].label}
                  </Badge>
                </div>
              </div>
            </div>

            {isReadOnly && (
              <p className="text-xs text-muted-foreground">
                This is a historical Gregorian report. It is preserved for
                reference and cannot be edited through the Ethiopian
                reporting workflow.
              </p>
            )}

            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Remarks{" "}
                <span className="text-muted-foreground/70">(optional)</span>
              </Label>

              <Textarea
                value={form.remarks}
                onChange={(event) =>
                  updateRemarks(event.target.value)
                }
                placeholder="Notes such as month-end observations or clarifications about aggregate availability..."
                rows={2}
                disabled={busy !== null || isReadOnly}
                className={`mt-1 resize-none border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 ${
                  remarksError ? "border-destructive" : ""
                }`}
              />

              <div className="flex items-center justify-between">
                {remarksError ? (
                  <p className="mt-1 text-xs text-destructive">
                    {remarksError}
                  </p>
                ) : (
                  <span />
                )}

                <span className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                  {form.remarks.length}/500
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section B — Dynamic Aggregate Quantities */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Section B — Unsold Aggregate Quantities (m³)
          </CardTitle>

          {isSubmitted && (
            <p className="text-xs text-muted-foreground">
              Submitted{" "}
              {selectedReport?.submittedAt
                ? formatDate(selectedReport.submittedAt, {
                    time: true,
                  })
                : ""}
              .
              {!isReadOnly &&
                " A further edit records a correction — previously submitted values stay in the report history."}
            </p>
          )}
        </CardHeader>

        <CardContent className="p-4">
          {aggregateTypes.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {aggregateTypes.map((type) => (
                <div key={type.id}>
                  <Label className="text-xs font-medium text-muted-foreground">
                    {type.name}
                  </Label>

                  <Input
                    type="number"
                    value={form.quantities[type.id] ?? ""}
                    onChange={(event) =>
                      updateQuantity(type.id, event.target.value)
                    }
                    placeholder="0"
                    min="0"
                    step="0.001"
                    disabled={busy !== null || isReadOnly}
                    className={`${inputClass} mt-1 ${
                      fieldErrors[type.id]
                        ? "border-destructive"
                        : ""
                    }`}
                  />

                  {fieldErrors[type.id] ? (
                    <p className="mt-1 text-xs text-destructive">
                      {fieldErrors[type.id]}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      m³
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-input bg-popover p-4">
              <p className="text-sm text-foreground">
                No active aggregate types are available.
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Ask an Admin to configure and activate aggregate types in
                Operational Settings.
              </p>
            </div>
          )}

          {/* Historical aggregate snapshots */}
          {historicalLines.length > 0 && (
            <div className="mt-5 rounded-md border border-input bg-popover p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Historical Aggregate Records
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                These values are preserved using their original saved names.
                They are not automatically matched to current aggregate
                types.
              </p>

              <div className="mt-3 space-y-2">
                {historicalLines.map((line, index) => (
                  <div
                    key={`${line.aggregateTypeId ?? "historical"}-${line.aggregateName}-${index}`}
                    className="flex items-center justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0"
                  >
                    <span className="text-sm text-foreground">
                      {line.aggregateName}
                    </span>

                    <span className="font-mono text-sm tabular-nums text-muted-foreground">
                      {formatQuantity(line.quantity)} m³
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isReadOnly && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                onClick={handleSaveDraft}
                variant="outline"
                disabled={busy !== null || aggregateTypes.length === 0}
                className="gap-2 border-input text-foreground hover:bg-accent"
              >
                {busy === "draft" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save Draft
              </Button>

              <Button
                onClick={() => {
                  if (!validateForm()) {
                    toast.error(
                      "Fix the highlighted fields before submitting",
                    );
                    return;
                  }

                  setConfirmSubmit(true);
                }}
                disabled={busy !== null || aggregateTypes.length === 0}
                className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {busy === "submit" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}

                {isSubmitted
                  ? "Submit Correction"
                  : "Submit Report"}
              </Button>
            </div>
          )}

          {isReadOnly && (
            <p className="mt-4 text-xs text-muted-foreground/70">
              Historical report — read-only.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Report History */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
            <History className="size-4 text-violet" />
            Report History ({submittedCount} submitted)
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          {historyReports.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">
                      Reporting Month
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Aggregate Quantities
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Status
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Submitted
                    </th>

                    <th className="px-4 py-2.5 text-right font-medium">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {historyReports.map((report) => {
                    const submitted =
                      report.status ===
                      MONTHLY_REPORT_STATUS.SUBMITTED;

                    const legacy =
                      report.periodType === "LEGACY_GREGORIAN";

                    return (
                      <tr
                        key={report.id}
                        className={`border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03] ${
                          report.period === selectedPeriod
                            ? "bg-accent/60"
                            : ""
                        }`}
                      >
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {reportPeriodLabel(report)}
                        </td>

                        <td className="min-w-[220px] px-4 py-2.5 text-xs text-muted-foreground">
                          {report.quantities.length > 0 ? (
                            <div className="space-y-1">
                              {report.quantities.map((line, index) => (
                                <div
                                  key={`${line.aggregateTypeId ?? "legacy"}-${line.aggregateName}-${index}`}
                                >
                                  <span className="text-foreground">
                                    {line.aggregateName}
                                  </span>

                                  <span className="ml-2 font-mono tabular-nums">
                                    {formatQuantity(line.quantity)} m³
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>

                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`border text-[10px] font-medium ${
                              STATUS_UI[
                                submitted ? "SUBMITTED" : "DRAFT"
                              ].className
                            }`}
                          >
                            {STATUS_UI[
                              submitted ? "SUBMITTED" : "DRAFT"
                            ].label}
                          </Badge>
                        </td>

                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {submitted && report.submittedAt
                            ? formatDate(report.submittedAt)
                            : "—"}
                        </td>

                        <td className="px-4 py-2.5 text-right">
                          {legacy ? (
                            <span className="text-xs text-muted-foreground/70">
                              Historical
                            </span>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-info"
                              title={
                                submitted
                                  ? "View or correct this submitted report"
                                  : "Continue editing this draft"
                              }
                              onClick={() => {
                                setSelectedPeriod(report.period);
                                setFieldErrors({});
                                setRemarksError("");
                              }}
                            >
                              <PenLine className="size-3" />

                              {submitted
                                ? "View / Correct"
                                : "Edit"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <p className="text-sm font-medium text-foreground">
                No monthly reports yet. Select a reporting month above to
                create your first report.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Submit confirmation */}
      <Dialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
      >
        <DialogContent className="border-input bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">
              {isSubmitted
                ? "Submit Correction"
                : "Submit Monthly Inventory Report"}
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              {isSubmitted
                ? `Submit a correction for ${periodLabel(selectedPeriod)}? Previously submitted values remain available in the report's history.`
                : `Submit the report for ${periodLabel(selectedPeriod)}? It becomes visible to Sales and Admin.`}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmSubmit(false)}
              disabled={busy !== null}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>

            <Button
              onClick={runSubmit}
              disabled={busy !== null}
              className="gap-2 bg-success text-primary-foreground hover:bg-success"
            >
              {busy === "submit" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
