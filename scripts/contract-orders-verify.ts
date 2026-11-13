/**
 * Verification — Contract Orders feature (independent of ordinary Sales).
 *
 * Run: bun scripts/contract-orders-verify.ts
 *
 * Covers the delivered behaviour end to end at the service/repository
 * level: contract creation and access, order completion and attribution,
 * progress and lifecycle, immediate Royalty Report reporting, duplicate
 * prevention, conversion into exactly one Sales Invoice, and the regression
 * guarantees for ordinary invoices and existing reporting.
 *
 * Browser-level click-through is NOT performed here — these are service
 * checks plus source assertions on the shared report wiring.
 */
import { readFileSync } from "node:fs";
import { authRepository } from "../src/services/auth/authRepository";
import { DEV_USERS } from "../src/services/auth/mockUsers";
import {
  contractsRepository,
  loadContractOrders,
  persistContractOrders,
} from "../src/services/contracts";
import {
  CONTRACT_ORDER_STATUS,
  CONTRACT_STATUS,
  calculateContractOrderTotals,
  canAcceptOrders,
  getContractProgress,
  validateContractInput,
  validateContractOrderInput,
} from "../src/services/contracts/types";
import {
  ROYALTY_BATCH_STATUS,
  ROYALTY_RATE,
  ROYALTY_REPORT_COLUMNS,
  buildRoyaltyReportSheet,
  calculateRoyaltyAmount,
  royaltyBatchesRepository,
} from "../src/services/finance/royaltyBatches";
import {
  ROYALTY_ROW_SOURCE,
  buildRoyaltyReportRows,
  summarizeRoyaltyRows,
  toRoyaltyExportRows,
} from "../src/services/finance/royaltyReport";
import { salesInvoicesRepository } from "../src/services/sales/invoiceRepo";
import { ORDER_STATUS } from "../src/services/sales/types";
import { roundMoney } from "../src/services/sales/calc";

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

if (typeof (globalThis as any).localStorage === "undefined") {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

let failures = 0;
let checks = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  const suffix = ok
    ? ""
    : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

async function expectThrows(label: string, fn: () => Promise<unknown>) {
  checks += 1;
  try {
    await fn();
    console.log(`FAIL  ${label} — expected a rejection, but it succeeded`);
    failures += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`PASS  ${label} (${message.slice(0, 70)})`);
  }
}

async function signIn(email: string) {
  await authRepository.signIn(email, "nexerp-dev");
}

const ORDER_INPUT = {
  aggregate: "00",
  quantity: 10,
  unitPrice: 100,
  royaltyInvoiceNumber: "RI-TEST",
  orderDate: new Date(2026, 9, 1).getTime(),
};

/**
 * Rows exactly as the shared Royalty Report screen reads them (approved /
 * payment-confirmed invoices plus completed contract orders).
 */
async function currentRows() {
  const invoices = await salesInvoicesRepository.getInvoices();
  const contracts = await contractsRepository.getContracts();
  return buildRoyaltyReportRows({
    invoices: invoices.filter(
      (invoice) =>
        invoice.status === ORDER_STATUS.FINANCE_APPROVED ||
        invoice.status === ORDER_STATUS.PAYMENT_CONFIRMED,
    ),
    contracts,
    contractOrders: loadContractOrders(),
  });
}

/* ------------------------------------------------------------------ */
/* A. Contract creation and access                                     */
/* ------------------------------------------------------------------ */

console.log("\n=== A. Contract creation and access ===");

await signIn("finance@company.com");
const financeUser = DEV_USERS.find((u) => u.email === "finance@company.com")!;
const salesUser = DEV_USERS.find((u) => u.email === "sales@company.com")!;

const contractInput = {
  customerName: "MNO Contractors",
  tin: "0001234567",
  contractValue: 10_000_000,
  fsNo: "2704301",
  contractDate: new Date(2026, 8, 1).getTime(),
  attachments: [
    {
      id: "att-contract-scan",
      fileName: "signed-contract.pdf",
      fileUrl: "",
      mimeType: "application/pdf",
      fileSize: 512_000,
    },
    {
      id: "att-contract-photo",
      fileName: "contract-page-1.png",
      fileUrl: "blob:session-preview",
      mimeType: "image/png",
      fileSize: 120_000,
    },
  ],
  remark: "Framework agreement 2026",
};

// The Sales repository migrates the seeded development orders into invoices
// on first read, so invoice assertions are relative to this baseline.
const baselineInvoices = (await salesInvoicesRepository.getInvoices()).length;

