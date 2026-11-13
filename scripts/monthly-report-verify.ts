/**
 * Verification for the redesigned monthly unsold-aggregate reporting
 * feature (business specification "Redesign Monthly Inventory Reporting").
 *
 * Test A — Reporting start month: configured start, no pre-start missing
 *   periods, pre-start submitted reports preserved and accessible.
 * Test B — Finance form data path: draft persistence with remarks, then
 *   submission visible to Sales/Admin.
 * Test C — Validation: negative/invalid rejected, zero accepted, decimals
 *   preserved, missing aggregates prevent submission, remarks optional,
 *   failed submission leaves no partially submitted report.
 * Test D — Duplicate/correction: one authoritative report per month, prior
 *   values retained in revision history.
 * Test E — Sales/Admin read-only parity; drafts hidden.
 * Test F — Notification removal: the reminder component and its logic are
 *   actually removed (verified statically), while reporting still works.
 *
 * Run: bun scripts/monthly-report-verify.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { authRepository } from "../src/services/auth/authRepository";
import { DEV_PASSWORD } from "../src/services/auth/mockUsers";
import {
  INVENTORY_REPORTING_START_MONTH,
  MONTHLY_REPORT_STATUS,
  monthlyInventoryReportsRepository,
  getEffectiveReportingStartMonth,
  isValidPeriodKey,
  listEligiblePeriods,
  normalizeAggregateQuantity,
  normalizeRemarks,
  periodLabel,
  validateQuantitiesForSubmit,
} from "../src/services/finance/monthlyInventoryReports";

if (typeof (globalThis as any).localStorage === "undefined") {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  Object.defineProperty((globalThis as any).localStorage, "clear", {
    value: () => store.clear(),
  });
}
(globalThis as any).localStorage.clear();

let failures = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  const suffix = ok
    ? ""
    : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}
async function rejects(label: string, fn: () => Promise<unknown>, needle: string) {
  try {
    await fn();
    expect(label, "no error", `error containing "${needle}"`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    expect(label, message.includes(needle), true);
  }
}

const SERVICE_PATH = "src/services/finance/monthlyInventoryReports.ts";

/* ------------------------------------------------------------------ */
/* Role setup — authorization preserved through the redesign            */
/* ------------------------------------------------------------------ */

await rejects(
  "unauthenticated write is still rejected",
  () =>
    monthlyInventoryReportsRepository.saveDraft("2026-10", {
      "00": 1,
      "01": 1,
      "02": 1,
    }),
  "Sign in as Finance",
);
await authRepository.signIn("sales@company.com", DEV_PASSWORD);
await rejects(
  "Sales cannot submit monthly reports, still",
  () =>
    monthlyInventoryReportsRepository.submitReport("2026-10", {
      "00": 1,
      "01": 1,
      "02": 1,
    }),
  "Only Finance",
);
await authRepository.signIn("finance@company.com", DEV_PASSWORD);

/* ------------------------------------------------------------------ */
/* Test A — Reporting start month (fresh data: no reports yet)          */
/* ------------------------------------------------------------------ */

expect(
  "configured reporting start month is October 2026",
  INVENTORY_REPORTING_START_MONTH,
  "2026-10",
);
expect(
  "start-month setting is a valid period key",
  isValidPeriodKey(INVENTORY_REPORTING_START_MONTH),
  true,
);
expect(
  "effective start month equals the setting when no earlier reports exist",
  getEffectiveReportingStartMonth(),
  "2026-10",
);

const periods = listEligiblePeriods();
expect(
  "period selector offers only periods at/after October 2026",
  Math.min(...periods.map((p) => p.localeCompare("2026-10"))),
  0,
);
expect(
  "November 2025 … September 2026 are never offered as reporting periods",
  periods.some((p) => p < "2026-10" || ["2025-11", "2025-12", "2026-01"].includes(p)),
  false,
);

