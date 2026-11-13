/**
 * Verification for Test C — source synchronization idempotency:
 *   - Two eligible source orders → two AUTO_SOURCE records on first sync
 *   - Running sync again → no duplicates and no changes
 *   - runs twice = same record count as once
 * Run: bun scripts/inventory-sync-verify.ts
 */
import {
  inventoryRepository,
  calculateUnsoldQuantity,
  deriveInventoryStatus,
  INVENTORY_STATUS,
  type InventorySourceOrder,
} from "../src/services/finance/inventory";

// Bun/Node has no localStorage — the repository no-ops persistence outside
// the browser. Inject an in-memory shim ONLY for this verification run so
// the same storage contract is exercised.
if (typeof (globalThis as any).localStorage === "undefined") {
  const store = new Map();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  const suffix = ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

const sources: InventorySourceOrder[] = [
  {
    sourceInvoiceId: "inv-sync-test-1",
    sourceOrderId: "ord-sync-test-1",
    invoiceNumber: "INV-00001",
    fsNo: "2704301",
    aggregate: "02",
    originalQuantity: 16.74,
    date: Date.now(),
  },
  {
    sourceInvoiceId: "inv-sync-test-1",
    sourceOrderId: "ord-sync-test-2",
    invoiceNumber: "AUTO-SYNC-TEST",
    fsNo: "2704301",
    aggregate: "00",
    originalQuantity: 100,
    date: Date.now(),
  },
];

// Run 1 — creates both records
const run1 = await inventoryRepository.syncSourceOrders(sources, "test@nexerp.dev");
expect("run 1 creates 2", run1.created, 2);

// Run 2 — idempotent, no changes
const run2 = await inventoryRepository.syncSourceOrders(sources, "test@nexerp.dev");
expect("run 2 creates 0", run2.created, 0);
expect("run 2 reconciles 0", run2.reconciled, 0);

// Run 3 — a third time, idempotent again
const run3 = await inventoryRepository.syncSourceOrders(sources, "test@nexerp.dev");
expect("run 3 creates 0", run3.created, 0);

// Verify no duplicate records exist for the same source key
const all = await inventoryRepository.getRecords();
const key1 = all.filter(
  (r) => r.sourceInvoiceId === "inv-sync-test-1" && r.sourceOrderId === "ord-sync-test-1",
).length;
const key2 = all.filter(
  (r) => r.sourceInvoiceId === "inv-sync-test-1" && r.sourceOrderId === "ord-sync-test-2",
).length;
expect("no duplicate per source key (order1)", key1, 1);
expect("no duplicate per source key (order2)", key2, 1);

// Verify derived values on a created record
const record = all.find(
  (r) => r.sourceInvoiceId === "inv-sync-test-1" && r.sourceOrderId === "ord-sync-test-2",
)!;
expect("auto record origin", record.origin, "AUTO_SOURCE");
expect("auto record unsold = original", record.unsoldQuantity, 100);
expect(
  "auto record status",
  deriveInventoryStatus(record.originalQuantity, record.soldQuantity),
  INVENTORY_STATUS.UNSOLD,
);
expect(
  "unsold calc from record",
  calculateUnsoldQuantity(record.originalQuantity, record.soldQuantity),
  100,
);

// Verify recorded sold entry reconciles (Finance enters 35 / 100)
const updated = await inventoryRepository.updateRecord(
  record.id,
  { soldQuantity: 35 },
  "finance@company.com",
);
expect("sold 35 → unsold 65", updated.unsoldQuantity, 65);
expect("sold 35 → status partially sold", updated.status, INVENTORY_STATUS.PARTIALLY_SOLD);
const updated2 = await inventoryRepository.updateRecord(
  record.id,
  { soldQuantity: 100 },
  "finance@company.com",
);
expect("sold 100 → unsold 0", updated2.unsoldQuantity, 0);
expect("sold 100 → status sold", updated2.status, INVENTORY_STATUS.SOLD);

// Verify sync does not overwrite recorded sold (idempotent across changes)
const run4 = await inventoryRepository.syncSourceOrders(sources, "test@nexerp.dev");
expect("sync after manual edit creates 0", run4.created, 0);
expect("sync after manual edit reconciles 0", run4.reconciled, 0);
const afterSync = await inventoryRepository.getRecords();
const persisted = afterSync.find(
  (r) => r.sourceInvoiceId === "inv-sync-test-1" && r.sourceOrderId === "ord-sync-test-2",
)!;
expect("sync preserves recorded sold", persisted.soldQuantity, 100);

// Clean up test records
await inventoryRepository.deleteRecord(
  (await inventoryRepository.getRecords()).find(
    (r) => r.sourceInvoiceId === "inv-sync-test-1" && r.sourceOrderId === "ord-sync-test-2",
  )!.id,
);
await inventoryRepository.deleteRecord(
  (await inventoryRepository.getRecords()).find(
    (r) => r.sourceInvoiceId === "inv-sync-test-1" && r.sourceOrderId === "ord-sync-test-1",
  )!.id,
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
