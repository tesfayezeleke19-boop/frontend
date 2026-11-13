
/**
 * Admin Inventory — read-only oversight of submitted monthly inventory
 * reports from the shared Finance/Sales repository.
 *
 * Aggregate types and quantities are dynamic. Historical aggregate names
 * are read from saved report lines, not from the current aggregate types.
 *
 * Admin cannot create, edit, or submit inventory reports.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ShieldCheck } from "lucide-react";
import {
  monthlyInventoryReportsRepository,
  periodLabel,
  type MonthlyInventoryReport,
} from "@/services/finance/monthlyInventoryReports";
import { formatDate } from "@/services/sales/format";

const selectTriggerClass =
  "h-9 w-[220px] border-input bg-popover text-sm text-foreground";

interface InventoryLine {
  id?: string;
  aggregateTypeId: string | null;
  aggregateName: string;
  quantity: number;
  isLegacy: boolean;
}

interface RawInventoryLine {
  id?: string | number | null;
  aggregateTypeId?: string | number | null;
  aggregate_type_id?: string | number | null;
  aggregateName?: string;
  aggregate_name?: string;
  aggregate?: string;
  quantity?: number | string;
  unsold_quantity?: number | string;
  isLegacy?: boolean;
  is_legacy?: boolean;
}

interface RawInventoryReport {
  quantities?: unknown;
  aggregate_lines?: unknown;
  aggregateLines?: unknown;
  [key: string]: unknown;
}

/**
 * Converts a dynamic line returned by the backend into a consistent
 * frontend inventory line.
 */
function mapInventoryLine(raw: RawInventoryLine): InventoryLine {
  const typeId =
    raw.aggregateTypeId ??
    raw.aggregate_type_id ??
    null;

  const name =
    raw.aggregateName ??
    raw.aggregate_name ??
    raw.aggregate ??
    (typeId !== null
      ? `Aggregate ${typeId}`
      : "Historical Aggregate");

  return {
    id: raw.id != null ? String(raw.id) : undefined,
    aggregateTypeId: typeId != null ? String(typeId) : null,
    aggregateName: String(name),
    quantity: Number(raw.quantity ?? raw.unsold_quantity ?? 0),
    isLegacy:
      raw.isLegacy ??
      raw.is_legacy ??
      (typeId === null),
  };
}

/**
 * Supports both the new dynamic API response and old historical reports.
 *
 * New format:
 * quantities: [
 *   { aggregateTypeId, aggregateName, quantity }
 * ]
 *
 * Alternative format:
 * aggregate_lines: [...]
 *
 * Legacy format:
 * quantities: { "00": 10, "01": 20, "02": 30 }
 */
function getReportLines(report: MonthlyInventoryReport): InventoryLine[] {
  const rawReport = report as unknown as RawInventoryReport;

  const rawQuantities = rawReport.quantities;

  // New dynamic quantities array.
  if (Array.isArray(rawQuantities)) {
    return rawQuantities.map((line) =>
      mapInventoryLine(line as RawInventoryLine),
    );
  }

  // Alternative dynamic aggregate_lines response.
  const aggregateLines =
    rawReport.aggregate_lines ?? rawReport.aggregateLines;

  if (Array.isArray(aggregateLines)) {
    return aggregateLines.map((line) =>
      mapInventoryLine(line as RawInventoryLine),
    );
  }

  // Legacy reports with fixed 00/01/02 quantities.
  if (
    rawQuantities !== null &&
    typeof rawQuantities === "object"
  ) {
    const legacyQuantities = rawQuantities as Record<string, unknown>;

    return Object.entries(legacyQuantities).map(
      ([code, quantity]) => ({
        aggregateTypeId: null,
        aggregateName: `Aggregate ${code}`,
        quantity: Number(quantity ?? 0),
        isLegacy: true,
      }),
    );
  }

  return [];
}

/**
 * Creates a stable key for grouping the same aggregate across reports.
 * Dynamic types are grouped by ID. Historical lines are grouped by
 * their saved aggregate name.
 */
function getAggregateKey(line: InventoryLine): string {
  return line.aggregateTypeId !== null
    ? `type-${line.aggregateTypeId}`
    : `legacy-${line.aggregateName}`;
}