const statuses = await monthlyInventoryReportsRepository.getPeriodStatuses();
expect(
  "period overview starts at the reporting start month, not 12 months back",
  statuses[0].period,
  "2026-10",
);
expect(
  "September 2026 (and earlier) is not presented as a missing period",
  statuses.some((s) => s.period < "2026-10"),
  false,
);
expect(
  "labels are human month names, not API month keys"
    ,
  periodLabel("2026-10"),
  new Date(2026, 9, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
);

/* Must be rejected BEFORE relying on eligibility guards. */
await rejects(
  "saving a draft before the start month is rejected (not reported as missing)",
  () =>
    monthlyInventoryReportsRepository.saveDraft("2026-09", {
      "00": 1,
      "01": 1,
      "02": 1,
    }),
  "Reporting starts at",
);
await rejects(
  "submitting before the start month is rejected",
  () =>
    monthlyInventoryReportsRepository.submitReport("2026-09", {
      "00": 1,
      "01": 1,
      "02": 1,
    }),
  "Reporting starts at",
);

/* ------------------------------------------------------------------ */
/* Test A (tail) — pre-start submitted reports preserved                 */
/* ------------------------------------------------------------------ */

// Seed a submitted report that predates the configured start month,
// simulating data that must stay valid and accessible after the change.
{
  const raw = JSON.parse(
    (globalThis as any).localStorage.getItem(
      "nexerp.finance.monthlyInventoryReports.v1",
    ) ?? "[]",
  );
  const now = Date.now();
  raw.push({
    id: "mir-seed-2026-08",
    period: "2026-08",
    status: MONTHLY_REPORT_STATUS.SUBMITTED,
    quantities: { "00": 5, "01": 6, "02": 7 },
    createdAt: now,
    updatedAt: now,
    submittedAt: now,
    revisions: [{ quantities: { "00": 5, "01": 6, "02": 7 }, submittedAt: now }],
  });
  (globalThis as any).localStorage.setItem(
    "nexerp.finance.monthlyInventoryReports.v1",
    JSON.stringify(raw),
  );
}
expect(
  "effective start moves EARLIER to the earliest valid report (never hides valid data)",
  getEffectiveReportingStartMonth(),
  "2026-08",
);
expect(
  "pre-start submitted report remains accessible",
  (await monthlyInventoryReportsRepository.getSubmittedReports()).some(
    (r) => r.period === "2026-08",
  ),
  true,
);
expect(
  "period overview never lists anything before the earliest valid data",
  (await monthlyInventoryReportsRepository.getPeriodStatuses()).some(
    (s) => s.period < "2026-08",
  ),
  false,
);
expect(
  "existing submitted reports keep their identities through the migration/upgrade path",
  (await monthlyInventoryReportsRepository.getSubmittedReports()).every(
    (r) => isValidPeriodKey(r.period) && r.status === MONTHLY_REPORT_STATUS.SUBMITTED,
  ),
  true,
);

/* ------------------------------------------------------------------ */
/* Test C (remarks-optional path) on September 2026 (eligible now)       */
/* ------------------------------------------------------------------ */

const plainDraft = await monthlyInventoryReportsRepository.saveDraft("2026-09", {
  "00": 1,
  "01": 2,
  "02": 3,
});
expect(
  "remarks optional — draft saved without remarks keeps no remarks data",
  plainDraft.remarks ?? null,
  null,
);
const plainSubmitted = await monthlyInventoryReportsRepository.submitReport(
  "2026-09",
  { "00": 1, "01": 2, "02": 3 },
);
expect(
  "remarks optional — submission without remarks succeeds",
  plainSubmitted.status,
  MONTHLY_REPORT_STATUS.SUBMITTED,
);
// Draft → submitted used the SAME record (no duplicate is created).
expect("no duplicate record after submit", plainSubmitted.id, plainDraft.id);
// Re-save after submission is a duplicate attempt and must be refused
// (established uniqueness rule, exercised with the seed active).
await rejects(
  "draft-after-submit rejected; stable uniqueness enforced",
  () =>
    monthlyInventoryReportsRepository.saveDraft("2026-09", {
      "00": 9,
      "01": 9,
      "02": 9,
    }),
  "correction workflow",
);
await monthlyInventoryReportsRepository.correctSubmittedReport("2026-09", {
  "00": 1,
  "01": 2,
  "02": 3,
});

/* ------------------------------------------------------------------ */
/* Test B — Finance form data path (draft → submit, with remarks)        */
/* ------------------------------------------------------------------ */

const draftQuantities = { "00": 16.74, "01": 16.15, "02": 16.74 };
const draft = await monthlyInventoryReportsRepository.saveDraft(
  "2026-10",
  draftQuantities,
  "Month-end stock count completed.",
);
expect(
  "draft persisted with DRAFT status",
  draft.status,
  MONTHLY_REPORT_STATUS.DRAFT,
);
expect(
  "draft preserves quantities and remarks",
  [
    draft.quantities["00"],
    draft.quantities["01"],
    draft.quantities["02"],
    draft.remarks,
  ],
  [16.74, 16.15, 16.74, "Month-end stock count completed."],
);
expect(
  "draft invisible to Sales/Admin before submission",
  (await monthlyInventoryReportsRepository.getSubmittedReports()).some(
    (r) => r.period === "2026-10",
  ),
  false,
);

const submitted = await monthlyInventoryReportsRepository.submitReport(
  "2026-10",
  draftQuantities,
  "Month-end stock count completed.",
);
expect(
  "submission status SUBMITTED",
  submitted.status,
  MONTHLY_REPORT_STATUS.SUBMITTED,
);
expect("submission timestamp recorded", typeof submitted.submittedAt === "number", true);
expect("submitting identity recorded", submitted.submittedByName, "finance@company.com");
expect(
  "remarks preserved through submission",
  submitted.remarks,
  "Month-end stock count completed.",
);
expect(
  "the draft became the authoritative report, not a second record",
  submitted.id,
  draft.id,
);
expect(
  "Sales/Admin now see the submitted report",
  (await monthlyInventoryReportsRepository.getSubmittedReports()).filter(
    (r) => r.period === "2026-10",
  ).length,
  1,
);

/* ------------------------------------------------------------------ */
/* Test C — quantity validation on the submitted month                   */
/* ------------------------------------------------------------------ */

const badCases: [string, Record<string, unknown>, string][] = [
  ["negative quantities", { "00": -5, "01": 1, "02": 1 }, "cannot be negative"],
  ["NaN", { "00": Number.NaN, "01": 1, "02": 1 }, "valid number"],
  ["Infinity", { "00": Number.POSITIVE_INFINITY, "01": 1, "02": 1 }, "valid number"],
  ["missing aggregate", { "00": 1, "02": 1 }, "is required"],
  ["empty aggregate", { "00": "", "01": 1, "02": 1 }, "is required"],
];
for (const [label, quantities, needle] of badCases) {
  await rejects(
    `submission rejects ${label}`,
    () => monthlyInventoryReportsRepository.submitReport("2026-10", quantities as any),
    needle,
  );
}
expect(
  "failed submissions leave no partially submitted report (count unchanged)",
  (await monthlyInventoryReportsRepository.getSubmittedReports()).filter(
    (r) => r.period === "2026-10",
  ).length,
  1,
);
expect(
  "zero is accepted",
  validateQuantitiesForSubmit({ "00": 0, "01": 0, "02": 0 }).valid,
  true,
);
expect(
  "decimal precision preserved (no unnecessary rounding of 16.74)",
  normalizeAggregateQuantity("00", 16.74),
  16.74,
);
expect(
  "arbitrary decimal precision kept as entered (16.0333)",
  normalizeAggregateQuantity("00", 16.0333),
  16.0333,
);
try {
  normalizeAggregateQuantity("00", "junk");
  expect("junk text is not silently coerced to zero", "no error", "error");
} catch {
  expect("junk text is not silently coerced to zero", true, true);
}
try {
  normalizeRemarks("x".repeat(501));
  expect("remarks length validation enforced", "no error", "error");
} catch {
  expect("remarks length validation enforced", true, true);
}
expect("whitespace-only remarks treated as absent", normalizeRemarks("   "), undefined);
expect("meaningful remarks are preserved verbatim (trimmed)", normalizeRemarks("  ok  "), "ok");

/* ------------------------------------------------------------------ */
/* Test D — duplicate and correction behavior on October 2026            */
/* ------------------------------------------------------------------ */

await rejects(
  "a submitted month cannot be re-saved as a draft (duplicate prevention)",
  () =>
    monthlyInventoryReportsRepository.saveDraft("2026-10", {
      "00": 1,
      "01": 1,
      "02": 1,
    }),
  "correction workflow",
);
const corrected = await monthlyInventoryReportsRepository.correctSubmittedReport(
  "2026-10",
  { "00": 16.74, "01": 16.15, "02": 15 },
  "Corrected after recount.",
);
expect(
  "correction updates the SAME record (no second authoritative report)",
  corrected.id,
  submitted.id,
);
expect(
  "prior submitted values retained in revision history",
  corrected.revisions.map((r) => r.quantities["02"]),
  [16.74, 15],
);
expect(
  "records carry revision snapshots",
  corrected.revisions.length,
  2,
);

/* ------------------------------------------------------------------ */
/* Test E — Sales/Admin parity via the read-only repository surface      */
/* ------------------------------------------------------------------ */

const salesView = await monthlyInventoryReportsRepository.getSubmittedReports();
const octoberReports = salesView.filter((r) => r.period === "2026-10");
expect("exactly one submitted October report", octoberReports.length, 1);
const october = octoberReports[0];
expect(
  "Sales and Admin read the same stored quantities",
  [october.quantities["00"], october.quantities["01"], october.quantities["02"]],
  [16.74, 16.15, 15],
);
expect(
  "drafts are never in the Sales/Admin view",
  salesView.every((r) => r.status === MONTHLY_REPORT_STATUS.SUBMITTED),
  true,
);
expect(
  "remarks displayed only when provided (September test record has none in revisions snapshot)",
  (await monthlyInventoryReportsRepository.getSubmittedReports()).find(
    (r) => r.period === "2026-08",
  )?.remarks,
  undefined,
);

/* ------------------------------------------------------------------ */
/* Test F — Notification removal (removed, not hidden)                   */
/* ------------------------------------------------------------------ */

expect(
  "MonthlyReportReminder component file is deleted",
  existsSync("src/components/finance/MonthlyReportReminder.tsx"),
  false,
);
const layoutSource = readFileSync("src/components/finance/FinanceLayout.tsx", "utf8");
expect(
  "FinanceLayout has no reminder import or banner",
  /MonthlyReportReminder|reminder banner/i.test(layoutSource),
  false,
);
const serviceSource = readFileSync(SERVICE_PATH, "utf8");
expect(
  "service no longer exposes reminder, deadline, or notification logic",
  /getMonthlyReportReminder|MONTHLY_REPORT_DEADLINE|reportingDeadline/.test(serviceSource),
  false,
);
const pagesScan = [
  "src/pages/sales/SalesInventory.tsx",
  "src/pages/admin/AdminInventoryReports.tsx",
  "src/pages/finance/FinanceInventory.tsx",
]
  // Strip block comments first: explanatory code comments are not
  // user-facing; this keeps the scan focused on actual UI strings.
  .map((file) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""))
  .join("\n");
expect(
  "Inventory pages have no notification banner, overdue list, or deadline UI",
  /reminder|overdue|outstanding|deadline|Reporting starts at/i.test(pagesScan),
  false,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll redesigned monthly reporting checks passed.");