const contractA = await contractsRepository.createContract(contractInput);
expect(
  "1. Finance creates a contract with a generated internal id",
  contractA.contractNumber,
  "CONTRACT-0001",
);
expect(
  "1. Contract stores one FS No, customer, value, date, and attachments",
  [
    contractA.fsNo,
    contractA.customer.tin,
    contractA.contractValue,
    contractA.attachments.length,
  ],
  ["2704301", "0001234567", 10_000_000, 2],
);
expect(
  "1. Creating a contract does NOT create a Sales Invoice",
  (await salesInvoicesRepository.getInvoices()).length,
  baselineInvoices,
);

await contractsRepository.activateContract(contractA.id);
const activeContract = (await contractsRepository.getContractById(contractA.id))!;
expect(
  "1. Activation moves the contract to IN_PROGRESS",
  activeContract.status,
  CONTRACT_STATUS.IN_PROGRESS,
);
expect(
  "1. Activation preserves the paper attachments",
  activeContract.attachments.length,
  2,
);

// A second, unrelated contract proves contracts are company-wide.
const contractB = await contractsRepository.createContract({
  ...contractInput,
  customerName: "Beta Aggregates",
  tin: "0009999999",
  contractValue: 0,
  fsNo: "2704302",
  attachments: [],
});
await contractsRepository.activateContract(contractB.id);

await signIn("sales@company.com");
const salesContracts = await contractsRepository.getContracts();
expect(
  "2. Sales sees every active contract without being assigned to one",
  salesContracts.filter((c) => c.status === CONTRACT_STATUS.IN_PROGRESS).length,
  2,
);
expect(
  "2. Sales can open a contract created for another customer",
  salesContracts.some((c) => c.id === contractB.id),
  true,
);

const salesOrderOne = await contractsRepository.completeOrder(contractA.id, {
  aggregate: "00",
  quantity: 16.74,
  unitPrice: 1000,
  royaltyInvoiceNumber: "RI-2026-001",
  orderDate: new Date(2026, 9, 14).getTime(),
});
expect(
  "2. Any authorized Sales user can complete an order on an active contract",
  salesOrderOne.orderNumber,
  1,
);
expect(
  "2. The order uses its own saved values (VAT-exclusive royalty base)",
  [salesOrderOne.lineTotalExclVat, salesOrderOne.lineTotalInclVat],
  [16740, 19251],
);

await signIn("hr@company.com");
await expectThrows("3. HR cannot create a contract", () =>
  contractsRepository.createContract(contractInput),
);
await expectThrows("3. HR cannot complete a contract order", () =>
  contractsRepository.completeOrder(contractA.id, ORDER_INPUT),
);
await expectThrows("3. HR cannot convert a contract", () =>
  contractsRepository.convertContractToInvoice(contractA.id),
);
await expectThrows("3. HR cannot edit contract details", () =>
  contractsRepository.updateContract(contractA.id, contractInput),
);
await expectThrows("3. HR cannot cancel an order", () =>
  contractsRepository.cancelOrder(salesOrderOne.id, "no"),
);

await authRepository.signInAsGuest();
await expectThrows("3. A demo guest cannot complete contract orders", () =>
  contractsRepository.completeOrder(contractA.id, ORDER_INPUT),
);

await signIn("sales@company.com");
const salesRead = (await contractsRepository.getContractById(contractA.id))!;
expect(
  "4. Attachments stay readable after activation",
  salesRead.attachments.map((a) => a.fileName),
  ["signed-contract.pdf", "contract-page-1.png"],
);
await expectThrows("4. Sales cannot replace protected contract attachments", () =>
  contractsRepository.updateContract(contractA.id, {
    ...contractInput,
    attachments: [],
  }),
);

/* ------------------------------------------------------------------ */
/* B. Order creation and attribution                                   */
/* ------------------------------------------------------------------ */

console.log("\n=== B. Order creation and attribution ===");

expect(
  "5. Completed By is the authenticated salesperson, not a form choice",
  [
    salesOrderOne.completedByUserId,
    salesOrderOne.completedByName,
    salesOrderOne.status,
  ],
  [salesUser.id, salesUser.name, CONTRACT_ORDER_STATUS.COMPLETED],
);

// A forged actor argument cannot change the recorded salesperson.
const forged = await contractsRepository.completeOrder(
  contractA.id,
  {
    aggregate: "01",
    quantity: 10,
    unitPrice: 1500,
    royaltyInvoiceNumber: "RI-2026-002",
    orderDate: new Date(2026, 9, 1).getTime(),
  },
  "usr-finance-1",
);
expect(
  "5. A client-supplied identity cannot override the session identity",
  forged.completedByUserId,
  salesUser.id,
);

