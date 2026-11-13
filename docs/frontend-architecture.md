# NexERP — Frontend Architecture

A complete map of the Vite/React frontend: what every layer does, where the
business rules live, and where the future PHP/Django backend plugs in.

Companion documents: `backend-integration.md` (API boundary) and
`api-contracts.md` (endpoint requirements).

---

## 1. Stack and runtime

- React 19 + TypeScript (strict, `erasableSyntaxOnly` — no constructor
  parameter properties), built with Vite 7.
- React Router 7 (`react-router`).
- Tailwind CSS v4 (oklch tokens in `src/index.css`) + shadcn/ui primitives.
- Recharts (charts), Framer Motion (motion), Sonner (toasts), Lucide
  (icons), `xlsx` (royalty Excel export).
- Bun for install/scripts. `bun tsc -b --noEmit` is the type gate.
- Import alias: `@/*` → `src/*`.

### Entrypoint (`src/main.tsx`)

1. Mounts the platform integrations and the `VlyToolbar` (behind an error
   boundary so a toolbar crash never blanks the app).
2. Creates `ConvexReactClient` from `VITE_CONVEX_URL` and wraps the app in
   `ConvexAuthProvider` (auth scaffolding only).
3. `BrowserRouter` + `RouteSyncer` (posts route changes to the parent
   frame) + `Suspense` (lazy routes) + `RootErrorBoundary`.
4. Registers every route (public `/`, `/auth`, `*`, and the four portal
   groups wrapped in `RequireAuth`).
5. Renders the Sonner `<Toaster />`.

All route components are `lazy()`-loaded for code splitting.

## 2. Folder structure

```text
src/
  main.tsx                    providers, route table, error boundaries
  index.css                   theme tokens, badge utilities (.erp-badge-*)
  instrumentation.tsx         runtime error overlay (platform tooling)
  pages/                      one folder per portal, one component per route
    Landing.tsx  Auth.tsx  Dashboard.tsx  NotFound.tsx
    sales/ finance/ contracts/ hr/ admin/
  components/
    ui/                       ~60 shadcn primitives — do not fork
    RequireAuth.tsx           role gate for every portal
    LogoDropdown.tsx
    sales/    SalesLayout (sidebar + header + mobile sheet)
    finance/  FinanceLayout, ExpenseFormDialog, OrderActionDialogs
    contracts/ ContractFormDialog, ContractOrderDialog
    hr/       HrLayout, EmployeeForm
    admin/    AdminLayout
  hooks/
    use-auth.ts               session + sign-in/out
    use-sales-data.ts         invoice/order/report hooks
    use-contracts-data.ts     contract hooks
    use-finance-data.ts       records/expenses/summary/royalty hooks
    use-inventory-data.ts     inventory + monthly report hooks
    use-hr-data.ts            HR client hooks + leave/payroll hooks
    use-admin-data.ts         read-only admin aggregation hooks
    use-mobile.ts             viewport helper
  services/                   framework-free domain layer (the backend seam)
    auth/      authRepository, mockUsers, profile, types
    sales/     invoice, invoiceRepo, orders, reports, storage, calc,
               format, export, types
    contracts/ repository, storage, types
    finance/   expenses, expenseValidation, expenseCalculations,
               expenseFilters, records, payrollRecords, inventory,
               inventorySync, monthlyInventoryReports, royaltyReport,
               royaltyBatches, summary, calculations, storage, types
    hr/        apiClient, leaveRepository, payrollRepository, mockData, types
    admin/     summary, summaryTypes (read-only aggregations)
    adapters/rest/  reference REST adapter (NOT active yet)
  lib/
    api/       config, client, errors, types, index (shared REST layer)
    utils.ts, vly-integrations.ts
  convex/      auth scaffolding + generated code (no domain tables)
  types/       ambient declarations
scripts/       business-rule verification scripts (bun-run, no browser)
docs/          this handoff documentation
```

## 3. Portals, layouts, navigation

Each portal has a layout component with a sidebar (desktop), a mobile
sheet, a top bar with a user menu (full name + email + sign out), and a
`<main>` container. Navigation items:

