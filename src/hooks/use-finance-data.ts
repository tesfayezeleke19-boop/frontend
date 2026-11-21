/**
 * React hooks for the Finance repository layer.
 *
 * Finance hooks subscribe to sales, finance, and contract change notifiers.
 * Royalty report rows are loaded from the Finance backend API.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeSales } from "@/services/sales/storage";
import { subscribeFinance } from "@/services/finance/storage";
import { subscribeContracts } from "@/services/contracts/storage";

import { financeRoyaltyReportsApi } from "@/services/finance/royaltyReport";
import type { FinanceRoyaltyReportRow } from "@/services/finance/royaltyReport";

import { expensesRepository } from "@/services/finance/expenses";
import { financialRecordsRepository } from "@/services/finance/records";
import {
  getConfirmedRecordTotals,
  getFinancialReports,
  getFinanceSummary,
} from "@/services/finance/summary";
import { payrollFinancialRecordsRepository } from "@/services/finance/payrollRecords";

import type {
  Expense,
  FinancialRecord,
  FinancialReportsData,
  FinanceSummary,
  PayrollFinancialRecord,
} from "@/services/finance";

export interface RepoState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** Manual recovery refresh; successful mutations notify subscribers instead. */
  refresh: () => void;
}

function useRepoData<T>(loader: () => Promise<T>): RepoState<T> {
  const [state, setState] = useState<RepoState<T>>({
    data: null,
    loading: true,
    error: null,
    refresh: () => undefined,
  });
  const [reloadToken, setReloadToken] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    let active = true;

    const load = () => {
      const currentRequest = ++requestId.current;
      loader().then(
        (data) => {
          if (active && currentRequest === requestId.current) {
            setState({
              data,
              loading: false,
              error: null,
              refresh: () => setReloadToken((token) => token + 1),
            });
          }
        },
        (error: unknown) => {
          if (active && currentRequest === requestId.current) {
            setState({
              data: null,
              loading: false,
              error:
                error instanceof Error
                  ? error
                  : new Error(String(error)),
              refresh: () => setReloadToken((token) => token + 1),
            });
          }
        },
      );
    };

    load();

    const unsubscribeSalesChanges = subscribeSales(load);
    const unsubscribeFinanceChanges = subscribeFinance(load);
    const unsubscribeContractChanges = subscribeContracts(load);

    return () => {
      active = false;
      unsubscribeSalesChanges();
      unsubscribeFinanceChanges();
      unsubscribeContractChanges();
    };
  }, [loader, reloadToken]);

  return state;
}

export function useFinancialRecords(): RepoState<FinancialRecord[]> {
  const loader = useCallback(
    () => financialRecordsRepository.getRecords(),
    [],
  );

  return useRepoData(loader);
}

export function useFinanceSummary(
  year?: number,
  month?: number | null,
): RepoState<FinanceSummary> {
  const loader = useCallback(
    () => getFinanceSummary(year, month),
    [year, month],
  );

  return useRepoData(loader);
}

export function useFinancialReports(
  year?: number,
  month?: number | null,
): RepoState<FinancialReportsData> {
  const loader = useCallback(
    () => getFinancialReports(year, month),
    [year, month],
  );

  return useRepoData(loader);
}

export function useConfirmedRecordTotals(): RepoState<{
  count: number;
  totalAmount: number;
}> {
  const loader = useCallback(
    () => getConfirmedRecordTotals(),
    [],
  );

  return useRepoData(loader);
}

export function useExpenses(): RepoState<Expense[]> {
  const loader = useCallback(
    () => expensesRepository.getExpenses(),
    [],
  );

  return useRepoData(loader);
}

/** Workflow A — Finance-owned expenses. */
export function useFinanceExpenses(): RepoState<Expense[]> {
  const loader = useCallback(
    () => expensesRepository.getFinanceExpenses(),
    [],
  );

  return useRepoData(loader);
}

/** Workflow B — Admin-originated expenses in every review status. */
export function useAdminExpenses(): RepoState<Expense[]> {
  const loader = useCallback(
    () => expensesRepository.getAdminExpenses(),
    [],
  );

  return useRepoData(loader);
}

/** Finance review queue — Admin expenses awaiting Finance review. */
export function useFinanceReviewQueue(): RepoState<Expense[]> {
  const loader = useCallback(
    () => expensesRepository.getFinanceReviewQueue(),
    [],
  );

  return useRepoData(loader);
}

/** Admin workflow review counters for dashboards. */
export function useAdminExpenseReviewSummary(): RepoState<{
  pendingReview: number;
  pendingAmount: number;
  approved: number;
  rejected: number;
  drafts: number;
}> {
  const loader = useCallback(
    () => expensesRepository.getExpenseReviewSummary(),
    [],
  );

  return useRepoData(loader);
}

/**
 * Royalty Report rows.
 *
 * The backend provides eligible invoice lines and completed contract orders.
 * Finalized rows are excluded by the backend, not by browser storage.
 */
export function useRoyaltyReportRows(): RepoState<FinanceRoyaltyReportRow[]> {
  const loader = useCallback(
    () => financeRoyaltyReportsApi.getRows(),
    [],
  );

  return useRepoData(loader);
}

export function usePayrollFinancialRecords(): RepoState<PayrollFinancialRecord[]> {
  const loader = useCallback(
    () => payrollFinancialRecordsRepository.getRecords(),
    [],
  );

  return useRepoData(loader);
}