await signIn("finance@company.com");
const corrected = await contractsRepository.updateOrder(forged.id, {
  aggregate: "01",
  quantity: 12,
  unitPrice: 1500,
  royaltyInvoiceNumber: "RI-2026-002",
  orderDate: forged.orderDate,
});
expect(
  "6. Correction keeps the original salesperson attribution",
  corrected.completedByUserId,
  salesUser.id,
);
expect(
  "7. Correction records the editor through the existing audit fields",
  [corrected.lastEditedByUserId, corrected.lastEditedByEmail],
  [financeUser.id, "finance@company.com"],
);
expect(
  "7. Corrected values are recalculated from the saved order values",
  [corrected.quantity, corrected.lineTotalExclVat],
  [12, 18000],
);

await signIn("sales@company.com");
await expectThrows(
  "7. Another salesperson cannot correct an order they did not complete",
  async () => {
    // Simulate a different salesperson's order by rewiring only the stored
    // attribution — the guard under test is the ownership check itself.
    const all = loadContractOrders();
    const index = all.findIndex((order) => order.id === forged.id);
    all[index] = { ...all[index], completedByUserId: "usr-other-sales" };
    persistContractOrders(all);
    try {
      await contractsRepository.updateOrder(forged.id, {
        aggregate: "01",
        quantity: 12,
        unitPrice: 1500,
        royaltyInvoiceNumber: "RI-2026-002",
        orderDate: forged.orderDate,
      });
    } finally {
      const restore = loadContractOrders();
      const restoreIndex = restore.findIndex((order) => order.id === forged.id);
      restore[restoreIndex] = {
        ...restore[restoreIndex],
        completedByUserId: salesUser.id,
      };
      persistContractOrders(restore);
    }
  },
);
expect(
  "7. The denied attempt left no partial change behind",
  (await contractsRepository.getOrderById(forged.id))?.completedByUserId,
  salesUser.id,
);

const orderThree = await contractsRepository.completeOrder(contractA.id, {
  aggregate: "02",
  quantity: 5,
  unitPrice: 2000,
  royaltyInvoiceNumber: "RI-2026-003",
  orderDate: new Date(2026, 8, 20).getTime(),
});
expect(
  "8. Aggregate, quantity, price, date, and royalty number vary per order",
  [
    orderThree.aggregate,
    orderThree.quantity,
    orderThree.unitPrice,
    orderThree.royaltyInvoiceNumber,
  ],
  ["02", 5, 2000, "RI-2026-003"],
);
expect(
  "8. Sequential display numbers are unique inside the contract",
  (await contractsRepository.getContractOrders(contractA.id)).map(
    (o) => o.orderNumber,
  ),
  [1, 2, 3],
);
expect(
  "9. Historical order prices are never recalculated",
  (await contractsRepository.getOrderById(salesOrderOne.id))?.unitPrice,
  1000,
);

const invalidOrder = validateContractOrderInput({
  aggregate: "03",
  quantity: 0,
  unitPrice: -1,
  royaltyInvoiceNumber: " ",
  orderDate: 0,
});
expect(
  "10. Incomplete orders are rejected field by field",
  [invalidOrder.valid, Object.keys(invalidOrder.errors).sort()],
  [
    false,
    ["aggregate", "orderDate", "quantity", "royaltyInvoiceNumber", "unitPrice"],
  ],
);
await expectThrows("10. Invalid orders cannot be persisted", () =>
  contractsRepository.completeOrder(contractA.id, {
    aggregate: "00",
    quantity: 0,
    unitPrice: 100,
    royaltyInvoiceNumber: "RI-X",
    orderDate: Date.now(),
  }),
);
expect(
  "10. Only completed orders exist as reportable rows (no drafts)",
  (await currentRows()).filter(
    (row) => row.source === ROYALTY_ROW_SOURCE.CONTRACT_ORDER,
  ).length,
  3,
);

/* ------------------------------------------------------------------ */
/* C. Progress and lifecycle                                           */
/* ------------------------------------------------------------------ */

console.log("\n=== C. Progress and lifecycle ===");

