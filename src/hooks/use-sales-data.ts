/**
 * React hooks for the Sales repository layer.
 *
 * Each hook reads through the repository and re-fetches whenever the
 * repository changes, so creating/submitting an order updates the dashboard,
 * transactions list, and reports automatically.
 */
import { useCallback, useEffect, useState } from "react";
import { salesOrdersRepository } from "@/services/sales/orders";
import { salesReportsRepository } from "@/services/sales/reports";
import { salesInvoicesRepository } from "@/services/sales/invoiceRepo";
import { subscribeSales } from "@/services/sales/storage";
import { ORDER_STATUS } from "@/services/sales/types";
import type {
  SalesInvoice,
} from "@/services/sales/invoice";
import type {
  SalesOrder,
  SalesReport,
  SalesReportDetail,
  SalesSummary,
} from "@/services/sales/types";

export interface RepoState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

function useRepoData<T>(loader: () => Promise<T>): RepoState<T> {
  const [state, setState] = useState<RepoState<T>>({
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
    const unsubscribe = subscribeSales(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [loader]);

  return state;
}

export function useSalesOrders(): RepoState<SalesOrder[]> {
  const loader = useCallback(() => salesOrdersRepository.getOrders(), []);
  return useRepoData(loader);
}

export function useSalesOrder(
  id: string | undefined,
): RepoState<SalesOrder | null> {
  const loader = useCallback(
    () =>
      id ? salesOrdersRepository.getOrderById(id) : Promise.resolve(null),
    [id],
  );
  return useRepoData(loader);
}

export function useSalesSummary(): RepoState<SalesSummary> {
  const loader = useCallback(() => salesOrdersRepository.getSalesSummary(), []);
  return useRepoData(loader);
}

export function useNextOrderNumber(): RepoState<string> {
  const loader = useCallback(() => salesOrdersRepository.getNextOrderNumber(), []);
  return useRepoData(loader);
}

export function useApprovedOrders(): RepoState<SalesOrder[]> {
  const loader = useCallback(
    () =>
      salesOrdersRepository.getOrdersByStatus(ORDER_STATUS.FINANCE_APPROVED),
    [],
  );
  return useRepoData(loader);
}

export function useSalesInvoice(
  id: string | undefined,
): RepoState<SalesInvoice | null> {
  const loader = useCallback(
    () =>
      id
        ? salesInvoicesRepository.getInvoiceById(id)
        : Promise.resolve(null),
    [id],
  );
  return useRepoData(loader);
}

export function useSalesInvoices(): RepoState<SalesInvoice[]> {
  const loader = useCallback(() => salesInvoicesRepository.getInvoices(), []);
  return useRepoData(loader);
}

export function useNextInvoiceNumber(): RepoState<string> {
  const loader = useCallback(
    () => salesInvoicesRepository.computeNextInvoiceNumber(),
    [],
  );
  return useRepoData(loader);
}

export function useRoyaltyInvoices(): RepoState<SalesInvoice[]> {
  const loader = useCallback(async () => {
    const all = await salesInvoicesRepository.getInvoices();
    return all.filter(
      (invoice: { status: string; }) =>
        invoice.status === ORDER_STATUS.FINANCE_APPROVED ||
        invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED,
    );
  }, []);
  return useRepoData(loader);
}

/**
 * Orders with confirmed payments that are not yet part of any report
 * (for report creation).
 */
export function useAvailableConfirmedOrders(): RepoState<SalesOrder[]> {
  const loader = useCallback(
    () => salesReportsRepository.getAvailableConfirmedOrders(),
    [],
  );
  return useRepoData(loader);
}

export function useSalesReports(): RepoState<SalesReport[]> {
  const loader = useCallback(() => salesReportsRepository.getReports(), []);
  return useRepoData(loader);
}

export function useSalesReport(
  id: string | undefined,
): RepoState<SalesReportDetail | null> {
  const loader = useCallback(
    () =>
      id ? salesReportsRepository.getReportById(id) : Promise.resolve(null),
    [id],
  );
  return useRepoData(loader);
}
