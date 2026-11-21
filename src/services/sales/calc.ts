
import type { SalesOrder } from "./types";

/**
 * Safely normalize any value to a valid number.
 * Handles undefined, null, empty strings, and numeric strings.
 * Returns 0 for missing/invalid values instead of NaN.
 */
export function normalizeNumber(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return 0;

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

/**
 * Round monetary values to 2 decimal places.
 * EPSILON helps compensate for JavaScript floating-point precision.
 */
export function roundMoney(value: number): number {
  const safe = normalizeNumber(value);
  return Math.round((safe + Number.EPSILON) * 100) / 100;
}

/**
 * Round a calculated value to 6 decimal places.
 * Useful for quantities and intermediate calculations.
 */
export function roundCalculation(value: number): number {
  const safe = normalizeNumber(value);
  return Math.round((safe + Number.EPSILON) * 1_000_000) / 1_000_000;
}

/**
 * VAT rate divisor (15% VAT → divisor 1.15).
 */
export const VAT_DIVISOR = 1.15;

/**
 * Calculate VAT-exclusive total price.
 *
 * totalPriceExclVat = unitPrice × quantity
 *
 * Round the final monetary amount to 2 decimal places.
 */
export function calculateTotalPriceExclVat(
  unitPrice: number,
  quantity: number,
): number {
  const safeUnitPrice = normalizeNumber(unitPrice);
  const safeQuantity = normalizeNumber(quantity);

  return roundMoney(safeUnitPrice * safeQuantity);
}

/**
 * Calculate VAT-inclusive total price.
 *
 * totalPriceInclVat = (unitPrice × quantity) × 1.15
 *
 * First calculate and round the VAT-exclusive amount, then apply VAT.
 * This avoids floating-point noise accumulating in the calculation.
 */
export function calculateTotalPriceInclVat(
  unitPrice: number,
  quantity: number,
): number {
  const subtotal = calculateTotalPriceExclVat(unitPrice, quantity);

  return roundMoney(subtotal * VAT_DIVISOR);
}

/**
 * @deprecated Use calculateTotalPriceExclVat or calculateTotalPriceInclVat.
 * Kept temporarily for backward compatibility during migration.
 */
export function calculateTotalPrice(
  quantity: number,
  unitPrice: number,
): number {
  return calculateTotalPriceInclVat(unitPrice, quantity);
}

/**
 * Compute the next sequential order number (ORDER-0001, ORDER-0002, ...).
 * The repository owns order-number generation; this pure helper keeps the
 * rule in one place and is easy to replace with a backend-generated number.
 */
export function computeNextOrderNumber(orders: SalesOrder[]): string {
  let max = 0;

  for (const order of orders) {
    const match = /^ORDER-(\d+)$/.exec(order.orderNumber);

    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }

  return `ORDER-${String(max + 1).padStart(4, "0")}`;
}

/**
 * Compute the next sequential sales report number
 * (SALES-REPORT-0001, SALES-REPORT-0002, ...).
 * Backward compatible with the older SR-0001 format.
 */
export function computeNextReportNumber(
  reportNumbers: string[],
): string {
  let max = 0;

  for (const reportNumber of reportNumbers) {
    const match = /^(?:SALES-REPORT|SR)-(\d+)$/.exec(reportNumber);

    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }

  return `SALES-REPORT-${String(max + 1).padStart(4, "0")}`;
}
