import {
  useMemo,
  useState,
  useEffect,
  useCallback,
} from "react";

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
  resolveRoyaltyAmount,
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
 * The backend excludes rows already associated with completed batches.
 *
 * PostgreSQL automatically creates and finalizes batches when 50
 * eligible records have been staged.
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
    royalty: row.royalty,
  }));
}

export default function RoyaltyReports() {
  const {
    data,
    loading,
    error: reportError,
    refresh: refreshRows,
  } = useRoyaltyReportRows();

  const [batches, setBatches] = useState<RoyaltyBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState<string | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [downloadingBatchId, setDownloadingBatchId] = useState<string | null>(
    null,
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  /* ---------------------------------------------------------------- */
  /* Load completed batch history                                     */
  /* ---------------------------------------------------------------- */

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

  /* ---------------------------------------------------------------- */
  /* Refresh report and batch history                                 */
  /* ---------------------------------------------------------------- */

  const handleRefresh = useCallback(async () => {
    setActionError(null);
    setActionMessage(null);

    refreshRows();
    await loadBatches();
  }, [refreshRows, loadBatches]);

  /* ---------------------------------------------------------------- */
  /* Current eligible royalty records                                 */
  /* ---------------------------------------------------------------- */

  /**
   * These are the eligible records that have not yet been included
   * in a completed batch.
   */
  const royaltyRows = useMemo<RoyaltyRow[]>(
    () => data ?? [],
    [data],
  );

  const batchCount = royaltyRows.length;

  const totalRoyalty = useMemo(
    () =>
      royaltyRows.reduce(
        (sum, row) => sum + resolveRoyaltyAmount(row),
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

  /**
   * Used only for the filename of a partial export.
   * PostgreSQL generates actual batch numbers automatically.
   */
  const nextBatchNumber =
    batches.reduce(
      (maximum, batch) => Math.max(maximum, batch.batchNumber),
      0,
    ) + 1;

  /* ---------------------------------------------------------------- */
  /* Export current eligible records                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Export a snapshot of the currently waiting records.
   * This does not change the PostgreSQL pending queue.
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

      setActionMessage(
        "Royalty report exported successfully. The records remain available for automatic batching.",
      );
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

  /* ---------------------------------------------------------------- */
  /* Export one completed historical batch                            */
  /* ---------------------------------------------------------------- */

  /**
   * Download the exact saved records belonging to one completed batch.
   * Does not use current report rows or current page filters.
   */
  const handleDownloadBatch = async (batch: RoyaltyBatch) => {
    if (downloadingBatchId) return;

    setActionError(null);
    setActionMessage(null);
    setDownloadingBatchId(batch.id);

    try {
      const rows = await royaltyBatchesRepository.getBatchRows(batch.id);

      exportRoyaltyRowsToExcel(
        rows,
        getRoyaltyFilename(batch.batchNumber, false),
      );

      setActionMessage(
        `Batch ${String(batch.batchNumber).padStart(3, "0")} exported successfully (${rows.length} records).`,
      );
    } catch (err: unknown) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Unable to export the selected royalty batch.",
      );
    } finally {
      setDownloadingBatchId(null);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Initial loading                                                   */
  /* ---------------------------------------------------------------- */

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Page                                                              */
  /* ---------------------------------------------------------------- */

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Royalty Reports
        </h1>

        <p className="mt-1 text-xs text-muted-foreground">
          Eligible royalty records are automatically grouped into batches
          of 50 by the database.
        </p>
      </div>

      {/* Report Error */}
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

            <p className="mt-1">
              {reportError.message}
            </p>
          </div>
        </div>
      )}

      {/* Batch History Error */}
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

            <p className="mt-1">
              {batchesError}
            </p>
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

      {/* Action Error */}
      {actionError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{actionError}</p>
        </div>
      )}

      {/* Action Message */}
      {actionMessage && (
        <div
          role="status"
          className="rounded-md border border-emerald-900/60 bg-emerald-950/30 p-3 text-sm text-emerald-300"
        >
          {actionMessage}
        </div>
      )}

      {/* Report Refreshing */}
      {loading && data && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" />
          Refreshing eligible royalty records...
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {/* Waiting Records */}
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Records Waiting
              </span>

              <ScrollText className="size-4 text-violet" />
            </div>

            <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">
              {batchCount} / {ROYALTY_BATCH_SIZE}
            </div>

            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
              {batchCount >= ROYALTY_BATCH_SIZE
                ? "Eligible records awaiting database processing"
                : `${ROYALTY_BATCH_SIZE - batchCount} more for the next batch`}
            </div>
          </CardContent>
        </Card>

        {/* Total Sales */}
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Waiting Records Sales
              </span>
            </div>

            <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">
              {formatCurrency(totalPrice)}
            </div>
          </CardContent>
        </Card>

        {/* Total Royalty */}
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Waiting Records Royalty (3%)
              </span>
            </div>

            <div className="mt-2 text-xl font-semibold tabular-nums text-violet">
              {formatCurrency(totalRoyalty)}
            </div>
          </CardContent>
        </Card>

        {/* Completed Batches */}
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

      {/* Export and Refresh Actions */}
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

        <Button
          variant="outline"
          onClick={() => void handleRefresh()}
          disabled={batchesLoading || loading}
          className="gap-2"
        >
          {batchesLoading || loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}

          Refresh Data
        </Button>

        <p className="text-[11px] text-muted-foreground/70">
          PostgreSQL automatically saves every 50 eligible records.
          Exporting does not affect the automatic batch queue.
        </p>
      </div>

      {/* Current Eligible Royalty Records */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Records Waiting for Automatic Batch ({batchCount})
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          {royaltyRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">
                      Date
                    </th>

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
                        {row.date == null
                          ? "—"
                          : formatDate(row.date)}
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
                        {formatCurrency(resolveRoyaltyAmount(row))}
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
                    Check your connection and sign-in session, then
                    retry. No empty report is being treated as a
                    successful API response.
                  </p>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRefresh()}
                    className="mt-4 gap-2"
                  >
                    <RefreshCw className="size-3.5" />
                    Retry
                  </Button>
                </>
              ) : (
                <>
                  <FileText className="mb-3 size-8 text-muted-foreground" />

                  <p className="text-sm font-medium text-foreground">
                    No records are currently waiting for royalty batching.
                  </p>

                  <p className="mt-1 max-w-xl text-xs text-muted-foreground">
                    Eligible Sales Invoice records with Finance Approved
                    or Payment Confirmed status are automatically included.
                    Records already saved into completed batches are
                    excluded from this list.
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
                    <th className="px-4 py-2.5 font-medium">
                      Batch
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Records
                    </th>

                    <th className="px-4 py-2.5 text-right font-medium">
                      Total Sales
                    </th>

                    <th className="px-4 py-2.5 text-right font-medium">
                      Total Royalty
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Created
                    </th>

                    <th className="px-4 py-2.5 font-medium">
                      Status
                    </th>

                    <th className="px-4 py-2.5 text-right font-medium">
                      Export
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {batches.map((batch) => (
                    <tr
                      key={batch.id}
                      className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs font-medium text-foreground">
                        Batch{" "}
                        {String(batch.batchNumber).padStart(3, "0")}
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
                            batch.status ===
                            ROYALTY_BATCH_STATUS.FINALIZED
                              ? "erp-badge-approved"
                              : "erp-badge-draft"
                          }`}
                        >
                          {batch.status ===
                          ROYALTY_BATCH_STATUS.FINALIZED
                            ? "Finalized"
                            : "Pending"}
                        </Badge>
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void handleDownloadBatch(batch)
                          }
                          disabled={
                            downloadingBatchId === batch.id ||
                            Boolean(downloadingBatchId)
                          }
                          className="h-7 gap-1.5 border-input text-xs text-foreground hover:bg-accent"
                        >
                          {downloadingBatchId === batch.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Download className="size-3" />
                          )}

                          Export Excel
                        </Button>
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
                Completed batches will appear here automatically
                when 50 eligible records are available.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}