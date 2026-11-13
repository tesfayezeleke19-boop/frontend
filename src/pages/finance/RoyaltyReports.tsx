
import { useMemo, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ScrollText,
  FileText,
  Download,
  CheckCircle2,
  Loader2,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

import { useRoyaltyReportRows } from "@/hooks/use-finance-data";

import {
  formatCurrency,
  formatDate,
  formatQuantity,
} from "@/services/sales/format";

import {
  ROYALTY_BATCH_SIZE,
  ROYALTY_BATCH_STATUS,
  exportRoyaltyRowsToExcel,
  getRoyaltyFilename,
  royaltyBatchesRepository,
} from "@/services/finance/royaltyBatches";

import type {
  RoyaltyBatch,
  RoyaltyExportRow,
} from "@/services/finance/royaltyBatches";

import type {
  FinanceRoyaltyReportRow,
} from "@/services/finance/royaltyReport";

/**
 * The backend is the source of truth for report rows.
 * The backend excludes rows already associated with finalized batches.
 */
type RoyaltyRow = FinanceRoyaltyReportRow;

function toExportRows(rows: RoyaltyRow[]): RoyaltyExportRow[] {
  return rows.map((row) => ({
    date: row.date ?? 0,
    royaltyInvoiceNumber: row.royaltyInvoiceNumber ?? undefined,
    aggregate: row.aggregate,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    lineTotalExclVat: row.lineTotalExclVat,
  }));
}

export default function RoyaltyReports() {
  const {
    data,
    loading,
    error: reportError,
  } = useRoyaltyReportRows();

  const [batches, setBatches] = useState<RoyaltyBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  /**
   * Batch history is loaded from the backend.
   * No batch information is read from localStorage.
   */
  const loadBatches = useCallback(async () => {
    setBatchesLoading(true);
    setBatchesError(null);

    try {
      const result = await royaltyBatchesRepository.getBatches();
      setBatches(result);
    } catch (err: unknown) {
      setBatchesError(
        err instanceof Error
          ? err.message
          : "Unable to load royalty batch history.",
      );
    } finally {
      setBatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  /**
   * The backend has already removed finalized rows.
   * Do not apply a second client-side finalized-key filter.
   */
  const royaltyRows = useMemo<RoyaltyRow[]>(
    () => data ?? [],
    [data],
  );

  const batchCount = royaltyRows.length;
  const isFullBatch = batchCount >= ROYALTY_BATCH_SIZE;

  const totalRoyalty = useMemo(
    () =>
      royaltyRows.reduce(
        (sum, row) => sum + row.royalty,
        0,
      ),
    [royaltyRows],
  );

  const totalPrice = useMemo(
    () =>
      royaltyRows.reduce(
        (sum, row) => sum + row.lineTotalExclVat,
        0,
      ),
    [royaltyRows],
  );

  const nextBatchNumber =
    batches.reduce(
      (maximum, batch) => Math.max(maximum, batch.batchNumber),
      0,
    ) + 1;

  /**
   * Export a snapshot without finalizing or consuming the current rows.
   */
  const handleExportSnapshot = () => {
    if (batchCount === 0 || isExporting) return;

    setActionError(null);
    setActionMessage(null);
    setIsExporting(true);

    try {
      exportRoyaltyRowsToExcel(
        toExportRows(royaltyRows),
        getRoyaltyFilename(nextBatchNumber, true),
      );

      setActionMessage("Royalty report exported successfully.");
    } catch (err: unknown) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Unable to export the royalty report.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  /**
   * Finalize the first 50 rows through the backend.
   *
   * Only after the API confirms finalization do we export the batch and
   * reload batch history. The report hook refreshes through the Finance
   * change notifier after successful finalization.
   */
  const handleFinalizeBatch = async () => {
    if (!isFullBatch || isExporting) return;

    setActionError(null);
    setActionMessage(null);
    setIsExporting(true);

    try {
      const rowsToFinalize = royaltyRows.slice(
        0,
        ROYALTY_BATCH_SIZE,
      );

      const batch = await royaltyBatchesRepository.finalizeBatch(
        rowsToFinalize.map((row) => row.key),
      );

      exportRoyaltyRowsToExcel(
        toExportRows(rowsToFinalize),
        getRoyaltyFilename(batch.batchNumber, false),
      );

      await loadBatches();

      setActionMessage(
        `Batch ${String(batch.batchNumber).padStart(3, "0")} finalized successfully.`,
      );
    } catch (err: unknown) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Unable to finalize the royalty batch.",
      );

      // Refresh history in case the server completed finalization but
      // the client encountered an error afterward.
      await loadBatches();
    } finally {
      setIsExporting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Royalty Reports
        </h1>

      </div>

      {/* Report loading and error messages */}
      {reportError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />

          <div>
            <p className="font-medium">
              Unable to load royalty report rows
            </p>
            <p className="mt-1">{reportError.message}</p>
          </div>
        </div>
      )}

      {batchesError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />

          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Unable to load batch history
            </p>
            <p className="mt-1">{batchesError}</p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadBatches()}
            disabled={batchesLoading}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Action feedback */}
      {actionError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{actionError}</p>
        </div>
      )}

      {actionMessage && (
        <div
          role="status"
          className="rounded-md border border-emerald-900/60 bg-emerald-950/30 p-3 text-sm text-emerald-300"
        >
          {actionMessage}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Card
          className={`shadow-none ${
            isFullBatch
              ? "border-success-border bg-success-soft"
              : "border-border bg-card"
          }`}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Current Royalty Batch
              </span>

              <ScrollText
                className={`size-4 ${
                  isFullBatch
                    ? "text-success"
                    : "text-violet"
                }`}
              />
            </div>

            <div
              className={`mt-2 text-2xl font-bold tabular-nums ${
                isFullBatch
                  ? "text-success"
                  : "text-foreground"
              }`}
            >
              {batchCount} / {ROYALTY_BATCH_SIZE}
            </div>

            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
              {isFullBatch
                ? "Batch ready — finalize to start next"
                : `${Math.max(0, ROYALTY_BATCH_SIZE - batchCount)} more to complete batch`}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Total Approved Sales
              </span>
            </div>

            <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">
              {formatCurrency(totalPrice)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Total Royalty (3%)
              </span>
            </div>

            <div className="mt-2 text-xl font-semibold tabular-nums text-violet">
              {formatCurrency(totalRoyalty)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Completed Batches
              </span>
            </div>

            <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">
              {batchesLoading ? "…" : batches.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Export Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={handleExportSnapshot}
          disabled={
            isExporting ||
            batchCount === 0 ||
            Boolean(reportError)
          }
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isExporting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}

          Export Excel
        </Button>

        {isFullBatch && (
          <Button
            onClick={handleFinalizeBatch}
            disabled={
              isExporting ||
              Boolean(reportError) ||
              Boolean(batchesError)
            }
            className="gap-2 bg-success text-primary-foreground hover:bg-success"
          >
            {isExporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}

            Finalize Batch ({ROYALTY_BATCH_SIZE})
          </Button>
        )}

        <Button
          variant="outline"
          onClick={() => void loadBatches()}
          disabled={batchesLoading}
          className="gap-2"
        >
          {batchesLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}

          Refresh History
        </Button>
      </div>

      {/* Royalty Rows Table */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Current Batch — Eligible Royalty Orders ({batchCount})
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          {royaltyRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">
                      Royalty Invoice Number
                    </th>
                    <th className="px-4 py-2.5 font-medium">
                      Aggregate Type
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Quantity (m³)
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Unit Price
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Total Price
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      3%
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {royaltyRows.map((row) => (
                    <tr
                      key={row.key}
                      className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {row.date == null ? "—" : formatDate(row.date)}
                      </td>

                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          {row.royaltyInvoiceNumber || "—"}

                          {!row.royaltyInvoiceNumber?.trim() && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning-soft px-1.5 py-0.5 text-[9px] font-medium text-warning"
                              title="Royalty Invoice Number is missing. Correct the source record before export."
                            >
                              ⚠ missing no.
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-2.5 text-muted-foreground">
                        {row.aggregate}
                      </td>

                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                        {formatQuantity(row.quantity)}
                      </td>

                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(row.unitPrice)}
                      </td>

                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">
                        {formatCurrency(row.lineTotalExclVat)}
                      </td>

                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-violet">
                        {formatCurrency(row.royalty)}
                      </td>
                    </tr>
                  ))}
                </tbody>

                <tfoot>
                  <tr className="border-t border-border bg-sidebar">
                    <td
                      colSpan={3}
                      className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70"
                    >
                      Totals
                    </td>

                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-foreground">
                      {formatQuantity(
                        royaltyRows.reduce(
                          (sum, row) => sum + row.quantity,
                          0,
                        ),
                      )}
                    </td>

                    <td className="px-4 py-2.5 text-right" />

                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-foreground">
                      {formatCurrency(totalPrice)}
                    </td>

                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-violet">
                      {formatCurrency(totalRoyalty)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              {reportError ? (
                <>
                  <AlertCircle className="mb-3 size-8 text-red-400" />
                  <p className="text-sm font-medium text-foreground">
                    Report data could not be loaded.
                  </p>
                  <p className="mt-1 max-w-md text-xs text-muted-foreground">
                    Check your connection and sign-in session, then retry.
                    No empty report is being treated as a successful API response.
                  </p>
                </>
              ) : (
                <>
                  <FileText className="mb-3 size-8 text-muted-foreground" />

                  <p className="text-sm font-medium text-foreground">
                    No approved sales are currently available for royalty reporting.
                  </p>

                  <p className="mt-1 max-w-xl text-xs text-muted-foreground">
                    Approved Sales Invoice orders and completed Contract
                    Orders appear here when eligible. Rows already finalized
                    into a batch are excluded by the backend.
                  </p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Batch History */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Batch History ({batches.length})
            </CardTitle>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadBatches()}
              disabled={batchesLoading}
              className="gap-2"
            >
              {batchesLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}

              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {batchesLoading && batches.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground/70" />
            </div>
          ) : batches.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">Batch</th>
                    <th className="px-4 py-2.5 font-medium">Records</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Total Sales
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Total Royalty
                    </th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>

                <tbody>
                  {batches.map((batch) => (
                    <tr
                      key={batch.id}
                      className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs font-medium text-foreground">
                        Batch {String(batch.batchNumber).padStart(3, "0")}
                      </td>

                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                        {batch.recordCount}
                      </td>

                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">
                        {formatCurrency(batch.totalSales)}
                      </td>

                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-violet">
                        {formatCurrency(batch.totalRoyalty)}
                      </td>

                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {formatDate(batch.createdAt)}
                      </td>

                      <td className="px-4 py-2.5">
                        <Badge
                          variant="outline"
                          className={`border text-[10px] font-medium ${
                            batch.status === ROYALTY_BATCH_STATUS.FINALIZED
                              ? "erp-badge-approved"
                              : "erp-badge-draft"
                          }`}
                        >
                          {batch.status === ROYALTY_BATCH_STATUS.FINALIZED
                            ? "Finalized"
                            : "Pending"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="mb-3 size-7 text-muted-foreground" />

              <p className="text-sm font-medium text-foreground">
                No royalty batches found.
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Finalized batches will appear here after they are saved by the backend.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