| Portal | Sidebar items |
| --- | --- |
| Sales | Dashboard, Sales Invoice, Contract Orders, Transactions, Inventory |
| Finance | Dashboard, Sales Review, Contracts, Transactions, Payments, Financial Records, Royalty Reports, Expenses, Inventory, Financial Reports, Payroll Review, Payroll Payments |
| HR | Dashboard, Employees, Attendance, Leave, Payroll |
| Admin | Dashboard, Sales Reports, Financial Reports, HR Reports, Overall Reports, Inventory, Monitoring, User & Role Management, Expenses |

Breadcrumbs are derived from the URL. All pages are wrapped in
`mx-auto max-w-7xl p-6` containers.

## 4. Authentication and authorization

### Session layer (`src/services/auth`)

`MockAuthRepository` implements both `AuthRepository` (signIn,
signInAsGuest, getSession, signOut, subscribe) and `ManagedAccountRepository`
(list/create/update accounts, status, password-reset initiation, audit log,
session revalidation). Sessions persist in `localStorage`.

Security-relevant behavior (must be reproduced by the backend):

- Sign-in validates email/password against seeded dev accounts; disabled
  accounts cannot sign in or keep sessions.
- `RequireAuth` revalidates the cached session on every protected render:
  a disabled account loses access immediately; role/department changes
  refresh the cached session.
- Account management requires an authenticated, active, non-guest Admin.
  The last active admin can never be disabled or demoted.
- Every account mutation appends an audit entry (actor id/email, action,
  target, outcome, non-secret details).
- Password reset is honestly reported as "requires backend" — no email is
  ever sent by the frontend.
- Guests (`isGuest`) get Sales browse access only and are refused by every
  privileged repository.

### User model

`AuthUser = { id, name (full display name), email, role, department,
accountStatus }`. Roles: `SALES | FINANCE | HR | ADMIN`.

`src/services/auth/profile.ts` is the single formatting layer:
`displayNameOf`, `displayEmail` ("Not provided" fallback), `initialsOf`,
`actorLabel` (email preferred for audit fields), and `toUserProfile`
(`UserProfile { id, fullName, email, role, department, accountStatus }`).

### Role matrix for privileged writes

| Operation | Required role |
| --- | --- |
| Create/edit/activate/cancel contract, convert to invoice, cancel contract order | Finance |
| Complete contract order | Sales (real account, not guest) |
| Correct contract order | Sales (own order) or Finance |
| Record/edit/delete Finance expense, review Admin expense | Finance |
| Create/edit/submit Admin expense | Admin (creator only) |
| Monthly inventory report save/submit/correct | Finance |
| User account management | Admin |
| Invoice approve/reject/payment-confirm | Finance (via Finance pages) |

Enforcement lives in the repositories (`ContractPermissionError`,
`ExpensePermissionError`, `ValidationError`, `PermissionDeniedError`), never
only in the UI.

## 5. State management

No Redux/Zustand. The pattern is uniform:

```ts
interface RepoState<T> { data: T | null; loading: boolean; error: Error | null }
```

`useRepoData(loader)` loads once, subscribes to the repository's change
channel, and reloads after every mutation. Variants:

- `use-sales-data` → `subscribeSales`
- `use-finance-data` → `subscribeSales` + `subscribeFinance` + `subscribeContracts`
- `use-contracts-data` → `subscribeContracts` + `subscribeSales`
- `use-inventory-data` → `inventoryRepository.subscribe` (finance + sales)
- `use-admin-data` → `subscribeSales` + `subscribeFinance`
- `use-hr-data` → HR client (per-hook load); payroll/leave listen to a
  `payroll-changed` window event

Change channels are simple listener sets in the `storage.ts` modules; each
repository mutation calls `notify*Changed()`. This is the seam a REST/WebSocket
implementation replaces.

### Hook catalog (feature → hook)

