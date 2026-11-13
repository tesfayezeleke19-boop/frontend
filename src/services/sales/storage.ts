/** In-memory change notifications only. Sales records are never stored here. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeSales(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifySalesChanged(): void {
  for (const listener of [...listeners]) listener();
}

/** Compatibility exports for older imports. They intentionally contain no data. */
export function loadOrders(): never[] { return []; }
export function persistOrders(_orders: unknown[]): void { /* API is the source of truth. */ }
export function loadReports(): never[] { return []; }
export function persistReports(_reports: unknown[]): void { /* No report API exists yet. */ }
