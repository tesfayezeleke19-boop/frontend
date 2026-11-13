/**
 * Centralized Finance calculation service.
 *
 * Every financial formula lives here — dashboard, reports, and future
 * pages all import from this module. No UI component should compute
 * financial metrics independently.
 *
 * Business rules:
 *   - Total Sales is VAT-inclusive (sum of totalPrice for approved orders).
 *   - VAT = Total Sales − (Total Sales / 1.15)
 *   - Gross Income = Total Sales − VAT
 *   - Royalty = Gross Income × 3%
 *   - Net Profit = Gross Income − Expenses − Royalty
 */

/** Ethiopian VAT rate as a multiplier divisor (15%). */
export const VAT_DIVISOR = 1.15;

/** Royalty rate (3% of Gross Income). */
export const ROYALTY_RATE = 0.03;

/**
 * Round to 2 decimal places to avoid floating-point noise.
 */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate VAT from a VAT-inclusive total.
 *
 *   VAT = totalSales − (totalSales / 1.15)
 *
 * Example: 115,000 → 15,000
 */
export function calculateVat(totalSales: number): number {
  return roundMoney(totalSales - totalSales / VAT_DIVISOR);
}

/**
 * Calculate Gross Income (net of VAT) from a VAT-inclusive total.
 *
 *   Gross Income = totalSales − VAT
 *
 * Example: 115,000 → 100,000
 */
export function calculateGrossIncome(totalSales: number): number {
  return roundMoney(totalSales - calculateVat(totalSales));
}

/**
 * Calculate Royalty (3% of Gross Income).
 *
 *   Royalty = Gross Income × 0.03
 *
 * Example: 100,000 → 3,000
 */
export function calculateRoyalty(grossIncome: number): number {
  return roundMoney(grossIncome * ROYALTY_RATE);
}

/**
 * Calculate Net Profit.
 *
 *   Net Profit = Gross Income − Expenses − Royalty
 *
 * Example: Gross 100,000, Expenses 20,000, Royalty 3,000 → 77,000
 */
export function calculateNetProfit(
  grossIncome: number,
  expenses: number,
  royalty: number,
): number {
  return roundMoney(grossIncome - expenses - royalty);
}
