/**
 * Expense lifecycle verification — entry point.
 *
 * OBSOLETE_lifecycle → REPLACED: the Finance→Admin expense payment
 * workflow (Finance creates → submit → PENDING_PAYMENT → Admin marks
 * DONE) was intentionally removed by the workflow split. Expenses now
 * have two separate lives:
 *
 *   Workflow A — Finance records and manages its own expenses directly
 *                (no submission, no approval, no payment queue).
 *   Workflow B — Admin creates drafts, submits to Finance, and Finance
 *                approves or rejects them.
 *
 * The old assertions about the payment queue describe removed behavior,
 * so they were not weakened into no-ops — they were superseded by stronger
 * assertions in the new verification, which keeps every still-valid
 * guarantee from the old tests: engine math (VAT/WHT/transferred),
 * attachment + field validation for submissions, audited privileged
 * actions, counting each expense exactly once, and role authorization.
 *
 * This entry point is kept so older tooling/commands keep working:
 *
 * Run: bun scripts/expense-lifecycle-verify.ts
 */
await import("./expense-workflow-verify.ts");
