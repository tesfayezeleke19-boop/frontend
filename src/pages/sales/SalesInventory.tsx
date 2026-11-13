
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  User,
} from "lucide-react";

import {
  salesApi,
  FinanceApiError,
  type SalesMonthlyInventoryReport,
} from "@/services/finance/api";

// =====================================================
// TYPES
// =====================================================

interface InventoryLine {
  id?: string;
  aggregateTypeId: string | null;
  aggregateName: string;
  quantity: number;
  isLegacy: boolean;
}

interface InventorySummary {
  key: string;
  name: string;
  total: number;
}

// =====================================================
// HELPERS
// =====================================================

const ETHIOPIAN_MONTHS = [
  "Meskerem",
  "Tikimt",
  "Hidar",
  "Tahsas",
  "Tir",
  "Yekatit",
  "Megabit",
  "Miazia",
  "Ginbot",
  "Sene",
  "Hamle",
  "Nehase",
  "Pagume",
];

function formatMonth(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);

  if (!match) {
    return period;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 13) {
    return period;
  }

  return `${ETHIOPIAN_MONTHS[month - 1]} ${year}`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const ethiopianDate = new Intl.DateTimeFormat(
    "en-ET-u-ca-ethiopic-nu-latn",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Africa/Addis_Ababa",
    },
  ).format(date);

  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Africa/Addis_Ababa",
  }).format(date);

  return `${ethiopianDate}, ${time}`;
}

function formatQuantity(value: number): string {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });
}

function getRecord(value: unknown): Record<string, unknown> {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as Record<string, unknown>;
  }

  return {};
}

/**
 * Reads both the new dynamic API format and the old
 * legacy format.
 *
 * New format:
 * quantities: [
 *   {
 *     aggregateTypeId: "1",
 *     aggregateName: "General Aggregate",
 *     quantity: 12
 *   }
 * ]
 *
 * Legacy format:
 * quantities: {
 *   "00": 12,
 *   "01": 13,
 *   "02": 14
 * }
 */
function getReportLines(
  report: SalesMonthlyInventoryReport,
): InventoryLine[] {
  const rawReport = getRecord(report as unknown);
  const rawQuantities = rawReport.quantities;

  const rawLines = Array.isArray(rawQuantities)
    ? rawQuantities
    : Array.isArray(rawReport.aggregate_lines)
      ? rawReport.aggregate_lines
      : null;

  if (rawLines) {
    return rawLines.map((item, index) => {
      const line = getRecord(item);

      const typeId =
        line.aggregateTypeId ??
        line.aggregate_type_id ??
        null;

      const name =
        line.aggregateName ??
        line.aggregate_name ??
        line.name ??
        (typeId !== null
          ? `Aggregate ${String(typeId)}`
          : "Legacy Aggregate");

      const quantity = Number(
        line.quantity ??
        line.unsoldQuantity ??
        line.unsold_quantity ??
        0,
      );

      return {
        id: String(line.id ?? index),
        aggregateTypeId:
          typeId === null || typeId === undefined
            ? null
            : String(typeId),
        aggregateName: String(name),
        quantity: Number.isFinite(quantity) ? quantity : 0,
        isLegacy:
          Boolean(line.isLegacy ?? line.is_legacy) ||
          typeId === null ||
          typeId === undefined,
      };
    });
  }

  // Backward compatibility for reports using the old
  // fixed aggregate quantity object.
  const legacyQuantities = getRecord(rawQuantities);

  return Object.entries(legacyQuantities).map(
    ([code, value]) => {
      const quantity = Number(value ?? 0);

      return {
        aggregateTypeId: null,
        aggregateName: `Aggregate ${code}`,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        isLegacy: true,
      };
    },
  );
}

function getLineKey(line: InventoryLine): string {
  if (line.aggregateTypeId) {
    return `type-${line.aggregateTypeId}`;
  }

  return `legacy-${line.aggregateName}`;
}

// =====================================================
// COMPONENT
// =====================================================