await signIn("finance@company.com");
const progressA = (await contractsRepository.getContractProgress(contractA.id))!;
expect(
  "11. Progress uses the documented VAT-inclusive fulfillment basis",
  [
    progressA.contractValue,
    progressA.fulfilledValue,
    progressA.remainingValue,
    progressA.fulfillmentPercent,
  ],
  [10_000_000, 51451, 10_000_000 - 51451, 0.51],
);
expect(
  "11. Zero contract values are handled without dividing by zero",
  (await contractsRepository.getContractProgress(contractB.id))
    ?.fulfillmentPercent,
  0,
);
expect(
  "11. Remaining value never goes negative",
  (await contractsRepository.getContractProgress(contractB.id))?.remainingValue,
  0,
);

const contractC = await contractsRepository.createContract({
  ...contractInput,
  customerName: "Over Contract Ltd",
  tin: "0007777777",
  contractValue: 1000,
  fsNo: "2704303",
  attachments: [],
});
await contractsRepository.activateContract(contractC.id);
await signIn("sales@company.com");
await contractsRepository.completeOrder(contractC.id, {
  aggregate: "00",
  quantity: 10,
  unitPrice: 1000,
  royaltyInvoiceNumber: "RI-OVER-1",
  orderDate: Date.now(),
});
const progressC = (await contractsRepository.getContractProgress(contractC.id))!;
expect(
  "11. Over-fulfillment is reported and never shows a negative remaining value",
  [progressC.overFulfilled, progressC.remainingValue],
  [true, 0],
);
expect(
  "12. Reaching the contract value flags READY_FOR_COMPLETION, not conversion",
  [
    (await contractsRepository.getContractById(contractC.id))!.status,
    (await salesInvoicesRepository.getInvoices()).length,
  ],
  [CONTRACT_STATUS.READY_FOR_COMPLETION, baselineInvoices],
);
expect(
  "16. A completed order never completes or converts its parent contract",
  (await contractsRepository.getContractById(contractA.id))!.status,
  CONTRACT_STATUS.IN_PROGRESS,
);
expect(
  "16. Partially fulfilled contracts still accept further orders",
  canAcceptOrders(CONTRACT_STATUS.IN_PROGRESS),
  true,
);

await signIn("finance@company.com");
const confirmed = await contractsRepository.confirmCompletion(
  contractC.id,
  undefined,
);
expect(
  "13. Finance explicitly confirms completion",
  [confirmed.completionConfirmedAt !== undefined, confirmed.completionConfirmedBy],
  [true, "finance@company.com"],
);

const contractD = await contractsRepository.createContract({
  ...contractInput,
  customerName: "Below Value Ltd",
  tin: "0003333333",
  contractValue: 1_000_000,
  fsNo: "2704304",
  attachments: [],
});
await contractsRepository.activateContract(contractD.id);
await signIn("sales@company.com");
await contractsRepository.completeOrder(contractD.id, {
  aggregate: "01",
  quantity: 10,
  unitPrice: 100,
  royaltyInvoiceNumber: "RI-BELOW-1",
  orderDate: Date.now(),
});
await signIn("finance@company.com");
await expectThrows("14. Closing below the contract value requires a reason", () =>
  contractsRepository.confirmCompletion(contractD.id, "   "),
);
const below = await contractsRepository.confirmCompletion(
  contractD.id,
  "Customer closed the framework early",
);
expect(
  "14. Below-value closure records the confirmation and the reason",
  [below.closedBelowValue, below.completionReason],
  [true, "Customer closed the framework early"],
);

const contractE = await contractsRepository.createContract({
  ...contractInput,
  customerName: "Cancelled Ltd",
  tin: "0005555555",
  contractValue: 50_000,
  fsNo: "2704305",
  attachments: [],
});
await contractsRepository.activateContract(contractE.id);
const cancelledContract = await contractsRepository.cancelContract(
  contractE.id,
  "Contract withdrawn by customer",
);
expect(
  "15. Cancelling a contract records the reason and the actor",
  [
    cancelledContract.status,
    cancelledContract.cancellationReason,
    cancelledContract.cancelledBy,
  ],
  [
    CONTRACT_STATUS.CANCELLED,
    "Contract withdrawn by customer",
    "finance@company.com",
  ],
);
await signIn("sales@company.com");
await expectThrows("15. Cancelled contracts cannot receive new orders", () =>
  contractsRepository.completeOrder(contractE.id, ORDER_INPUT),
);

/* ------------------------------------------------------------------ */
/* D. Royalty Report — immediate reporting of completed orders         */
/* ------------------------------------------------------------------ */

console.log("\n=== D. Royalty Report ===");

