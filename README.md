# NexERP

NexERP is a role-based ERP web application for a construction-materials
business selling aggregate (m³) to customers, tracked in Ethiopian Birr (ETB).
It supports the full commercial cycle: **Sales Invoices → Finance review →
payment confirmation → financial records**, plus **long-term Contracts**
fulfilled through individual **Contract Orders**, a **shared Royalty Report**
(3% of VAT-exclusive order value), **Expenses** (standard and casual),
**Inventory/unsold tracking**, **HR (employees, attendance, leave,
payroll)**, and an **Admin** executive/oversight layer.

> **Read this first:** NexERP today is a complete, working **frontend**. Domain
> data lives in the browser (`localStorage`) and authentication is a
> development identity source. The production backend (PHP or Python Django)
> has not been built yet. This README and the `docs/` folder describe exactly
> what exists, what the business rules are, and how the future backend plugs
> in without rewriting the UI.

---

## 1. Technology stack

| Concern | Choice |
| --- | --- |
| Build tool | Vite 7 |
| UI framework | React 19 + TypeScript (strict) |
| Routing | React Router 7 (`react-router`, not `react-router-dom`) |
| Styling | Tailwind CSS v4 + shadcn/ui primitives (`src/components/ui`) |
| Icons | Lucide |
| Charts | Recharts |
| Animation | Framer Motion |
| Toasts | Sonner |
| Excel export | `xlsx` (royalty report) |
| Validation/form state | Hand-rolled validators in the service layer; `react-hook-form` + `zod` are installed but unused |
| HTTP | Native `fetch` through the shared client in `src/lib/api` (no extra HTTP library) |
| Backend (current) | Browser `localStorage` repositories + a mock auth identity source |
| Backend (scaffolding) | Convex Auth is mounted in `src/main.tsx`; it is **not** the domain-data backend |
| HR API client (planned) | `src/services/hr/apiClient.ts` already targets the future HR endpoints under `VITE_HR_API_URL`; it probes the API once at startup and falls back to an in-memory mock while the endpoints do not exist (proposed contract: `docs/api-contracts.md` §9) |
| Package manager | Bun |

## 2. Portals, roles and routes

Four protected portals, each role-locked. `RequireAuth` redirects signed-out
users to `/auth?returnTo=<path>` and blocks wrong roles with an "Access
restricted" screen.

| Portal | Base route | Role | Notes |
| --- | --- | --- | --- |
| Sales | `/sales/*` | `SALES` | Demo guests are allowed (browse-only convenience) |
| Finance | `/finance/*` | `FINANCE` | No guests |
| HR | `/hr/*` | `HR` | No guests |
| Admin | `/admin/*` | `ADMIN` | No guests |

Public routes: `/` (landing page), `/auth` (sign-in), `*` (404).
After sign-in, `/auth` sends users to their role's portal (Sales/Finance/HR/Admin);
a validated same-origin `returnTo` query parameter takes priority.

### Route map

```
/sales                         Sales Dashboard
/sales/new-invoice             Create Sales Invoice
/sales/invoices/:id/edit       Edit Sales Invoice (draft/rejected only)
/sales/transactions            Invoice list (search/sort/filter/paginate)
/sales/transactions/detail/:id Invoice detail
/sales/contracts               Contract list
/sales/contracts/:id           Contract detail (+ complete an order)
/sales/inventory               Read-only monthly unsold-aggregate reports

/finance                       Finance Dashboard
/finance/review                Invoice review queue (approve/reject)
/finance/review/detail/:id     Invoice detail + review actions
/finance/transactions          Read-only invoice history
/finance/payments              Payment confirmation queue
/finance/records               Financial records (confirmed payments)
/finance/royalty               Royalty Report + batches + Excel export
/finance/expenses              Finance expenses + Admin-expense review
/finance/inventory             Monthly unsold-aggregate report form
/finance/reports               Finance charts/reports
/finance/payroll-review        Approve/reject payroll runs
/finance/payroll-payments      Mark approved payroll as paid
/finance/contracts, /finance/contracts/:id   Same contract screens as Sales

/hr                            HR Dashboard
/hr/employees, /new, /:id, /:id/edit   Employee CRUD
/hr/attendance                 Attendance register
/hr/leave                      Leave requests
/hr/payroll                    Payroll runs

/admin                         Admin Dashboard (cross-department KPIs)
/admin/monitoring              Operational signals
/admin/users                   User & role management + audit log
/admin/sales-reports           Sales report
/admin/financial-reports       Financial report
/admin/hr-reports              HR report
/admin/overall-reports         Overall report
/admin/inventory-reports       Read-only monthly inventory reports
/admin/expenses                Admin expense workflow (draft → Finance review)
```

