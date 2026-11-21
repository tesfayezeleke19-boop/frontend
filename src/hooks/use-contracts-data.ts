/**
 * React hooks for the Contract Orders repository.
 *
 * Hook consumers never touch storage: they read through the repository and
 * re-fetch whenever contract data changes (or when a Sales Invoice change
 * affects a converted contract's invoice link).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeSales } from "@/services/sales/storage";
import { contractsRepository } from "@/services/contracts/repository";
import { subscribeContracts } from "@/services/contracts/storage";
import type {
  Contract,
  ContractOrder,
  ContractProgress,
} from "@/services/contracts/types";
import type { ContractFinancialReport } from "@/services/contracts/financials";

export interface RepoState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** Manual recovery refresh; successful mutations notify subscribers instead. */
  refresh: () => void;
}

function useContractData<T>(loader: () => Promise<T>): RepoState<T> {
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
          if (active && currentRequest === requestId.current)
            setState({
              data,
              loading: false,
              error: null,
              refresh: () => setReloadToken((token) => token + 1),
            });
        },
        (error: unknown) => {
          if (active && currentRequest === requestId.current) {
            setState({
              data: null,
              loading: false,
              error: error instanceof Error ? error : new Error(String(error)),
              refresh: () => setReloadToken((token) => token + 1),
            });
          }
        },
      );
    };

    load();
    const unsubscribeContracts = subscribeContracts(load);
    const unsubscribeSales = subscribeSales(load);
    return () => {
      active = false;
      unsubscribeContracts();
      unsubscribeSales();
    };
  }, [loader, reloadToken]);

  return state;
}

export function useContracts(): RepoState<Contract[]> {
  const loader = useCallback(() => contractsRepository.getContracts(), []);
  return useContractData(loader);
}

export function useContract(
  id: string | undefined,
): RepoState<Contract | null> {
  const loader = useCallback(
    () =>
      id ? contractsRepository.getContractById(id) : Promise.resolve(null),
    [id],
  );
  return useContractData(loader);
}

export function useContractOrders(
  contractId: string | undefined,
): RepoState<ContractOrder[]> {
  const loader = useCallback(
    () =>
      contractId
        ? contractsRepository.getContractOrders(contractId)
        : Promise.resolve([]),
    [contractId],
  );
  return useContractData(loader);
}

export function useAllContractOrders(): RepoState<ContractOrder[]> {
  const loader = useCallback(() => contractsRepository.getAllOrders(), []);
  return useContractData(loader);
}

export function useContractProgress(
  contractId: string | undefined,
): RepoState<ContractProgress | null> {
  const loader = useCallback(
    () =>
      contractId
        ? contractsRepository.getContractProgress(contractId)
        : Promise.resolve(null),
    [contractId],
  );
  return useContractData(loader);
}

/** Payment, withholding and the completed-contract financial report. */
export function useContractFinancialReport(
  contractId: string | undefined,
): RepoState<ContractFinancialReport | null> {
  const loader = useCallback(
    () =>
      contractId
        ? contractsRepository.getFinancialReport(contractId)
        : Promise.resolve(null),
    [contractId],
  );
  return useContractData(loader);
}