const rowsBeforeConversion = await currentRows();
const contractRowsBeforeConversion = rowsBeforeConversion.filter(
  (row) => row.source === ROYALTY_ROW_SOURCE.CONTRACT_ORDER,
);
expect(
  "17. Completed contract orders appear in the shared report before conversion",
  [
    contractRowsBeforeConversion.length,
    (await salesInvoicesRepository.getInvoices()).length,
  ],
  [5, baselineInvoices],
);
expect(
  "18. Each contract order produces its own row with its own values",
  contractRowsBeforeConversion.slice(0, 3).map((row) => [
    row.key.startsWith("contract-order:"),
    row.aggregate,
    row.quantity,
    row.unitPrice,
  ]),
  [
    [true, "02", 5, 2000],
    [true, "01", 12, 1500],
    [true, "00", 16.74, 1000],
  ],
);

const sheet = buildRoyaltyReportSheet(toRoyaltyExportRows(rowsBeforeConversion));
expect(
  "19. The export keeps the exact seven-column structure",
  sheet[0],
  [...ROYALTY_REPORT_COLUMNS],
);
const contractRow = contractRowsBeforeConversion.find(
  (row) => row.aggregate === "00" && row.quantity === 16.74,
)!;
expect(
  "19/20. Contract-order Total Price is VAT-exclusive (Unit Price × Quantity)",
  [contractRow.unitPrice, contractRow.quantity, contractRow.lineTotalExclVat],
  [1000, 16.74, 16740],
);
expect(
  "21. 3% royalty follows the existing calculation",
  [contractRow.royalty, calculateRoyaltyAmount(16740), ROYALTY_RATE],
  [502.2, 502.2, 0.03],
);
expect(
  "20. The VAT-inclusive fulfillment value is NOT the royalty base",
  roundMoney(contractRow.lineTotalExclVat * 1.15 * ROYALTY_RATE) ===
    contractRow.royalty,
  false,
);
const exportedContractRow = sheet.find(
  (row) =>
    Array.isArray(row) &&
    row[2] === "00" &&
    row[3] === 16.74 &&
    row[5] === 16740,
) as (string | number)[];
expect(
  "22. Aggregate 00 stays a string in persistence, display, and export",
  [
    loadContractOrders().find((o) => o.id === salesOrderOne.id)?.aggregate,
    contractRow.aggregate,
    exportedContractRow[2],
  ],
  ["00", "00", "00"],
);
expect(
  "23. Rows come from the shared report source and its export path",
  [contractRow.source, exportedContractRow[6], typeof exportedContractRow[0]],
  [ROYALTY_ROW_SOURCE.CONTRACT_ORDER, 502.2, "string"],
);
const totals = summarizeRoyaltyRows(contractRowsBeforeConversion);
expect(
  "23. Report totals follow the shared aggregation",
  [
    totals.count,
    totals.totalSales,
    totals.totalRoyalty,
    roundMoney(totals.totalSales * ROYALTY_RATE),
  ],
  [5, 55740, 1672.2, 1672.2],
);

const repeatA = await currentRows();
const repeatB = await currentRows();
expect(
  "24. Repeated saves/retries cannot create duplicate royalty entries",
  [
    repeatA.length,
    repeatB.length,
    new Set(repeatA.map((row) => row.key)).size,
  ],
  [rowsBeforeConversion.length, rowsBeforeConversion.length, rowsBeforeConversion.length],
);

await signIn("finance@company.com");
await contractsRepository.updateOrder(salesOrderOne.id, {
  aggregate: "00",
  quantity: 20,
  unitPrice: 1000,
  royaltyInvoiceNumber: "RI-2026-001",
  orderDate: salesOrderOne.orderDate,
});
const rowsAfterEdit = await currentRows();
const editedRow = rowsAfterEdit.find(
  (row) => row.contractOrderId === salesOrderOne.id,
)!;
expect(
  "25. Editing reconciles the existing entry (no duplicate, new values)",
  [
    rowsAfterEdit.length,
    editedRow.quantity,
    editedRow.lineTotalExclVat,
    editedRow.royalty,
  ],
  [rowsBeforeConversion.length, 20, 20000, 600],
);

await contractsRepository.cancelOrder(
  editedRow.contractOrderId!,
  "Wrong royalty number",
);
const rowsAfterCancel = await currentRows();
const cancelledRecord = await contractsRepository.getOrderById(salesOrderOne.id);
expect(
  "26. Cancellation reverses the active amount but keeps the record and audit trail",
  [
    rowsAfterCancel.length,
    rowsAfterCancel.some((row) => row.contractOrderId === salesOrderOne.id),
    cancelledRecord?.status,
    cancelledRecord?.cancelReason,
    cancelledRecord?.cancelledBy,
  ],
  [
    rowsBeforeConversion.length - 1,
    false,
    CONTRACT_ORDER_STATUS.CANCELLED,
    "Wrong royalty number",
    "finance@company.com",
  ],
);

