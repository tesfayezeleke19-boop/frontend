/**
 * Persistence for credit contracts.
 *
 * The credit-contract workflow follows the same documented persistence model
 * as the existing Contract Orders module: data lives in the browser until the
 * PHP contract endpoints exist, and every read/write goes through the
 * repository (src/services/creditContracts/repository.ts), never a component.
 *
 * Keys are separate from the standard contract keys so the two workflows can
 * never read, overwrite, or migrate each other's records.
 */
import type { CreditContract, CreditContractOrder } from "./types";

const CONTRACTS_KEY = "hati.creditContracts.v1";
const ORDERS_KEY = "hati.creditContracts.orders.v1";

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
    // Ignore quota/private-mode failures; data simply will not persist.
  }
}

/* ------------------------------------------------------------------ */
/* Change notification                                                 */
/* ------------------------------------------------------------------ */

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeCreditContracts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyCreditContractsChanged(): void {
  listeners.forEach((listener) => listener());
}

/* ------------------------------------------------------------------ */
/* Credit contracts                                                    */
/* ------------------------------------------------------------------ */

export function loadCreditContracts(): CreditContract[] {
  const stored = readStorage<CreditContract[]>(CONTRACTS_KEY, []);
  return Array.isArray(stored) ? stored.filter(isCreditContract) : [];
}

export function persistCreditContracts(contracts: CreditContract[]): void {
  writeStorage(CONTRACTS_KEY, contracts);
}

function isCreditContract(value: unknown): value is CreditContract {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CreditContract).id === "string" &&
    typeof (value as CreditContract).contractNumber === "string" &&
    Array.isArray((value as CreditContract).attachments)
  );
}

/* ------------------------------------------------------------------ */
/* Credit contract orders                                              */
/* ------------------------------------------------------------------ */

export function loadCreditOrders(): CreditContractOrder[] {
  const stored = readStorage<CreditContractOrder[]>(ORDERS_KEY, []);
  return Array.isArray(stored) ? stored.filter(isCreditOrder) : [];
}

export function persistCreditOrders(orders: CreditContractOrder[]): void {
  writeStorage(ORDERS_KEY, orders);
}

function isCreditOrder(value: unknown): value is CreditContractOrder {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CreditContractOrder).id === "string" &&
    typeof (value as CreditContractOrder).creditContractId === "string" &&
    Number.isFinite((value as CreditContractOrder).quantity)
  );
}

/* ------------------------------------------------------------------ */
/* Ids                                                                */
/* ------------------------------------------------------------------ */

export function createCreditId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
