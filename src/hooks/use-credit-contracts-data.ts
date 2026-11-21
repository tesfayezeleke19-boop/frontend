/** React hooks for the Credit Contract repository.

Hook consumers never touch storage: they read through the repository and
re-fetch whenever credit-contract data changes (or when a Sales Invoice
change affects a finalized contract's invoice link).
*/
import { useCallback, useEffect, useRef, useState } from "react";
import {
  subscribeCreditContracts,
} from "@/services/creditContracts/storage";
import { subscribeSales } from "@/services/sales/storage";
import { creditContractsRepository } from "@/services/creditContracts/repository";
import type {
  CreditContract,
  CreditContractFinancials,
  CreditContractOrder,
} from "@/services/creditContracts/types";
import type { ContractFinancialReport } from "@/services/contracts/financials";

export interface RepoState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** Manual recovery refresh; successful mutations notify subscribers instead. */
  refresh: () => void;
}

function useCreditContractData<T>(
  loader: () => Promise<T>,
): RepoState<T> {
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
      loader()
        .then((data) => {
          if (active && currentRequest === requestId.current)
            setState({
              data,
              loading: false,
              error: null,
              refresh: () => setReloadToken((token) => token + 1),
            });
        })
        .catch((error: unknown) => {
          if (active && currentRequest === requestId.current)
            setState({
              data: null,
              loading: false,
              error:
                error instanceof Error
                  ? error
                  : new Error(String(error)),
              refresh: () => setReloadToken((token) => token + 1),
            });
        });
    };

    load();
    const unsubscribe = subscribeCreditContracts(load);
    // Finalized credit contracts derive payment status from their Sales
    // Invoice, so invoice approval/payment changes must refresh this data too.
    const unsubscribeSales = subscribeSales(load);
    return () => {
      active = false;
      unsubscribe();
      unsubscribeSales();
    };
  }, [loader, reloadToken]);

  return state;
}

export function useCreditContracts(): RepoState<CreditContract[]> {
  const loader = useCallback(
    () => creditContractsRepository.getContracts(),
    [],
  );
  return useCreditContractData(loader);
}

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

/** Payment, withholding and the completed-contract financial report. */
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

export function useAllCreditContractOrders(): RepoState<CreditContractOrder[]> {
  const loader = useCallback(
    () => creditContractsRepository.getAllOrders(),
    [],
  );
  return useCreditContractData(loader);
}