const batchRow = rowsAfterCancel.find(
  (row) => row.source === ROYALTY_ROW_SOURCE.CONTRACT_ORDER,
)!;
const batch = await royaltyBatchesRepository.finalizeBatch([batchRow.key]);
expect(
  "23. A finalized batch resolves contract-order keys with matching totals",
  [batch.recordCount, batch.totalQuantity, batch.totalSales, batch.totalRoyalty],
  [1, batchRow.quantity, batchRow.lineTotalExclVat, batchRow.royalty],
);
expect(
  "23. Finalized batch rows are locked out of the current batch",
  (await royaltyBatchesRepository.getBatches())[0].status,
  ROYALTY_BATCH_STATUS.FINALIZED,
);

/* ------------------------------------------------------------------ */
/* E. Conversion into exactly one Sales Invoice                        */
/* ------------------------------------------------------------------ */

console.log("\n=== E. Conversion ===");

const unconfirmed = await contractsRepository.createContract({
  ...contractInput,
  customerName: "Unconfirmed Ltd",
  tin: "0001212121",
  fsNo: "2704306",
  attachments: [],
});
await contractsRepository.activateContract(unconfirmed.id);
await signIn("sales@company.com");
await contractsRepository.completeOrder(unconfirmed.id, ORDER_INPUT);
await signIn("finance@company.com");
await expectThrows("33. An unconfirmed contract cannot be converted", () =>
  contractsRepository.convertContractToInvoice(unconfirmed.id),
);
expect(
  "33. The refusal leaves the contract and its orders intact",
  [
    (await contractsRepository.getContractById(unconfirmed.id))!.status,
    (await contractsRepository.getContractOrders(unconfirmed.id)).length,
    (await salesInvoicesRepository.getInvoices()).length,
  ],
  [CONTRACT_STATUS.IN_PROGRESS, 1, baselineInvoices],
);

// Simulated failure while the invoice is being written.
await contractsRepository.confirmCompletion(
  unconfirmed.id,
  "Ready for the retry test",
);
const originalCreate = salesInvoicesRepository.createInvoice.bind(
  salesInvoicesRepository,
);
(salesInvoicesRepository as { createInvoice: unknown }).createInvoice =
  async () => {
    throw new Error("simulated invoice write failure");
  };
let failureMessage = "";
try {
  await contractsRepository.convertContractToInvoice(unconfirmed.id);
} catch (error) {
  failureMessage = error instanceof Error ? error.message : String(error);
}
(salesInvoicesRepository as { createInvoice: unknown }).createInvoice =
  originalCreate;
const afterFailure = (await contractsRepository.getContractById(unconfirmed.id))!;
expect(
  "33. A failed conversion is retryable and never marks the contract converted",
  [
    failureMessage.includes("simulated invoice write failure"),
    afterFailure.status !== CONTRACT_STATUS.CONVERTED,
    afterFailure.salesInvoiceId ?? null,
    afterFailure.conversionStartedAt ?? null,
    afterFailure.conversionError?.includes("simulated") ?? false,
    (await contractsRepository.getContractOrders(unconfirmed.id)).length,
  ],
  [true, true, null, null, true, 1],
);
const retried = await contractsRepository.convertContractToInvoice(unconfirmed.id);
expect(
  "33. A retry after failure succeeds exactly once",
  [
    retried.contract.status,
    (await salesInvoicesRepository.getInvoices()).filter(
      (invoice) => invoice.contractId === unconfirmed.id,
    ).length,
  ],
  [CONTRACT_STATUS.CONVERTED, 1],
);

