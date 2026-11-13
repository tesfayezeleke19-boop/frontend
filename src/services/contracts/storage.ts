/**
 * Temporary persistence for Contract Orders.
 *
 * Until the PHP backend exists, contracts and their orders live in
 * localStorage so they survive refreshes. UI components never touch this
 * module directly — they go through the contract repository
 * (src/services/contracts/repository.ts), which enforces authorization and
 * owns the lifecycle. Replacing this module's two storage functions with
 * PHP REST calls is the only change a real backend requires.
 *
 * Both collections are written together by the repository where an
 * operation touches both, and every mutation is a full-array write, so an
 * order and its contract never disagree about the contract's own state.
 */
import type { Contract, ContractOrder } from "./types";

const CONTRACTS_KEY = "nexerp.contracts.v1";
const CONTRACT_ORDERS_KEY = "nexerp.contracts.orders.v1";

function readStorage<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota/private-mode failures; data just won't persist.
  }
}

/* ------------------------------------------------------------------ */
/* Change notification                                                 */
/* ------------------------------------------------------------------ */

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeContracts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyContractsChanged(): void {
  listeners.forEach((listener) => listener());
}

/* ------------------------------------------------------------------ */
/* Contracts                                                          */
/* ------------------------------------------------------------------ */

export function loadContracts(): Contract[] {
  const stored = readStorage<Contract[]>(CONTRACTS_KEY, []);
  return Array.isArray(stored) ? stored.filter(isContract) : [];
}

export function persistContracts(contracts: Contract[]): void {
  writeStorage(CONTRACTS_KEY, contracts);
}

/** Defensive shape check — corrupt rows are dropped, not rendered. */
function isContract(value: unknown): value is Contract {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Contract).id === "string" &&
    typeof (value as Contract).contractNumber === "string" &&
    Array.isArray((value as Contract).attachments)
  );
}

/* ------------------------------------------------------------------ */
/* Contract orders                                                    */
/* ------------------------------------------------------------------ */

export function loadContractOrders(): ContractOrder[] {
  const stored = readStorage<ContractOrder[]>(CONTRACT_ORDERS_KEY, []);
  return Array.isArray(stored) ? stored.filter(isContractOrder) : [];
}

export function persistContractOrders(orders: ContractOrder[]): void {
  writeStorage(CONTRACT_ORDERS_KEY, orders);
}

function isContractOrder(value: unknown): value is ContractOrder {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ContractOrder).id === "string" &&
    typeof (value as ContractOrder).contractId === "string" &&
    Number.isFinite((value as ContractOrder).quantity)
  );
}

/* ------------------------------------------------------------------ */
/* Ids                                                                */
/* ------------------------------------------------------------------ */

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
