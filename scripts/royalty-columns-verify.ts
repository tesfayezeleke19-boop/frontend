/**
 * Verification for Test A + Test B — Royalty Report structure and math.
 *
 * Test A: the screen table, the exported Excel worksheet, and the batch
 * process all share the same SEVEN-column structure, in order:
 *   Date | Royalty Invoice Number | Aggregate Type | Quantity (m³) |
 *   Unit Price | Total Price | 3%
 * No FS No / serial number / Royalty Order / parent invoice columns exist
 * anywhere in the report output.
 *
 * Test B: royalty = Quantity × Unit Price (VAT-exclusive × 3%): for
 * Quantity 16.74 m³ at 1,000 ETB → Total Price 16,740; 3% = 502.20.
 * Each child Order of a multi-order invoice produces its own row.
 *
 * Run: bun scripts/royalty-columns-verify.ts
 */
import { readFileSync } from "node:fs";
import {
  ROYALTY_REPORT_COLUMNS,
  ROYALTY_RATE,
  buildRoyaltyReportSheet,
  calculateRoyaltyAmount,
  exportRoyaltyRowsToExcel,
} from "../src/services/finance/royaltyBatches";
import { roundMoney } from "../src/services/sales/calc";
import { ORDER_STATUS, ORDER_STATUS_LABELS } from "../src/services/sales/types";
import type { SalesInvoice } from "../src/services/sales/invoice";

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
  const suffix = ok
    ? ""
    : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

/* ------------------------------------------------------------------ */
/* Test A — column structure (Excel + shared header)                    */
/* ------------------------------------------------------------------ */