export default function SalesInventory() {
  const [reports, setReports] = useState<
    SalesMonthlyInventoryReport[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedPeriod, setSelectedPeriod] =
    useState<string>("all");

  // ---------------------------------------------------
  // LOAD REPORTS
  // ---------------------------------------------------

  const loadReports = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const result = await salesApi.monthlyInventoryReports();

      const safeReports = Array.isArray(result)
        ? result
        : [];

      setReports(
        [...safeReports].sort((a, b) =>
          b.period.localeCompare(a.period),
        ),
      );
    } catch (err) {
      console.error("Sales inventory reports error:", err);

      if (err instanceof FinanceApiError) {
        if (err.status === 401) {
          setError(
            "Your session has expired or is invalid. Please sign in again.",
          );
        } else if (err.status === 403) {
          setError(
            "Your account is not authorized to view Sales inventory reports.",
          );
        } else {
          setError(err.message);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Unable to load monthly inventory reports.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // ---------------------------------------------------
  // INITIAL LOAD
  // ---------------------------------------------------

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  // ---------------------------------------------------
  // AVAILABLE PERIODS
  // ---------------------------------------------------

  const periods = useMemo(() => {
    return Array.from(
      new Set(reports.map((report) => report.period)),
    ).sort((a, b) => b.localeCompare(a));
  }, [reports]);

  // ---------------------------------------------------
  // FILTER REPORTS
  // ---------------------------------------------------

  const filteredReports = useMemo(() => {
    if (selectedPeriod === "all") {
      return reports;
    }

    return reports.filter(
      (report) => report.period === selectedPeriod,
    );
  }, [reports, selectedPeriod]);

  // ---------------------------------------------------
  // DYNAMIC INVENTORY LINES
  // ---------------------------------------------------

  const reportLines = useMemo(() => {
    return filteredReports.map((report) => ({
      report,
      lines: getReportLines(report),
    }));
  }, [filteredReports]);

  // ---------------------------------------------------
  // DYNAMIC SUMMARY TOTALS
  // ---------------------------------------------------

  const totals = useMemo(() => {
    const summary = new Map<string, InventorySummary>();

    reportLines.forEach(({ lines }) => {
      lines.forEach((line) => {
        const key = getLineKey(line);
        const existing = summary.get(key);

        if (existing) {
          existing.total += line.quantity;
        } else {
          summary.set(key, {
            key,
            name: line.aggregateName,
            total: line.quantity,
          });
        }
      });
    });

    return Array.from(summary.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [reportLines]);

  // ===================================================
  // RENDER
  // ===================================================

  return (
    <div className="space-y-5 bg-background text-foreground">

      {/* PAGE HEADER */}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Sales Inventory
          </h1>

          <p className="mt-1 text-sm text-muted-foreground">
            Published monthly unsold-aggregate reports from Finance.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadReports(true)}
          disabled={loading || refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            className={`size-4 ${
              refreshing ? "animate-spin" : ""
            }`}
          />

          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* LOADING */}

      {loading && (
        <Card className="border-border bg-card shadow-none">
          <CardContent className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin text-primary" />
            Loading monthly inventory reports...
          </CardContent>
        </Card>
      )}

      {/* ERROR */}

      {!loading && error && (
        <Card className="border-destructive/30 bg-destructive/5 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertCircle className="size-4" />
              Unable to load inventory reports
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>{error}</p>

            <button
              type="button"
              onClick={() => void loadReports()}
              className="inline-flex items-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
            >
              <RefreshCw className="size-4" />
              Try again
            </button>
          </CardContent>
        </Card>
      )}

      {/* CONTENT */}

      {!loading && !error && (
        <>
          {/* SUMMARY CARDS */}

          {totals.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {totals.map((item) => (
                <Card
                  key={item.key}
                  className="border-border bg-card shadow-none transition-colors"
                >
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        {item.name}
                      </p>

                      <Database className="size-4 text-primary" />
                    </div>

                    <p className="mt-3 text-2xl font-semibold text-foreground">
                      {formatQuantity(item.total)}
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Total unsold quantity
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* REPORT FILTER */}

          <Card className="border-border bg-card shadow-none">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-primary" />

                <span className="text-sm font-medium text-foreground">
                  Monthly Reports
                </span>

                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {reports.length}
                </span>
              </div>

              <select
                value={selectedPeriod}
                onChange={(event) =>
                  setSelectedPeriod(event.target.value)
                }
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:ring-2 focus:ring-ring sm:w-56"
              >
                <option value="all">
                  All available months
                </option>

                {periods.map((period) => (
                  <option key={period} value={period}>
                    {formatMonth(period)}
                  </option>
                ))}
              </select>
            </CardContent>
          </Card>

          {/* EMPTY STATE */}

          {filteredReports.length === 0 && (
            <Card className="border-border bg-card shadow-none">
              <CardContent className="flex flex-col items-center justify-center py-14 text-center">
                <div className="mb-4 rounded-full bg-muted p-4">
                  <FileText className="size-7 text-muted-foreground" />
                </div>

                <h3 className="text-base font-medium text-foreground">
                  No published inventory reports
                </h3>

                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Finance has not published any monthly inventory
                  reports yet, or there are no reports for the
                  selected month.
                </p>
              </CardContent>
            </Card>
          )}

          {/* REPORT LIST */}

          <div className="space-y-4">
            {reportLines.map(({ report, lines }) => (
              <Card
                key={report.id}
                className="border-border bg-card shadow-none"
              >
                <CardHeader className="border-b border-border pb-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold text-foreground">
                        {formatMonth(report.period)}
                      </CardTitle>

                      <p className="mt-1 text-xs text-muted-foreground">
                        Reporting period: {formatMonth(report.period)}
                      </p>
                    </div>

                    <span
                      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                        report.status === "CORRECTED"
                          ? "bg-muted text-muted-foreground"
                          : "bg-primary/10 text-primary"
                      }`}
                    >
                      <CheckCircle2 className="size-3.5" />

                      {report.status === "CORRECTED"
                        ? "Corrected"
                        : "Submitted"}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5 pt-5">

                  {/* DYNAMIC QUANTITIES */}

                  {lines.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {lines.map((line, index) => (
                        <div
                          key={`${report.id}-${getLineKey(line)}-${index}`}
                          className="rounded-lg border border-border bg-muted/40 p-4 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">
                              {line.aggregateName}
                            </p>

                            {line.isLegacy && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                Historical
                              </span>
                            )}
                          </div>

                          <p className="mt-2 text-xl font-semibold text-foreground">
                            {formatQuantity(line.quantity)}
                          </p>

                          <p className="mt-1 text-xs text-muted-foreground">
                            Unsold quantity (m³)
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                      No aggregate quantities are available for this report.
                    </p>
                  )}

                  {/* REMARKS */}

                  {report.remarks && (
                    <div className="rounded-lg border border-border bg-muted/40 p-4">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Finance Remarks
                      </p>

                      <p className="whitespace-pre-wrap text-sm text-foreground">
                        {report.remarks}
                      </p>
                    </div>
                  )}

                  {/* REPORT METADATA */}

                  <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
                    <div className="flex items-start gap-2">
                      <User className="mt-0.5 size-4 text-muted-foreground" />

                      <div>
                        <p className="text-xs text-muted-foreground">
                          Submitted by
                        </p>

                        <p className="mt-1 text-sm text-foreground">
                          {report.submittedByName || "Finance"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <CalendarDays className="mt-0.5 size-4 text-muted-foreground" />

                      <div>
                        <p className="text-xs text-muted-foreground">
                          Submitted date
                        </p>

                        <p className="mt-1 text-sm text-foreground">
                          {formatDate(report.submittedAt)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* REVISION INFORMATION */}

                  {report.revisionNumber > 0 && (
                    <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
                      <span className="text-xs text-muted-foreground">
                        Revision number
                      </span>

                      <span className="text-xs font-semibold text-foreground">
                        {report.revisionNumber}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* FOOTER */}

          {reports.length > 0 && (
            <div className="flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <Database className="size-3.5" />

              Showing Finance-published inventory reports from
              the backend.
            </div>
          )}
        </>
      )}
    </div>
  );
}
