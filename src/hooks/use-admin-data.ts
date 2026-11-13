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
  AdminOverallReportData,
} from "@/services/admin";

export interface AdminDataState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
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
          if (active) setState({ data, loading: false, error: null });
        },
        (error: unknown) => {
          if (active) {
            setState({
              data: null,
              loading: false,
              error: error instanceof Error ? error : new Error(String(error)),
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

export function useAdminSalesOverview(): AdminDataState<AdminSalesOverview> {
  const loader = useCallback(() => getAdminSalesOverview(), []);
  return useAdminData(loader);
}

export function useAdminFinanceOverview(): AdminDataState<AdminFinanceOverview> {
  const loader = useCallback(() => getAdminFinanceOverview(), []);
  return useAdminData(loader);
}

export function useAdminHROverview(): AdminDataState<AdminHROverview> {
  const loader = useCallback(() => getAdminHROverview(), []);
  return useAdminData(loader);
}

export function useAdminMonthlyFinancials(
  year?: number,
): AdminDataState<AdminMonthlyFinancialRow[]> {
  const loader = useCallback(() => getAdminMonthlyFinancials(year), [year]);
  return useAdminData(loader, [year]);
}

export function useAdminOverallSummary(): AdminDataState<AdminOverallSummary> {
  const loader = useCallback(() => getAdminOverallSummary(), []);
  return useAdminData(loader);
}

export function useAdminSalesReport(
  filters?: { year?: number; month?: number },
): AdminDataState<AdminSalesReportData> {
  const key = JSON.stringify(filters);
  const loader = useCallback(() => getAdminSalesReport(filters), [key]);
  return useAdminData(loader, [key]);
}

export function useAdminFinancialReport(
  filters?: { year?: number; month?: number },
): AdminDataState<AdminFinancialReportData> {
  const key = JSON.stringify(filters);
  const loader = useCallback(() => getAdminFinancialReport(filters), [key]);
  return useAdminData(loader, [key]);
}

export function useAdminHRReport(
  filters?: { status?: "active" | "inactive"; position?: string },
): AdminDataState<AdminHRReportData> {
  const key = JSON.stringify(filters);
  const loader = useCallback(() => getAdminHRReport(filters), [key]);
  return useAdminData(loader, [key]);
}


