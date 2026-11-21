
/**
 * React hooks for the Admin read-only reporting layer.
 *
 * These hooks consume the Admin summary service and subscribe to
 * sales/finance change notifications so the dashboard re-renders
 * when any department mutates data.
 */
import { useCallback, useEffect, useState } from "react";
import { subscribeSales } from "@/services/sales/storage";
import { subscribeFinance } from "@/services/finance/storage";
import {
  getAdminSalesOverview,
  getAdminFinanceOverview,
  getAdminHROverview,
  getAdminMonthlyFinancials,
  getAdminOverallSummary,
  getAdminSalesReport,
  getAdminFinancialReport,
  getAdminHRReport,
} from "@/services/admin/summary";
import type {
  AdminSalesOverview,
  AdminFinanceOverview,
  AdminHROverview,
  AdminMonthlyFinancialRow,
  AdminOverallSummary,
  AdminSalesReportData,
  AdminFinancialReportData,
  AdminHRReportData,
} from "@/services/admin";

export interface AdminDataState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export interface AdminPeriodFilters {
  year?: number;
  month?: number;
}

function useAdminData<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
): AdminDataState<T> {
  const [state, setState] = useState<AdminDataState<T>>({
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
            setState({
              data,
              loading: false,
              error: null,
            });
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

    const unsubSales = subscribeSales(load);
    const unsubFinance = subscribeFinance(load);

    return () => {
      active = false;
      unsubSales();
      unsubFinance();
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/* ------------------------------------------------------------------ */
/* Overview Hooks                                                      */
/* ------------------------------------------------------------------ */

export function useAdminSalesOverview(
  filters?: AdminPeriodFilters,
): AdminDataState<AdminSalesOverview> {
  const key = JSON.stringify(filters ?? {});

  const loader = useCallback(
    () => getAdminSalesOverview(filters),
    [key],
  );

  return useAdminData(loader, [key]);
}

export function useAdminFinanceOverview(
  filters?: AdminPeriodFilters,
): AdminDataState<AdminFinanceOverview> {
  const key = JSON.stringify(filters ?? {});

  const loader = useCallback(
    () => getAdminFinanceOverview(filters),
    [key],
  );

  return useAdminData(loader, [key]);
}

export function useAdminHROverview(): AdminDataState<AdminHROverview> {
  const loader = useCallback(
    () => getAdminHROverview(),
    [],
  );

  return useAdminData(loader);
}

export function useAdminMonthlyFinancials(
  year?: number,
  month?: number,
): AdminDataState<AdminMonthlyFinancialRow[]> {
  const loader = useCallback(
    () => getAdminMonthlyFinancials(year, month),
    [year, month],
  );

  return useAdminData(loader, [year, month]);
}

/* ------------------------------------------------------------------ */
/* Overall Summary Hook                                                */
/* ------------------------------------------------------------------ */

export function useAdminOverallSummary(): AdminDataState<AdminOverallSummary> {
  const loader = useCallback(
    () => getAdminOverallSummary(),
    [],
  );

  return useAdminData(loader);
}

/* ------------------------------------------------------------------ */
/* Report Hooks                                                        */
/* ------------------------------------------------------------------ */

export function useAdminSalesReport(
  filters?: AdminPeriodFilters,
): AdminDataState<AdminSalesReportData> {
  const key = JSON.stringify(filters ?? {});

  const loader = useCallback(
    () => getAdminSalesReport(filters),
    [key],
  );

  return useAdminData(loader, [key]);
}

export function useAdminFinancialReport(
  filters?: AdminPeriodFilters,
): AdminDataState<AdminFinancialReportData> {
  const key = JSON.stringify(filters ?? {});

  const loader = useCallback(
    () => getAdminFinancialReport(filters),
    [key],
  );

  return useAdminData(loader, [key]);
}

export function useAdminHRReport(
  filters?: {
    status?: "active" | "inactive";
    position?: string;
  },
): AdminDataState<AdminHRReportData> {
  const key = JSON.stringify(filters ?? {});

  const loader = useCallback(
    () => getAdminHRReport(filters),
    [key],
  );

  return useAdminData(loader, [key]);
}
