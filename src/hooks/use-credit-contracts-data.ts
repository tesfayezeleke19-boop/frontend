
/**
 * React hooks for the Credit Contract repository.
 *
 * Hook consumers never access local storage directly.
 * They read through the API-backed repository and refresh whenever
 * credit-contract data changes.
 */
import { useCallback, useEffect, useState } from "react";

import { creditContractsRepository } from "@/services/creditContracts/repository";

import type {
  CreditContract,
  CreditContractFinancials,
  CreditContractOrder,
} from "@/services/creditContracts/types";

import type {
  ContractFinancialReport,
} from "@/services/contracts/financials";

export interface RepoState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

function useCreditContractData<T>(
  loader: () => Promise<T>,
): RepoState<T> {
  const [state, setState] = useState<RepoState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const data = await loader();

        if (active) {
          setState({
            data,
            loading: false,
            error: null,
          });
        }
      } catch (error: unknown) {
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
      }
    };

    // Initial API request.
    void load();

    // Refresh when the API repository reports a successful mutation.
    const unsubscribe = creditContractsRepository.subscribe(
      () => {
        void load();
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loader]);

  return state;
}

/**
 * All credit contracts visible to the authenticated user.
 */
export function useCreditContracts(): RepoState<CreditContract[]> {
  const loader = useCallback(
    () => creditContractsRepository.getContracts(),
    [],
  );

  return useCreditContractData(loader);
}

/**
 * One credit contract.
 */
export function useCreditContract(
  id: string | undefined,
): RepoState<CreditContract | null> {
  const loader = useCallback(
    () =>
      id
        ? creditContractsRepository.getContractById(id)
        : Promise.resolve(null),
    [id],
  );

  return useCreditContractData(loader);
}

/**
 * Orders belonging to one credit contract.
 */
export function useCreditContractOrders(
  contractId: string | undefined,
): RepoState<CreditContractOrder[]> {
  const loader = useCallback(
    () =>
      contractId
        ? creditContractsRepository.getOrders(contractId)
        : Promise.resolve([]),
    [contractId],
  );

  return useCreditContractData(loader);
}

/**
 * Credit contract progress and payment summary.
 */
export function useCreditContractFinancials(
  contractId: string | undefined,
): RepoState<CreditContractFinancials | null> {
  const loader = useCallback(
    () =>
      contractId
        ? creditContractsRepository.getFinancials(contractId)
        : Promise.resolve(null),
    [contractId],
  );

  return useCreditContractData(loader);
}

/**
 * Payment, withholding and completed-contract financial report.
 */
export function useCreditContractFinancialReport(
  contractId: string | undefined,
): RepoState<ContractFinancialReport | null> {
  const loader = useCallback(
    () =>
      contractId
        ? creditContractsRepository.getFinancialReport(contractId)
        : Promise.resolve(null),
    [contractId],
  );

  return useCreditContractData(loader);
}

/**
 * Orders across all credit contracts.
 */
export function useAllCreditContractOrders(): RepoState<
  CreditContractOrder[]
> {
  const loader = useCallback(
    () => creditContractsRepository.getAllOrders(),
    [],
  );

  return useCreditContractData(loader);
}