| Feature | Hooks |
| --- | --- |
| Sales invoices | `useSalesInvoices`, `useSalesInvoice`, `useNextInvoiceNumber` |
| Legacy orders | `useSalesOrders`, `useSalesOrder`, `useSalesSummary`, `useApprovedOrders`, `useNextOrderNumber` |
| Sales reports | `useSalesReports`, `useSalesReport`, `useAvailableConfirmedOrders` |
| Contracts | `useContracts`, `useContract`, `useContractOrders`, `useAllContractOrders`, `useContractProgress` |
| Finance | `useFinancialRecords`, `useConfirmedRecordTotals`, `useFinanceSummary`, `useFinancialReports`, `usePayrollFinancialRecords` |
| Expenses | `useFinanceExpenses`, `useAdminExpenses`, `useFinanceReviewQueue`, `useAdminExpenseReviewSummary` |
| Royalty | `useRoyaltyReportRows`, `useRoyaltyInvoices` |
| Inventory | `useInventoryRecords`, `useInventorySummary`, `useMonthlyReportOverview` |
| HR | `useHRDashboard`, `useHREmployees`, `useHREmployee`, `useHRAttendance`, `useHRLeaveRequests`, `usePayrollRuns`, `usePayrollRun`, `useEmployeeNameMap` + mutation hooks |
| Admin | `useAdminSalesOverview`, `useAdminFinanceOverview`, `useAdminHROverview`, `useAdminMonthlyFinancials`, `useAdminOverallSummary`, `useAdmin{Sales,Financial,HR,Overall}Report` |

## 6. Service layer (the backend seam)

Every module exposes an interface plus a `Local*` implementation. Pages and
hooks import only the singleton instance exported from the module index.

| Service | Interface | Operations |
| --- | --- | --- |
| Auth | `AuthRepository`, `ManagedAccountRepository` | signIn, signInAsGuest, getSession, signOut, revalidateSession; list/create/update accounts, setAccountStatus, initiatePasswordReset, getAuditLog |
| Sales orders (legacy model) | `SalesOrdersRepository` | getOrders/getOrderById/getOrderByNumber/getOrdersByStatus, getSalesSummary, getNextOrderNumber, create/update/saveDraft, submit/reject/approve/confirmPayment, subscribe |
| Sales invoices | `SalesInvoicesRepository` | getInvoices/getInvoiceById/getInvoicesByStatus, getFinanceApprovedInvoices, getPaymentConfirmedInvoices, computeNextInvoiceNumber, createInvoice, saveDraft, submitInvoice, approveInvoice, rejectInvoice, confirmInvoicePayment, subscribe |
| Sales reports | `SalesReportsRepository` | getReports, getReportById, getAvailableConfirmedOrders, createReport (exactly 50), subscribe |
| Contracts | `ContractsRepository` | getContracts/getContractById/getContractOrders/getAllOrders/getOrderById/getContractProgress, create/update/activate, requestCompletion, confirmCompletion, cancelContract, convertContractToInvoice, completeOrder/updateOrder/cancelOrder, subscribe |
| Financial records | `FinancialRecordsRepository` | getRecords, getRecordById, getRecordByOrderId, confirmPaymentAndCreateRecord (idempotent), subscribe |
| Expenses | `ExpensesRepository` | getExpenses/getExpenseById/getFinanceExpenses/getAdminExpenses/getFinanceReviewQueue/getLegacyExpenses, isExpenseCounted, getExpenseReviewSummary, createExpense, createAdminExpense, updateExpense, updateAdminExpense, submitAdminExpense, approveAdminExpense, rejectAdminExpense, deleteExpense, subscribe |
| Payroll records | `PayrollFinancialRecordsRepository` | getRecords, getRecordByPayrollId, createRecordFromPayroll (idempotent), subscribe |
| Inventory | `InventoryRepository` | getRecords, getRecordById, createRecord, updateRecord, deleteRecord, syncSourceOrders (idempotent), subscribe |
| Monthly inventory reports | `MonthlyInventoryReportsRepository` | getReports, getSubmittedReports, getReportByPeriod, saveDraft, submitReport, correctSubmittedReport, getPeriodStatuses, subscribe |
| Royalty batches | `RoyaltyBatchesRepository` | getBatches, getEligibleInvoices, getNextBatchNumber, finalizeBatch, subscribe |
| HR | `HRApiClient`, `LeaveRepository`, `PayrollRepository` | dashboard, employees CRUD/status, attendance CRUD; leave create/approve/reject/delete; payroll create/calculate/submit/approve/reject/pay/delete + config. `HRApiClient` targets the future HR endpoints under `VITE_HR_API_URL` and, while they do not exist, its factory probes once at startup and serves an in-memory mock for the session (proposed contract: `api-contracts.md` §9) |