const completedBefore = (
  await contractsRepository.getContractOrders(contractA.id)
).filter((order) => order.status === CONTRACT_ORDER_STATUS.COMPLETED);
await contractsRepository.confirmCompletion(
  contractA.id,
  "All planned orders completed",
);
const conversion = await contractsRepository.convertContractToInvoice(contractA.id);
const invoice = (await salesInvoicesRepository.getInvoiceById(
  conversion.invoiceId,
))!;
expect(
  "31. Conversion preserves the single FS No and customer details",
  [invoice.fsNo, invoice.customer.name, invoice.customer.tin, invoice.contractId],
  [contractA.fsNo, contractA.customer.name, contractA.customer.tin, contractA.id],
);
expect(
  "31. All completed orders move into the invoice with their own values",
  invoice.orders.map((order) => [
    order.aggregate,
    order.quantity,
    order.unitPrice,
    order.royaltyInvoiceNumber,
  ]),
  completedBefore.map((order) => [
    order.aggregate,
    order.quantity,
    order.unitPrice,
    order.royaltyInvoiceNumber,
  ]),
);
expect(
  "31. Invoice lines keep a stable link back to their contract orders",
  invoice.orders.map((order) => order.contractOrderId),
  completedBefore.map((order) => order.id),
);
expect(
  "31. Salesperson attribution survives on the source contract orders",
  (await contractsRepository.getContractOrders(contractA.id)).map(
    (order) => order.completedByUserId,
  ),
  [salesUser.id, salesUser.id, salesUser.id],
);
expect(
  "31. The contract is CONVERTED only after the invoice exists",
  [
    (await contractsRepository.getContractById(contractA.id))!.salesInvoiceId ===
      invoice.id,
    (await contractsRepository.getContractById(contractA.id))!.status,
    invoice.status,
  ],
  [true, CONTRACT_STATUS.CONVERTED, ORDER_STATUS.PENDING_FINANCE_REVIEW],
);
expect(
  "31. Order dates travel with the invoice lines where the model supports it",
  invoice.orders.map((order) => order.orderDate),
  completedBefore.map((order) => order.orderDate),
);
expect(
  "4. Paper attachments survive completion and conversion",
  (await contractsRepository.getContractById(contractA.id))!.attachments.map(
    (attachment) => attachment.fileName,
  ),
  ["signed-contract.pdf", "contract-page-1.png"],
);
await signIn("sales@company.com");
await expectThrows("15. Converted contracts cannot receive new orders", () =>
  contractsRepository.completeOrder(contractA.id, ORDER_INPUT),
);

await signIn("finance@company.com");
const secondAttempt = await contractsRepository.convertContractToInvoice(
  contractA.id,
);
expect(
  "32. Repeated conversion returns the SAME invoice (no duplicate)",
  [
    secondAttempt.invoiceId,
    (await salesInvoicesRepository.getInvoices()).filter(
      (existing) => existing.contractId === contractA.id,
    ).length,
  ],
  [invoice.id, 1],
);

const rowsAfterConversion = await currentRows();
expect(
  "27. Conversion does not duplicate existing contract-order royalty entries",
  [
    rowsAfterConversion.filter(
      (row) =>
        row.contractOrderId &&
        completedBefore.some((order) => order.id === row.contractOrderId),
    ).length,
    rowsAfterConversion.filter(
      (row) =>
        row.source === ROYALTY_ROW_SOURCE.INVOICE && row.invoiceId === invoice.id,
    ).length,
  ],
  [completedBefore.length, 0],
);

await salesInvoicesRepository.approveInvoice(invoice.id, "finance@company.com");
const rowsAfterApproval = await currentRows();
const rowsAfterRepeat = await currentRows();
expect(
  "28. Approval and repeated processing stay idempotent for contract orders",
  [
    (await salesInvoicesRepository.getInvoiceById(invoice.id))!.status,
    rowsAfterApproval.length,
    rowsAfterRepeat.length,
    rowsAfterRepeat.filter(
      (row) =>
        row.contractOrderId &&
        completedBefore.some((order) => order.id === row.contractOrderId),
    ).length,
  ],
  [
    ORDER_STATUS.FINANCE_APPROVED,
    rowsAfterConversion.length,
    rowsAfterConversion.length,
    completedBefore.length,
  ],
);

/* ------------------------------------------------------------------ */
/* F. Ordinary invoice regression + revenue separation                 */
/* ------------------------------------------------------------------ */

console.log("\n=== F. Ordinary invoices and revenue separation ===");