export default function AdminInventoryReports() {
  const [reports, setReports] = useState<MonthlyInventoryReport[] | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState("");

  useEffect(() => {
    let active = true;

    const load = () => {
      monthlyInventoryReportsRepository
        .getSubmittedReports()
        .then((data) => {
          if (!active) return;

          setReports(data);
          setLoading(false);

          setSelectedPeriod((current) =>
            current && data.some((report) => report.period === current)
              ? current
              : data[0]?.period ?? "",
          );
        })
        .catch(() => {
          if (active) {
            setLoading(false);
          }
        });
    };

    load();

    const unsubscribe = monthlyInventoryReportsRepository.subscribe(load);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const selected = useMemo(
    () =>
      reports?.find((report) => report.period === selectedPeriod) ?? null,
    [reports, selectedPeriod],
  );

  const selectedLines = useMemo(
    () => (selected ? getReportLines(selected) : []),
    [selected],
  );

  /**
   * Build the aggregate columns for report history dynamically.
   * This means adding another aggregate type does not require changing
   * this page.
   */
  const aggregateColumns = useMemo(() => {
    const columns = new Map<string, string>();

    (reports ?? []).forEach((report) => {
      getReportLines(report).forEach((line) => {
        const key = getAggregateKey(line);

        if (!columns.has(key)) {
          columns.set(key, line.aggregateName);
        }
      });
    });

    return Array.from(columns.entries()).map(([key, name]) => ({
      key,
      name,
    }));
  }, [reports]);

  /**
   * Calculate the quantity for one aggregate in one report.
   */
  const getReportQuantity = (
    report: MonthlyInventoryReport,
    aggregateKey: string,
  ): number => {
    const line = getReportLines(report).find(
      (item) => getAggregateKey(item) === aggregateKey,
    );

    return line?.quantity ?? 0;
  };

  if (loading && !reports) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Monthly Inventory Reports
          </h1>

        </div>

        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
          <ShieldCheck className="size-3.5" />
          Read-only
        </span>
      </div>

      {/* Reporting month */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={selectedPeriod}
          onValueChange={setSelectedPeriod}
          disabled={!reports || reports.length === 0}
        >
          <SelectTrigger className={selectTriggerClass}>
            <SelectValue placeholder="Reporting month" />
          </SelectTrigger>

          <SelectContent className="border-input bg-popover">
            {(reports ?? []).map((report) => (
              <SelectItem
                key={report.period}
                value={report.period}
                className="text-sm text-foreground focus:bg-accent"
              >
                {periodLabel(report.period)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selected && (
          <Badge
            variant="outline"
            className="border erp-badge-approved text-[10px] font-medium"
          >
            Submitted
          </Badge>
        )}
      </div>

      {/* Selected report */}
      {selected ? (
        <>
          <p className="text-sm font-medium text-foreground">
            Reporting month: {periodLabel(selected.period)}
          </p>

          {/* Dynamic aggregate quantities */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Unsold Aggregate Quantities
              </CardTitle>
            </CardHeader>

            <CardContent className="p-0">
              {selectedLines.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                        <th className="px-4 py-2.5 font-medium">
                          Aggregate Type
                        </th>

                        <th className="px-4 py-2.5 text-right font-medium">
                          Unsold Quantity (m³)
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {selectedLines.map((line, index) => (
                        <tr
                          key={
                            line.id ??
                            `${getAggregateKey(line)}-${index}`
                          }
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <span>{line.aggregateName}</span>

                              {line.isLegacy && (
                                <Badge
                                  variant="outline"
                                  className="border-border text-[9px] text-muted-foreground"
                                >
                                  Historical
                                </Badge>
                              )}
                            </div>
                          </td>

                          <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                            {line.quantity.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No aggregate quantities are available for this report.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Optional remarks */}
          {selected.remarks && (
            <Card className="border-border bg-card shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-foreground">
                  Remarks
                </CardTitle>
              </CardHeader>

              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {selected.remarks}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Submission details */}
          <p className="font-mono text-[10px] text-muted-foreground/70">
            Submitted{" "}
            {selected.submittedAt
              ? formatDate(selected.submittedAt, { time: true })
              : "—"}
            {selected.submittedByName
              ? ` · by ${selected.submittedByName}`
              : ""}
          </p>
        </>
      ) : (
        <Card className="border-border bg-card shadow-none">
          <CardContent className="py-14 text-center">
            <p className="text-sm text-muted-foreground">
              No submitted Inventory Report for this month.
            </p>

            <p className="mt-1 text-xs text-muted-foreground/70">
              Reports appear here once Finance submits them.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Submitted report history */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Submitted Reports ({reports?.length ?? 0})
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          {reports && reports.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">
                      Reporting Month
                    </th>

                    {aggregateColumns.map((aggregate) => (
                      <th
                        key={aggregate.key}
                        className="px-4 py-2.5 text-right font-medium"
                      >
                        {aggregate.name} (m³)
                      </th>
                    ))}

                    <th className="px-4 py-2.5 font-medium">
                      Submitted
                    </th>

                  </tr>
                </thead>

                <tbody>
                  {reports.map((report) => (
                    <tr
                      key={report.id}
                      className={`border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03] ${
                        report.period === selectedPeriod
                          ? "bg-accent/60"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground">
                        {periodLabel(report.period)}
                      </td>

                      {aggregateColumns.map((aggregate) => (
                        <td
                          key={aggregate.key}
                          className="px-4 py-2.5 text-right tabular-nums text-muted-foreground"
                        >
                          {getReportQuantity(
                            report,
                            aggregate.key,
                          ).toLocaleString()}
                        </td>
                      ))}

                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {report.submittedAt
                          ? formatDate(report.submittedAt)
                          : "—"}
                      </td>

                      
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <p className="text-sm font-medium text-foreground">
                No monthly reports submitted yet.
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Submitted Finance reports will appear here.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