Derived (non-repository) services: `summary.ts` (Finance dashboards),
`admin/summary.ts` (Admin aggregations), `royaltyReport.ts` (row builder),
`inventorySync.ts` (source bridge), `expenseFilters.ts` (date/search
filtering), `export.ts` / `royaltyBatches.ts` (CSV/Excel).

## 7. Domain models and lifecycles

### Sales invoice
`SalesInvoice { id, invoiceNumber (INV-#####), date, customer{name,tin},
fsNo, contractId?, orders[], financialSummary{subtotalExclVat, totalVat,
totalPriceInclVat, withholdingEnabled, withholdingRate, withholdingAmount,
netAmountAfterWithholding}, payment{bank, paymentSender,
paymentReferenceNumber, paymentEvidence?}, withholdingEvidence?, remark?,
status, rejectionReason?, audit timestamps/actors, legacy* fields }`

`InvoiceOrder { id, orderNumber (1-based), aggregate "00"|"01"|"02",
quantity, unit "m³", unitPrice, lineTotalExclVat, royaltyOrderNumber,
royaltyInvoiceNumber?, royaltyAmount, contractOrderId?, orderDate? }`

Statuses: `DRAFT → PENDING_FINANCE_REVIEW → FINANCE_APPROVED →
PAYMENT_CONFIRMED`, with `REJECTED` from review (editable/resubmittable).
Only DRAFT/REJECTED invoices can be edited.

Legacy: single-order `SalesOrder` records (`ORDER-####`) are migrated
one-to-one into invoices on first load; originals are archived, never
deleted.

### Contract
`Contract { id, contractNumber (CONTRACT-####), customer{name,tin},
contractValue (ETB, VAT-inclusive), fsNo, contractDate, attachments[],
remark?, status, statusHistory[], conversion fields, completion fields }`

Statuses: `DRAFT → IN_PROGRESS → READY_FOR_COMPLETION → CONVERTED`, plus
`CANCELLED`. Only DRAFT is editable; activation, completion confirmation,
cancellation, and conversion are Finance-only; conversion requires a
confirmed completion and creates exactly one invoice (idempotent).

`ContractOrder { id, contractId, orderNumber (sequential per contract),
aggregate, quantity, unit "m³", unitPrice, lineTotalExclVat,
lineTotalInclVat, royaltyInvoiceNumber?, orderDate, status
(COMPLETED|CANCELLED), completedByUserId/Name/Email, completedAt,
createdBy*, lastEditedBy* (editor audit), royaltySourceKey
("contract-order:<id>") }`

### Expense
`Expense { id, item, category?, expenseType (STANDARD|CASUAL; absent =
STANDARD), amount (Total/After VAT), amountBeforeVat, vatAmount,
whtEnabled, whtAmount, totalTransferred, bank?, paymentReference?,
paymentParty?, invoiceAttachment?, whtAttachment?, remark?, date,
createdBy/At, updatedAt, expenseSource (FINANCE|ADMIN|LEGACY), reviewStatus
(DRAFT|RECORDED|PENDING_FINANCE_REVIEW|APPROVED|REJECTED), statusHistory[],
rejectionReason?, reviewedBy/At, legacy paymentStatus
(DRAFT|PENDING_PAYMENT|DONE|UNVERIFIED), submittedAt/By, paidAt/By }`

Counting rule (`isExpenseCounted`): FINANCE and LEGACY count immediately;
ADMIN counts only once APPROVED. Each record counts exactly once.

### Financial / payroll records
`FinancialRecord { recordNumber FIN-REC-####, sourceOrderId, … }` — created
once per confirmed payment (idempotent by source order).
`PayrollFinancialRecord { recordNumber PAY-REC-####, payrollId, period,
employeeCount, totalGross, totalDeductions, totalNet, paidAt/By }` — created
once per paid payroll run.