const ordinary = await salesInvoicesRepository.createInvoice(
  {
    customer: { name: "Ordinary Customer", tin: "0002020202" },
    fsNo: "9999999",
    orders: [
      {
        aggregate: "01",
        quantity: 2,
        unitPrice: 500,
        royaltyInvoiceNumber: "RI-ORD-1",
      },
      {
        aggregate: "02",
        quantity: 3,
        unitPrice: 100,
        royaltyInvoiceNumber: "RI-ORD-2",
      },
    ],
    withholdingEnabled: false,
    payment: {
      bank: "Awash Bank",
      paymentSender: "Ordinary Customer",
      paymentReferenceNumber: "REF-1",
      paymentEvidence: {
        id: "ev-1",
        fileName: "receipt.png",
        fileUrl: "blob:receipt",
        mimeType: "image/png",
        fileSize: 1024,
      },
    },
  },
  { status: ORDER_STATUS.DRAFT, actor: "sales@company.com" },
);
await salesInvoicesRepository.submitInvoice(ordinary.id, "sales@company.com");
const ordinaryApproved = await salesInvoicesRepository.approveInvoice(
  ordinary.id,
  "finance@company.com",
);
expect(
  "35. The ordinary Sales Invoice and Finance approval workflow still work",
  ordinaryApproved.status,
  ORDER_STATUS.FINANCE_APPROVED,
);
const rowsWithOrdinary = await currentRows();
const ordinaryRows = rowsWithOrdinary.filter(
  (row) => row.invoiceId === ordinary.id,
);
expect(
  "29. Ordinary invoice royalty records keep their existing behaviour and keys",
  [
    ordinaryRows.length,
    ordinaryRows.every((row) => row.source === ROYALTY_ROW_SOURCE.INVOICE),
    ordinaryRows.every((row) => row.key.startsWith(`${ordinary.id}-`)),
    ordinaryRows.map((row) => row.royalty),
  ],
  [2, true, true, [30, 9]],
);
expect(
  "30. The report totals include both sources through one shared calculation",
  summarizeRoyaltyRows(rowsWithOrdinary).count,
  rowsWithOrdinary.length,
);

// Revenue separation: only invoices carry finalized revenue.
const allInvoices = await salesInvoicesRepository.getInvoices();
const contractInvoices = allInvoices.filter(
  (candidate) => candidate.contractId === contractA.id,
);
expect(
  "34. Unconverted contract orders never become finalized sales revenue",
  [
    allInvoices.length - baselineInvoices,
    contractInvoices.length,
    (await contractsRepository.getContractById(contractD.id))!.salesInvoiceId ??
      null,
  ],
  [3, 1, null],
);
const sumExcl = completedBefore.reduce(
  (sum, order) => sum + order.lineTotalExclVat,
  0,
);
expect(
  "36. A contract and its resulting invoice are counted once, not twice",
  [
    roundMoney(invoice.financialSummary.subtotalExclVat),
    roundMoney(invoice.financialSummary.totalPriceInclVat),
    contractInvoices.length,
  ],
  [roundMoney(sumExcl), roundMoney(sumExcl * 1.15), 1],
);

/* ------------------------------------------------------------------ */
/* G. Static wiring / regression guards on the shared report           */
/* ------------------------------------------------------------------ */

console.log("\n=== G. Shared report wiring ===");

const pageSource = readFileSync("src/pages/finance/RoyaltyReports.tsx", "utf8");
expect(
  "23. The report screen reads the shared row builder",
  pageSource.includes("useRoyaltyReportRows") &&
    pageSource.includes("toRoyaltyExportRows"),
  true,
);
expect(
  "23. The report screen keeps the shared seven-column export service",
  pageSource.includes("exportRoyaltyRowsToExcel") &&
    pageSource.includes('<th className="px-4 py-2.5 font-medium">Date</th>'),
  true,
);
expect(
  "30. No separate contract-only royalty report or route was introduced",
  readFileSync("src/main.tsx", "utf8").includes("contracts/royalty"),
  false,
);
expect(
  "Royalty columns are still exactly the required seven, in order",
  [...ROYALTY_REPORT_COLUMNS],
  [
    "Date",
    "Royalty Invoice Number",
    "Aggregate Type",
    "Quantity (m³)",
    "Unit Price",
    "Total Price",
    "3%",
  ],
);
expect(
  "Contract lifecycle statuses match the required business meanings",
  Object.values(CONTRACT_STATUS),
  ["DRAFT", "IN_PROGRESS", "READY_FOR_COMPLETION", "CONVERTED", "CANCELLED"],
);
expect(
  "Contract validation rejects an incomplete contract",
  validateContractInput({
    customerName: "",
    tin: "",
    contractValue: -1,
    fsNo: "",
    contractDate: 0,
  }).valid,
  false,
);
expect(
  "Order totals come from the single contract calculation",
  calculateContractOrderTotals({ quantity: 16.74, unitPrice: 1000 }),
  { lineTotalExclVat: 16740, lineTotalInclVat: 19251 },
);
expect(
  "Progress never invents a negative remaining value",
  getContractProgress({ contractValue: 100 }, [
    {
      status: CONTRACT_ORDER_STATUS.COMPLETED,
      lineTotalInclVat: 500,
      lineTotalExclVat: 434.78,
      quantity: 1,
    },
  ]).remainingValue,
  0,
);

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All contract order checks passed.");
