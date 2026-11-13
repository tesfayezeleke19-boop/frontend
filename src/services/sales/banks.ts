/**
 * Banks offered by the Sales Invoice payment form, shared with the contract
 * payment-information form so both workflows offer the same choices.
 *
 * This is a UI list only — the backend remains authoritative for payment data.
 */
export const BANKS = [
  "CBE",
  "Awash Bank",
  "Dashen Bank",
  "Wegagen Bank",
  "Bank of Abyssinia",
  "Cooperative Bank",
  "United Bank",
  "Liberty Bank",
  "Zemen Bank",
] as const;