### Inventory
`InventoryRecord { sourceInvoiceId?, sourceOrderId?, invoiceNumber?, fsNo?,
date, customerName?, aggregate?, originalQuantity, soldQuantity,
unsoldQuantity (derived), unit, status (UNSOLD|PARTIALLY_SOLD|SOLD),
origin (AUTO_SOURCE|MANUAL), sourceOriginalQuantity?, notes?, audit }`

`MonthlyInventoryReport { period "YYYY-MM", status (DRAFT|SUBMITTED),
quantities { "00","01","02" }, remarks?, revisions[], audit[] }` — Finance
writes only; Sales/Admin read submitted reports only; one report per period;
corrections append a revision.

### Royalty
`RoyaltyReportRow { key, source (INVOICE|CONTRACT_ORDER), date,
royaltyInvoiceNumber?, aggregate, quantity, unitPrice, lineTotalExclVat,
royalty, invoiceId/Number?, contractId/Number?, contractOrderId/Number? }`
Keys: `<invoiceId>-<orderId>` or `contract-order:<orderId>` — stable, so
edits update a row instead of duplicating it. Converted contract lines carry
`contractOrderId` and are reconciled with their contract row, never added.

`RoyaltyBatch { batchNumber, orderIds (row keys), recordCount,
totalQuantity, totalSales, totalRoyalty, status (PENDING|FINALIZED) }` —
finalizing 50 rows locks them out of the report.

### HR
`Employee`, `AttendanceRecord` (snake_case — the API-ready HR contract in
`hr/types.ts`; the backend implements these shapes from scratch, see
`api-contracts.md` §9),
`LeaveRequest`, `PayrollRun` with per-employee
`PayrollEmployeeRecord { basic_salary, allowances[], overtime_hours,
overtime_pay, gross_salary, deductions[], net_salary }`.

## 8. Calculation engines (single source of truth)

| Module | Rules |
| --- | --- |
| Sales calc (`sales/calc.ts`) | `VAT_DIVISOR = 1.15`; excl = qty × price; incl = qty × price × 1.15; `roundMoney` 2dp; sequential numbers `ORDER-####`, `SALES-REPORT-####` |
| Invoice (`sales/invoice.ts`) | `ORDER_VAT_RATE 0.15`, `WITHHOLDING_RATE 0.03` of VAT-inclusive total, `INVOICE_ROYALTY_RATE 0.03` of VAT-exclusive line; subtotal = Σ lines; net = incl − withholding; invoice numbers `INV-#####` |
| Finance (`finance/calculations.ts`) | VAT = total − total/1.15; Gross = total − VAT; Royalty = Gross × 0.03; Net Profit = Gross − Expenses − Royalty |
| Finance summary (`finance/summary.ts`) | Total Sales = Σ approved invoice incl-VAT totals; royalty base = Σ approved+confirmed order `lineTotalExclVat` × 0.03; expenses = counted expenses (amount = total after VAT) |
| Expense (`expenseCalculations.ts`) | `EXPENSE_VAT_RATE 0.15` (0 when CASUAL), `EXPENSE_WHT_RATE 0.03` of amountBeforeVat when enabled; amount = total after VAT; totalTransferred = total − WHT |
| Contracts (`contracts/types.ts`) | Fulfillment basis VAT-inclusive (`lineTotalInclVat`); progress, remaining, % (zero-safe); `CONTRACT-####` |
| Royalty (`finance/royaltyReport.ts`, `royaltyBatches.ts`) | Total Price = qty × price (VAT-exclusive); 3% = total × 0.03; batch size 50 |
| Inventory (`finance/inventory.ts`) | unsold = max(0, original − sold); status derived; summary + inconsistency detection |
| Monthly reports | three aggregates, non-negative finite decimals, explicit 0 valid, remarks length-bounded |
| Payroll (`hr/payrollRepository.ts`) | gross = basic + allowances + overtime (default 150 ETB/h); net = gross − deductions |
| Admin (`admin/summary.ts`) | Same formulas as Finance, applied per month/period; revenue invoices = pending/approved/confirmed |

