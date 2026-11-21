
/**
 * Credit Contract change notifications.
 *
 * Credit contracts and credit orders are persisted exclusively through
 * the backend API in:
 *
 *   src/services/creditContracts/repository.ts
 *
 * This file does not store, retrieve, or cache credit-contract records.
 * It only provides notifications so subscribed components can refresh
 * their data after successful API operations.
 */

/* -------------------------------------------------------------------------- */
/* Change notification                                                        */
/* -------------------------------------------------------------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Subscribe to credit-contract changes.
 *
 * Components should use this notification to reload their data from
 * creditContractsRepository.
 */
export function subscribeCreditContracts(
  listener: Listener,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Notify subscribers after a successful backend operation.
 */
export function notifyCreditContractsChanged(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error(
        "Credit contract change listener failed:",
        error,
      );
    }
  });
}