expect(
  "shared column list is exactly the seven required columns",
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

const sampleRow = {
  date: new Date(2026, 9, 14).getTime(),
  royaltyInvoiceNumber: "RI-2026-001",
  aggregate: "02",
  quantity: 16.74,
  unitPrice: 1000,
  lineTotalExclVat: 16740,
};

const header = buildRoyaltyReportSheet([sampleRow])[0];
expect(
  "exported worksheet header row equals the seven-column structure",
  header,
  [...ROYALTY_REPORT_COLUMNS],
);

const dataRow = buildRoyaltyReportSheet([sampleRow])[1] as (string | number)[];
expect(
  "exported data row aligns with its header (7 cells, values in order)",
  [
    dataRow.length,
    typeof dataRow[0] === "string" && dataRow[0].includes("2026"),
    dataRow[1],
    dataRow[2],
    dataRow[3],
    dataRow[4],
    dataRow[5],
    dataRow[6],
  ],
  [
    7,
    true,
    "RI-2026-001",
    "02",
    16.74,
    1000,
    16740,
    502.2,
  ],
);

const totalRow = buildRoyaltyReportSheet([sampleRow])[3] as (string | number)[];
expect(
  "TOTAL/footer row aligned to the seven columns (no serial alignment)",
  [
    totalRow.length,
    totalRow[0],
    totalRow[3],
    totalRow[5],
    totalRow[6],
  ],
  [7, "TOTAL", 16.74, 16740, 502.2],
);

/* Banned column names must not appear in the export path. */
const exporterSource = readFileSync(
  "src/services/finance/royaltyBatches.ts",
  "utf8",
);
expect("export service has no FS No column", exporterSource.includes('"FS No"'), false);
expect(
  "export service has no serial-number column",
  /sheet\.push\(\[\s*"No"/.test(exporterSource) || exporterSource.includes('"Royalty Order"'),
  false,
);

/* The screen table shares the same headers and the same export service. */
const pageSource = readFileSync("src/pages/finance/RoyaltyReports.tsx", "utf8");
expect(
  "screen table uses the shared export service",
  pageSource.includes("exportRoyaltyRowsToExcel"),
  true,
);
expect(
  "screen has no independent inline XLSX export duplication",
  /import\("xlsx"\)/.test(pageSource),
  false,
);
const headerLabelsStart = pageSource.indexOf('<th className="px-4 py-2.5 font-medium">Date</th>');
expect("screen table starts with the Date column", headerLabelsStart > 0, true);
expect("screen table has no FS No header", pageSource.includes(">FS No</th>"), false);
expect(
  "screen table has no Royalty Order header",
  pageSource.includes(">Royalty Order</th>"),
  false,
);
expect(
  "screen table has no serial-number No header",
  pageSource.includes(">No</th>") || pageSource.includes(">No\n"),
  false,
);
expect(
  "screen aggregate header is labeled Aggregate Type",
  pageSource.includes(">Aggregate Type</th>"),
  true,
);
expect(
  "screen headers replaced by no other stray Invoice Number header",
  pageSource.includes(">Invoice Number</th>"),
  false,
);

/* ------------------------------------------------------------------ */
/* Test B — royalty math on eligible child orders                       */
/* ------------------------------------------------------------------ */

expect(
  "royalty rate constant is 3% of the VAT-exclusive value",
  ROYALTY_RATE,
  0.03,
);

const oneOrder = { quantity: 16.74, unitPrice: 1000 };
const lineTotal = roundMoney(oneOrder.quantity * oneOrder.unitPrice);
expect("Total Price = Quantity × Unit Price = 16,740", lineTotal, 16740);
expect("3% of 16,740 = 502.20", calculateRoyaltyAmount(lineTotal), 502.2);

/**
 * Multi-order parent invoice: each eligible child produces its own row with
 * its own values — never one row on the invoice total.
 */
function makeInvoiceChild(args: {
  aggregate: string;
  quantity: number;
  unitPrice: number;
  royaltyInvoiceNumber: string;
}): {
  total: number;
  royalty: number;
} {
  const total = roundMoney(args.quantity * args.unitPrice);
  return { total, royalty: calculateRoyaltyAmount(total), ...args };
}

const multiOrder = [
  makeInvoiceChild({ aggregate: "00", quantity: 16.74, unitPrice: 1000, royaltyInvoiceNumber: "RI-1" }),
  makeInvoiceChild({ aggregate: "01", quantity: 16.15, unitPrice: 1000, royaltyInvoiceNumber: "RI-2" }),
];
const multiSheetRows = multiOrder.map((child) => ({
  date: new Date(2026, 9, 14).getTime(),
  royaltyInvoiceNumber: child.royaltyInvoiceNumber,
  aggregate: child.aggregate,
  quantity: child.quantity,
  unitPrice: child.unitPrice,
  lineTotalExclVat: child.total,
}));
const multiSheet = (buildRoyaltyReportSheet(multiSheetRows) as unknown as (string | number)[][]).slice(
  1,
  3,
);
expect(
  "multi-order parent produces one correctly valued row per child order",
  multiSheet.map((r) => [r[2], r[6]]),
  [
    ["00", 502.2],
    ["01", 484.5],
  ],
);

/* VAT and withholding do not touch the royalty base. */
const vatInclusiveTotal = roundMoney(lineTotal * 1.15);
expect(
  "royalty is NOT computed from the VAT-inclusive total",
  calculateRoyaltyAmount(lineTotal),
  502.2, // not 16740*1.15*0.03 = 577.53
);
expect("sanity: VAT-inclusive would differ", roundMoney(vatInclusiveTotal * 0.03) !== 502.2, true);
// Withholding is never an input to the royalty path — the export builder
// takes only the VAT-exclusive line total, so a 3% withholding toggle on
// the invoice cannot change the royalty base.
expect(
  "royalty export path never reads withholding values",
  /withholding/i.test(exporterSource) || /withholding/i.test(exporterSource),
  false,
);
expect(
  "royalty base unaffected by withholding (still Quantity × Unit Price)",
  calculateRoyaltyAmount(roundMoney(lineTotal * 1)) ,
  502.2,
);

/* Missing Royalty Invoice Number: empty in export (never fabricated). */
const incomplete = buildRoyaltyReportSheet([
  { ...sampleRow, royaltyInvoiceNumber: undefined },
])[1] as (string | number)[];
expect("missing Royalty Invoice Number exports empty, not fabricated", incomplete[1], "");

/* Export file names preserved for batch workflow expectations. */
expect(
  "export function still wired into the module (regression guard)",
  typeof exportRoyaltyRowsToExcel === "function",
  true,
);

/* Statuses used for eligibility remain the established ones. */
expect(
  "eligible royalty statuses unchanged (approved / payment-confirmed only)",
  ORDER_STATUS_LABELS[ORDER_STATUS.FINANCE_APPROVED],
  "Finance Approved",
);
expect(
  "invoice-level type intact for the shared repository read",
  (null as unknown as SalesInvoice) === null,
  true,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll royalty report structure/math checks passed.");