## 3. Feature inventory

### Sales
- **Sales Invoice** (the current transaction model): a parent invoice with
  customer (name + TIN), one **FS No**, N child orders, withholding toggle,
  payment block (bank, sender, reference number, evidence file), optional
  withholding evidence, and a remark.
- Child orders carry an aggregate code (`00`/`01`/`02`, stored as strings),
  quantity (m³), unit price (ETB, VAT-exclusive), and an optional per-line
  **Royalty Invoice Number** (never auto-generated).
- Save as draft or submit for Finance review. Only draft/rejected invoices are
  editable; rejected ones carry a Finance reason and can be resubmitted.
- Invoice numbers are sequential (`INV-00001`).
- **Transactions**: list of all invoices with search (invoice number,
  customer, FS No), status and date filters, sortable columns, pagination.
- **Detail view** with print support and evidence links.
- **Sales Reports**: group exactly 50 payment-confirmed, not-yet-reported
  transactions into a FINAL report (`SALES-REPORT-0001`) and download it as
  CSV. An order can belong to only one report.
- **Inventory** tab: read-only view of Finance-published monthly unsold
  aggregate reports.

### Contracts (shared by Sales and Finance)
- Finance creates contracts (customer, TIN, contract value in ETB,
  **one FS No**, contract date, paper-contract PDF/JPG/PNG attachments,
  remark), activates them, requests/reviews completion, cancels with a reason,
  and converts a confirmed contract into **one Sales Invoice**.
- Lifecycle: `DRAFT → IN_PROGRESS → READY_FOR_COMPLETION → CONVERTED`, with
  `CANCELLED` from any non-converted state. Fulfillment uses the
  **VAT-inclusive** order totals; reaching the contract value only *flags*
  the contract for Finance review, it never converts automatically.
- Any authorized Sales user can complete an order under any active contract
  (no assignment/claim workflow). Orders are numbered sequentially per
  contract ("Order 1", "Order 2"), record who completed them, and are
  reported to the shared Royalty Report immediately on completion.
- Corrections preserve the original "Completed By" identity and record the
  editor separately. Conversion is idempotent (three guards) and can never
  produce a second invoice for the same contract.

### Finance
- **Review queue**: approve or reject invoices submitted by Sales (reason
  required for rejection).
- **Payments**: confirm payment for approved invoices; each confirmation
  creates exactly one **Financial Record** (`FIN-REC-0001`), idempotently.
- **Financial records**: read view of posted records derived from confirmed
  payments.
- **Royalty Report**: one row per approved/confirmed invoice child order and
  per completed contract order, in seven columns (Date, Royalty Invoice
  Number, Aggregate Type, Quantity (m³), Unit Price, Total Price (VAT-
  exclusive), 3%). Rows can be exported to Excel at any time; finalizing a
  50-row batch (`NexERP_Royalty_Report_001.xlsx`) locks those rows out of the
  queue. Partial exports do not consume the queue.
- **Expenses**: two workflows on one record set.
  - *Finance-owned* expenses are recorded directly (immediately valid).
  - *Admin-owned* expenses go `DRAFT → PENDING_FINANCE_REVIEW → APPROVED`
    (or `REJECTED → correct → resubmit`, same record ID).
  - Each expense is classified `STANDARD` (VAT applies; bank + invoice
    attachment required for submission) or `CASUAL` (no VAT, no bank details,
    no payment evidence required). WHT is an optional 3% toggle requiring its
    own document when enabled. Counts in the accounting totals exactly once.
- **Inventory** tab: monthly unsold-aggregate report form. Finance types the
  remaining unsold quantities for `00`, `01`, `02` (+ optional remarks),
  saves a draft, and submits it. Submitted reports are visible to Sales and
  Admin. Corrections keep the previous submitted values in an audit trail.
  One authoritative report per `YYYY-MM` period; reporting starts at the
  configured month (currently `2026-10`).
- **Reports**: charts for sales/expense/royalty summaries.
- **Payroll**: Finance approves or rejects HR-submitted payroll runs and
  marks approved runs as paid; each paid run creates a payroll financial
  record (`PAY-REC-0001`).

### HR
- Employees (list/search/create/edit/detail/activate-deactivate) and the
  attendance register (per employee/date ranges, overtime hours) are served
  by the HR API client (`src/services/hr/apiClient.ts`) once the backend
  implements the proposed HR endpoints (`docs/api-contracts.md` §9). Those
  endpoints do not exist yet, so the client currently falls back to
  in-memory mock data after a failed startup probe.
- Leave requests (Annual, Sick, Personal, Maternity, Paternity, Unpaid) with
  approve/reject — local repository today.