Money is always stored as numbers and formatted (`formatCurrency`,
"ETB", en-US grouping) only in the UI.

## 9. Validation modules

| Validator | Enforced where |
| --- | --- |
| `validateInvoiceForSubmit` | invoice submission (customer, TIN, FS No, ≥1 order, aggregate/qty/price per line, bank, sender, reference, payment evidence; withholding evidence when ON) |
| `validateContractInput`, `validateContractOrderInput`, `validateContractAttachment` | contract repository (Finance-only writes) |
| `validateExpenseFields` / `validateExpenseForSubmission` | expense form **and** repository submission gate (conditional on `expenseType`) |
| `validateInventoryInput`, `InventoryValidationError` | inventory repository |
| Monthly-report quantity/remarks validation | monthly inventory repository (Finance-only) |
| `validateInvoiceForSubmit`-equivalent payroll transitions | payroll repository status guards |

## 10. Attachments, evidence, and exports

- One evidence shape everywhere: `{ id, fileName, fileUrl, mimeType,
  fileSize }`. Used for payment evidence, withholding evidence, contract
  paper contracts, and expense attachments.
- Uploads currently create object URLs in the browser (session-scoped) —
  metadata persists, bytes do not. The backend must provide storage.
- Exports: royalty Excel (`.xlsx`, exactly seven columns + TOTAL row, via
  `xlsx`) and sales-report CSV (`downloadReportCsv`).

## 11. UI conventions

- Dark theme with oklch tokens; surfaces `#0a0a0b / #0d0d0f / #111113 /
  #141416`, borders `#232329 / #2e2e35`, accents emerald `#34d399`,
  blue `#60a5fa`, amber `#fbbf24`, violet `#a78bfa`, red `#f87171`.
- Status badges are the shared classes `.erp-badge-draft`, `-pending`,
  `-approved`, `-rejected`, `-payment` — pages never invent colors.
- Loading = `Loader2` spinner; empty states = icon + explanation + action;
  errors = Sonner toast with the repository's message; every mutation
  shows a success toast.
- Tables: `overflow-x-auto`, mono uppercase headers, right-aligned numeric
  columns with `tabular-nums`, em dash for missing optional values.
- Dialogs scroll (`max-h-[90vh] overflow-y-auto`) and confirm destructive
  or irreversible actions with an explicit dialog.

## 12. Verification scripts

`scripts/*-verify.ts` exercise the service layer directly with an in-memory
`localStorage` shim (see README §6 for commands). They assert the business
rules: invoice validation and lifecycle, contract conversion idempotency,
royalty column structure, expense workflows (including casual
classification), inventory math and sync, monthly reports, user management
guards, API client behavior, and profile formatting.

## 13. Convex footprint

- `src/convex/schema.ts`: Convex Auth tables + `users { name, image, email,
  emailVerificationTime, isAnonymous, role }` with an `email` index.
- `src/convex/users.ts`: `currentUser` query + `getCurrentUser` helper.
- `src/convex/auth.ts`, `auth.config.ts`, `auth/emailOtp.ts`: platform auth
  config (do not modify). `http.ts`, `_generated/*`: generated/scaffold.
- **No domain feature calls Convex.** Removing or replacing Convex touches
  only `main.tsx` and `src/convex/*`.

## 14. How to add or modify a feature

1. Model it in `src/services/<module>/types.ts` (types + enums + labels).
2. Put rules/calculations in the service, never in the page.
3. Add operations to the module's repository interface + `Local*`
   implementation; persist through the module's `storage.ts`; call the
   change notifier.
4. Add a hook in the matching `use-*-data` file (loader + subscribe).
5. Build the page/dialog with shadcn components and the portal layout.
6. Extend the relevant `scripts/*-verify.ts` when the behavior is
   business-critical; run it plus `bun tsc -b --noEmit`.
7. Document new operations in `docs/api-contracts.md` so the backend team
   can implement them; add a REST adapter method only when the contract is
   agreed.
