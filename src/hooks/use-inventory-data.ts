
/**
 * React hooks for the shared Inventory layer.
 *
 * Every portal (Sales, Finance, Admin) uses these hooks so all views read
 * the same records: one subscription to the repository, no per-portal state.
 */
import { useCallback, useEffect, useState } from "react";
import {
  inventoryRepository,
  getInventorySummary,
  type InventoryRecord,
  type InventorySummary,
} from "@/services/finance/inventory";
import {
  monthlyInventoryReportsRepository,
  periodLabel,
  type MonthlyInventoryQuantity,
} from "@/services/finance/monthlyInventoryReports";

/**
 * Monthly reports store one row per aggregate type; the Admin dashboard shows
 * the newest report's total recorded quantity. Every row is summed, whether it
 * carries an Admin aggregate type ID or a legacy fixed code ("00"/"01"/"02"),
 * so reports created with dynamic aggregate types are not counted as zero.
 */
function totalMonthlyQuantity(rows: MonthlyInventoryQuantity[]): number {
  return rows.reduce((total, row) => total + (Number(row.quantity) || 0), 0);
}

export interface InventoryState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

function useInventoryData<T>(loader: () => Promise<T>): InventoryState<T> {
  const [state, setState] = useState<InventoryState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;

    const load = () => {
      loader().then(
        (data) => {
          if (active) {
            setState({ data, loading: false, error: null });
          }
        },
        (error: unknown) => {
          if (active) {
            setState({
              data: null,
              loading: false,
              error:
                error instanceof Error
                  ? error
                  : new Error(String(error)),
            });
          }
        },
      );
    };

    load();

    const unsubscribe = inventoryRepository.subscribe(load);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loader]);

  return state;
}

/** The unsold-order records — one shared list for Sales/Finance/Admin. */
export function useInventoryRecords(): InventoryState<InventoryRecord[]> {
  return useInventoryData(
    useCallback(() => inventoryRepository.getRecords(), []),
  );
}

/** Aggregated inventory summary for dashboards/reports (legacy model). */
export function useInventorySummary(): InventoryState<InventorySummary> {
  return useInventoryData(
    useCallback(() => getInventorySummary(), []),
  );
}

/* ------------------------------------------------------------------ */
/* Monthly unsold-aggregate reports (THE authoritative monthly source)  */
/* ------------------------------------------------------------------ */

export interface MonthlyReportOverview {
  submittedCount: number;

  /** Latest submitted monthly report, or null when nothing is submitted. */
  latest: {
    period: string;
    label: string;
    quantityTotal: number;
    submittedAt?: number;
  } | null;

  /**
   * Reporting months on/after the configured reporting start month that
   * have not been submitted yet. Never counts anything before the start
   * month, and includes only periods eligible for reporting now.
   */
  eligibleMissing: number;
}

export function useMonthlyReportOverview(): InventoryState<MonthlyReportOverview> {
  const loader = useCallback(async (): Promise<MonthlyReportOverview> => {
    const [submitted, reports] = await Promise.all([
      monthlyInventoryReportsRepository.getSubmittedReports(),
      monthlyInventoryReportsRepository.getReports(),
    ]);

    const newest = submitted[0] ?? null;

    return {
      submittedCount: submitted.length,
      latest: newest
        ? {
            period: newest.period,
            label: periodLabel(newest.period),
            quantityTotal: totalMonthlyQuantity(newest.quantities),
            submittedAt: newest.submittedAt,
          }
        : null,
      eligibleMissing: reports.filter((report) => !report.submittedAt).length,
    };
  }, []);

  return useInventoryData(loader);
}