- Payroll runs per period: select employees, load basic salary + overtime
  from attendance (default 150 ETB per overtime hour), allowances/deductions
  line items, calculate gross/net, then
  `DRAFT → CALCULATED → PENDING_FINANCE_REVIEW → FINANCE_APPROVED → PAID`
  (or `REJECTED`).

### Admin
- Read-only dashboards and reports over the **same** repositories the other
  portals use (no separate data): sales overview, finance overview
  (Total Sales, VAT, Gross Income, Expenses, Royalty, Net Profit), HR
  overview, monthly financial rows, and filtered monthly/yearly reports.
- **Monitoring**: real operational signals (invoices awaiting review,
  inconsistent inventory quantities, royalty obligation) — no fabricated
  health metrics.
- **User & role management**: create accounts, edit name/department/role,
  disable/reactivate, initiate password reset (requires a real backend),
  and view the management audit log. Guards: the last active admin can never
  be disabled or demoted; disabled accounts cannot sign in.
- **Expenses**: create Admin expense drafts (standard or casual), edit,
  submit to Finance; pending/approved records are frozen for edits.

## 4. How data flows

```
Page/component  →  feature hook (use-*-data)  →  service repository
                                                    │
                                    ┌───────────────┴────────────────┐
                                    │ current: localStorage-backed   │
                                    │ future: REST adapter (planned) │
                                    └────────────────────────────────┘
```

- Pages render state and call repository methods; they never touch storage
  or compute financial math themselves.
- Hooks re-fetch when a repository notifies its change channel
  (`subscribeSales` / `subscribeFinance` / `subscribeContracts`; payroll also
  uses a `payroll-changed` window event).
- All money math lives in the calculation services (`src/services/*/calc*`,
  `invoice.ts`, `expenseCalculations.ts`, `calculations.ts`).
- All authorization for privileged writes is enforced inside the repository
  layer (contracts, expenses, monthly reports, accounts), using the
  authenticated session — never a UI-supplied value.

## 5. Current persistence and backend status

| Area | Where data lives today | Storage keys |
| --- | --- | --- |
| Auth session/accounts/audit | localStorage (mock identity source) | `nexerp.auth.session.v1`, `.accounts.v1`, `.audit.v1` |
| Sales invoices (+ legacy migration) | localStorage | `nexerp.sales.invoices.v1`, `.invoicesMigrated.v1`, `.orders.v4`, `.reports.v1`, `.orders.archive.v1` |
| Contracts + contract orders | localStorage | `nexerp.contracts.v1`, `.orders.v1` |
| Financial/payroll records | localStorage | `nexerp.finance.records.v1`, `.payroll-records.v1` |
| Expenses + audit | localStorage | `nexerp.finance.expenses.v1`, `.expenseAudit.v1` |
| Inventory + monthly reports | localStorage | `nexerp.finance.inventory.v1`, `.monthlyInventoryReports.v1` |
| Royalty batches | localStorage | `nexerp.finance.royaltyBatches.v1` |
| HR employees/attendance | In-memory HR mock — the API client probes `VITE_HR_API_URL` (default `https://erpp.page.gd`, a placeholder dev host) once at startup and falls back for the session; no working HR API exists yet (proposed: `docs/api-contracts.md` §9) | — |
| HR leave/payroll runs | localStorage | `nexerp.hr.leave.v1`, `.payroll.v1`, `.payroll.config.v1` |
| Convex | Auth scaffolding only (`src/convex/*`); no domain tables | — |

Attachment/evidence files are stored as **metadata** plus session-scoped
object URLs. There is no durable file storage yet; the backend must provide
upload/download endpoints.

## 6. Setup

### Prerequisites
- Bun (package manager and script runner).
- Nothing else for frontend-only development. A Convex deployment is needed
  only if you work on the Convex auth scaffolding.

### Install and run

```bash
bun install
bun run dev        # Vite dev server
```

### Checks

```bash
bun tsc -b --noEmit        # TypeScript typecheck (required)
bun run lint               # ESLint
bun run build              # production build
```

### Verification scripts (business rules)

```bash
bun scripts/expense-workflow-verify.ts     # expense workflows A/B, review, totals
bun scripts/expense-lifecycle-verify.ts    # alias of the workflow verification
bun scripts/expense-casual-verify.ts       # standard vs casual classification
bun scripts/contract-orders-verify.ts      # contracts, orders, conversion, royalty
bun scripts/royalty-columns-verify.ts      # exact 7-column royalty report + batches
bun scripts/inventory-calc-verify.ts       # unsold quantity math + records
bun scripts/inventory-sync-verify.ts       # invoice → inventory sync (idempotent)
bun scripts/monthly-report-verify.ts       # monthly unsold-aggregate reports
bun scripts/user-mgmt-verify.ts            # accounts, roles, guards, audit
bun scripts/api-client-verify.ts           # REST client, errors, DTOs, profile
```

