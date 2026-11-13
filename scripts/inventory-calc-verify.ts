/**
 * Tax-free verification of the inventory calculation rules from the spec:
 *   Test A: 100/35 → 65 Partially Sold; 60 → 40; 100 → 0 Sold; 0 → 100 Unsold
 *   Test B: sold > original rejected; negative/NaN rejected
 * Run: bun scripts/inventory-calc-verify.ts
 */
import {
  calculateUnsoldQuantity,
  deriveInventoryStatus,
  validateInventoryInput,
  INVENTORY_STATUS,
} from "../src/services/finance/inventory";
import type { InventoryInput } from "../src/services/finance/inventory";

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  const suffix = ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

// ---- Test A ----
expect("calc 100-35", calculateUnsoldQuantity(100, 35), 65);
expect("calc 100-60", calculateUnsoldQuantity(100, 60), 40);
expect("calc 100-100", calculateUnsoldQuantity(100, 100), 0);
expect("calc 100-0", calculateUnsoldQuantity(100, 0), 100);
expect("status 100/35", deriveInventoryStatus(100, 35), INVENTORY_STATUS.PARTIALLY_SOLD);
expect("status 100/60", deriveInventoryStatus(100, 60), INVENTORY_STATUS.PARTIALLY_SOLD);
expect("status 100/100", deriveInventoryStatus(100, 100), INVENTORY_STATUS.SOLD);
expect("status 100/0", deriveInventoryStatus(100, 0), INVENTORY_STATUS.UNSOLD);

// ---- Test B ----
const overSold = validateInventoryInput(
  { date: Date.now(), aggregate: "00", originalQuantity: 100, soldQuantity: 120, unsoldQuantity: 0 },
);
expect("reject sold>original", overSold.valid, false);
expect(
  "reject sold>original message",
  overSold.errors.soldQuantity?.includes("cannot exceed Original"),
  true,
);

const negativeSold = validateInventoryInput({
  date: Date.now(),
  aggregate: "00",
  originalQuantity: 100,
  soldQuantity: -5,
  unsoldQuantity: 0,
});
expect("reject negative sold", negativeSold.valid, false);

const nanOriginal = validateInventoryInput({
  date: Date.now(),
  aggregate: "00",
  originalQuantity: NaN as unknown as number,
  soldQuantity: 0,
  unsoldQuantity: 0,
});
expect("reject NaN original", nanOriginal.valid, false);

const infiniteSold = validateInventoryInput({
  date: Date.now(),
  aggregate: "00",
  originalQuantity: 100,
  soldQuantity: Infinity as unknown as number,
  unsoldQuantity: 0,
});
expect("reject Infinity sold", infiniteSold.valid, false);

// Negative original
const negativeOriginal = validateInventoryInput({
  date: Date.now(),
  aggregate: "00",
  originalQuantity: -10,
  soldQuantity: 0,
  unsoldQuantity: 0,
});
expect("reject negative original", negativeOriginal.valid, false);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