Scripts run the service layer with an in-memory `localStorage` shim. They
start no browser and call no live backend.

## 7. Environment variables

Frontend variables are **public** (`VITE_` prefix). Never put database
passwords, private API keys, or signing secrets in them.

```bash
# Convex auth scaffolding (already provisioned in the cloud environment)
VITE_CONVEX_URL=
CONVEX_DEPLOYMENT=
CONVEX_SITE_URL=http://localhost:5173

# Future PHP / Django REST API
VITE_API_BASE_URL=                 # e.g. https://api.example.com (no trailing slash)
VITE_API_TIMEOUT_MS=20000          # optional
VITE_API_WITH_CREDENTIALS=false    # true only for cookie/session auth
VITE_HR_API_URL=                   # base URL for the future HR endpoints (docs/api-contracts.md §9)
```

Until `VITE_API_BASE_URL` is set, the REST client in `src/lib/api` refuses to
run instead of silently calling a mock. See `docs/backend-integration.md`.

## 8. Demo credentials (mock auth only)

These accounts exist only for frontend development and provide **no**
production security:

| Portal | Email | Password |
| --- | --- | --- |
| Sales | sales@company.com | `nexerp-dev` |
| Finance | finance@company.com | `nexerp-dev` |
| HR | hr@company.com | `nexerp-dev` |
| Admin | admin@company.com | `nexerp-dev` |

Guest ("demo access") sign-in is available from `/auth` and browses the Sales
portal only.

## 9. Documentation map

| Document | Contents |
| --- | --- |
| `docs/frontend-architecture.md` | Folders, routing, state, services, domain models, calculations, validation, UI conventions, scripts |
| `docs/backend-integration.md` | The service boundary, API client, auth assumptions, adapters, migration sequence |
| `docs/api-contracts.md` | Per-module API requirements and proposed DTOs/endpoints for the future backend |
| `integrations.md` | Vly platform integrations |

## 10. Known limitations / pending backend work

- Domain data lives in browser `localStorage`; clearing browser storage
  deletes it. A real backend plus a data-migration plan are required.
- Authentication is a mock identity source. Frontend role checks are for
  usability only; the backend must enforce authorization.
- Attachments are metadata + session-scoped object URLs; no durable file
  storage or upload endpoint exists yet.
- The REST client and the REST expenses adapter exist but are **not** wired
  into the app and have not been tested against a live API.
- HR runs on in-memory mock data: the client probes the configured HR API
  base once at startup and falls back for the session when it is
  unreachable. This probe-and-fallback is legacy behavior and must be
  removed once the proposed HR endpoints (`docs/api-contracts.md` §9)
  exist — new modules never silently fall back to mocks.
- Reports, charts, and exports are computed in the browser from the shared
  service layer; the backend should reproduce the same formulas.
- Convex is present only for auth scaffolding and can be removed or replaced
  during the backend migration without touching feature code.

---

# Contributor conventions

These template conventions still apply to anyone extending the frontend.

## Frontend conventions

- Pages live in `src/pages`, components in `src/components`; shadcn
  primitives live in `src/components/ui` and should be used by default.
- When adding a page, register its route in `src/main.tsx` and reuse
  `RequireAuth` for protected routes.
- Shadcn usage: add `cursor-pointer` to clickable elements; use
  `tracking-tight font-bold` for title text; keep everything mobile
  responsive; avoid nested cards; avoid shadows (thin borders instead);
  prefer `Loader2` spinners over skeletons.
- Landing pages must be designer-level, themed, and animated with Framer
  Motion.
- Always use the shadcn Sonner toaster (`toast` from `sonner`) for results.
- Larger dialogs must scroll so content is never clipped.
- Use the `@/folder` import alias, including for Convex imports.

## Authentication

- `src/convex/auth/emailOtp.ts`, `src/convex/auth.config.ts`, and
  `src/convex/auth.ts` are platform-managed — **do not modify**.
- Frontend user data always comes from the `useAuth` hook
  (`src/hooks/use-auth.ts`); never hand-roll session handling.
- Display name/email formatting is centralized in
  `src/services/auth/profile.ts`.
- Protected routes use `RequireAuth`, which preserves the requested path in
  `/auth?returnTo=…`.

## Convex notes

- `src/convex/schema.ts` holds only the Convex Auth `users` table
  (`schemaValidation: false`); no domain tables exist.
- Document ids are `_id`; never hand-edit `src/convex/_generated/*`.
- No return-type validators on Convex functions.
