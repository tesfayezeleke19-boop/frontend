# NexERP — Frontend API Contract

The frontend-facing API requirements derived from the **actual** NexERP
frontend. This is a requirement document for the future backend (PHP or
Django — the contract is language-neutral), not a claim that any endpoint
exists.

Labels used below:

- **[Inferred]** — behavior implemented in the current frontend that the
  backend must preserve.
- **[Proposed]** — suggested endpoint/DTO shape; adjust with the frontend
  team before implementation.
- **[Open]** — requires a backend decision.

No endpoint here has been called by the running application.

---

## 0. Conventions

| Topic | Convention |
| --- | --- |
| Envelope | Success: `{ "data": <payload> }`. Lists may add `{ "meta": { page, perPage, total, totalPages } }`. |
| Errors | `{ "message", "code?", "errors": { field: string \| string[] } }` with proper HTTP status (401/403/404/409/422/429/5xx). |
| Keys | camelCase in payloads (the backend may map snake_case models). **Exception — HR:** the HR module's frontend client speaks snake_case keys and the `{ data, message? }` envelope, because its UI code already targets that exact shape (see §9). |
| Dates | ISO-8601 UTC timestamps; day-scoped business dates documented per resource. |
| Money | Number or decimal string, ≤ 2 fraction digits; server is authoritative for all computed totals. |
| Ids | Opaque strings; server-generated preferred. |
| Pagination | `page`, `perPage` query; `meta` in response. |
| Concurrency | Return `409` when a write targets a record changed since the client read it (compare `updatedAt`). |
| Idempotency | Payment confirmation, contract conversion, expense submission, inventory sync, royalty batch finalization, and payroll transitions must never duplicate records. |
| Authorization | Every endpoint checks the authenticated role server-side; role values are `SALES`, `FINANCE`, `HR`, `ADMIN`. |

Money rates in force: **VAT 15%**, **withholding 3% of VAT-inclusive invoice
total**, **royalty 3% of VAT-exclusive line value**, **expense WHT 3% of the
pre-VAT amount when enabled**.

---

## 1. Auth, users, accounts

### Session **[Proposed]**

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/login` | `{ email, password }` → token/session + `ApiUserDto` |
| POST | `/auth/logout` | invalidate |
| GET | `/auth/session` (or `/me`) | current user + `signedInAt` |
| POST | `/auth/refresh` **[Open]** | token rotation, if bearer auth |

```ts
interface ApiUserDto {
  id: string;
  displayName: string;   // full name (built server-side if names are split)
  email: string;
  role: "SALES" | "FINANCE" | "HR" | "ADMIN";
  department?: string | null;
  accountStatus?: "ACTIVE" | "DISABLED" | null;
}
```

Rules **[Inferred]**: disabled accounts cannot sign in and lose access to
protected endpoints; the frontend additionally revalidates the cached
session per protected route. Guests are a frontend-only demo concept and
must never authenticate against the API.

### User management **[Inferred]**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/users` | list accounts (Admin) |
| POST | `/users` | create `{ name, email, role, department? }` |
| PATCH | `/users/:id` | update `name` / `department` / `role` |
| PATCH | `/users/:id/status` | `{ status: "ACTIVE" \| "DISABLED" }` |
| POST | `/users/:id/password-reset` | initiate reset (must report honestly if email cannot be sent) |
| GET | `/users/audit-log` | management audit entries |

Constraints: Admin-only; a disabled caller loses access; the last active
admin can never be disabled or demoted; emails are unique and validated;
audit entries record actor id/email, action, target, outcome, and non-secret
details (`USER_CREATED`, `USER_UPDATED`, `ROLE_CHANGED`,
`ACCOUNT_DISABLED`, `ACCOUNT_REACTIVATED`, `PASSWORD_RESET_INITIATED`,
`UNAUTHORIZED_ACTION_BLOCKED`).

---

## 2. Sales invoices

### DTO **[Inferred]**

```ts
interface SalesInvoiceDto {
  id: string;
  invoiceNumber: string;            // INV-##### (server-generated)
  date: string;                     // ISO
  customer: { name: string; tin: string };
  fsNo: string;                     // Finance/Sales reference, required
  contractId?: string | null;       // set only by contract conversion
  orders: InvoiceOrderDto[];
  financialSummary: {
    subtotalExclVat: number;
    totalVat: number;
    totalPriceInclVat: number;
    withholdingEnabled: boolean;
    withholdingRate: number;
    withholdingAmount: number;
    netAmountAfterWithholding: number;
  };
  payment: {
    bank: string;
    paymentSender: string;
    paymentReferenceNumber: string;
    paymentEvidence?: AttachmentDto | null;
  };
  withholdingEvidence?: AttachmentDto | null;
  remark?: string | null;
  status: "DRAFT" | "PENDING_FINANCE_REVIEW" | "FINANCE_APPROVED" | "REJECTED" | "PAYMENT_CONFIRMED";
  rejectionReason?: string | null;
  createdAt: string; updatedAt: string;
  submittedAt?: string | null; submittedBy?: string | null;
  financeReviewedAt?: string | null;
  approvedAt?: string | null; approvedBy?: string | null;
  rejectedAt?: string | null;
  paymentConfirmedAt?: string | null; paymentConfirmedBy?: string | null;
  createdBy?: string | null;
  legacyOrderId?: string | null; legacyReffNo?: string | null;   // migrated rows
}

interface InvoiceOrderDto {
  id: string;
  orderNumber: number;              // 1-based position
  aggregate: "00" | "01" | "02";
  quantity: number;                 // m³, > 0
  unit: string;                     // "m³"
  unitPrice: number;                // ETB, VAT-exclusive
  lineTotalExclVat: number;         // qty × price (royalty base)
  royaltyOrderNumber: number;
  royaltyInvoiceNumber?: string | null;  // user-supplied, never invented
  royaltyAmount: number;            // lineTotalExclVat × 0.03
  contractOrderId?: string | null;  // set only on converted lines
  orderDate?: string | null;        // source business date for royalty
}
```

### Endpoints **[Proposed]**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/sales/invoices?status=&search=&from=&to=&page=&perPage=` | list/filter |
| GET | `/sales/invoices/:id` | detail |
| POST | `/sales/invoices` | create (DRAFT or direct submit) |
| PUT | `/sales/invoices/:id` | save draft / edit while editable |
| POST | `/sales/invoices/:id/submit` | submit for Finance review |
| POST | `/sales/invoices/:id/approve` | Finance approve |
| POST | `/sales/invoices/:id/reject` | `{ reason }` (required) |
| POST | `/sales/invoices/:id/confirm-payment` | confirm payment + create financial record |

Rules **[Inferred]**:
- Submit requires: customer name, TIN, FS No, ≥ 1 order, per-line aggregate
  `00/01/02`, quantity > 0, valid unit price, non-blank royalty invoice
  number if provided, bank, payment sender, payment reference, payment
  evidence; withholding evidence when withholding is enabled.
- Only `DRAFT` and `REJECTED` invoices are editable; resubmission clears the
  rejection reason; only `PENDING_FINANCE_REVIEW` can be approved/rejected;
  only `FINANCE_APPROVED` can be payment-confirmed.
- Payment confirmation creates **exactly one** financial record per invoice
  (idempotent) with totals derived from the invoice.
- Server recomputes all line totals, VAT, withholding, and royalties.
- Approval status must not silently change quantity/inventory; inventory
  sync treats approved/confirmed invoices as source data only.

---

## 3. Legacy sales orders and sales reports

### Legacy orders **[Inferred]**

The old single-order model (`ORDER-####`) still exists as an archived
dataset. If the backend imports it, expose read access only:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/sales/orders` | legacy list (migration/audit) |

Fields mirror one invoice line + customer/payment + status/timestamps
(`customerName`, `tin`, `fsNo` (formerly `reffNo`), `aggregate`, `quantity`,
`unit`, `unitPrice`, `totalPriceExclVat`, `totalPriceInclVat`, `bank`,
`senderName`, `transactionNumber`, `status`, audit fields).

### Sales reports (50-transaction reports) **[Inferred/Proposed]**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/sales/reports` | list reports |
| GET | `/sales/reports/:id` | detail with embedded orders |
| GET | `/sales/reports/available-orders` | payment-confirmed orders not yet in any report |
| POST | `/sales/reports` | `{ orderIds: string[] }` → creates a FINAL report |

Rules: exactly 50 orders; every order must be `PAYMENT_CONFIRMED`; an order
can belong to at most one report; totals = Σ quantity and Σ
`totalPriceExclVat`; report number `SALES-REPORT-####`. CSV/PDF generation
may move server-side later **[Open]** — the frontend currently builds a CSV
client-side.

---

## 4. Contracts and contract orders

### Contract DTO **[Inferred]**

```ts
interface ContractDto {
  id: string;
  contractNumber: string;           // CONTRACT-####
  customer: { name: string; tin: string };
  contractValue: number;            // ETB, VAT-inclusive payable basis
  fsNo: string;                     // ONE FS No per contract
  contractDate: string;             // ISO
  attachments: AttachmentDto[];     // paper contract PDF/JPG/PNG
  remark?: string | null;
  status: "DRAFT" | "IN_PROGRESS" | "READY_FOR_COMPLETION" | "CONVERTED" | "CANCELLED";
  statusHistory: { status: string; at: string; by?: string | null; note?: string | null }[];
  createdBy?: string | null; createdAt: string; updatedAt: string;
  activatedAt?: string | null; activatedBy?: string | null;
  readyAt?: string | null;
  completionConfirmedAt?: string | null; completionConfirmedBy?: string | null;
  completionReason?: string | null; closedBelowValue?: boolean;
  cancelledAt?: string | null; cancelledBy?: string | null; cancellationReason?: string | null;
  salesInvoiceId?: string | null; salesInvoiceNumber?: string | null;
  convertedAt?: string | null; convertedBy?: string | null;
  conversionError?: string | null;
}

interface ContractOrderDto {
  id: string;
  contractId: string;
  orderNumber: number;              // sequential per contract
  aggregate: "00" | "01" | "02";
  quantity: number;
  unit: string;                     // "m³"
  unitPrice: number;
  lineTotalExclVat: number;         // royalty base
  lineTotalInclVat: number;         // fulfillment basis
  royaltyInvoiceNumber?: string | null;
  orderDate: string;                // business date (royalty Date column)
  status: "COMPLETED" | "CANCELLED";
  completedByUserId: string; completedByName: string; completedByEmail?: string | null;
  completedAt: string;
  createdByUserId: string; createdByName: string; createdAt: string; updatedAt: string;
  lastEditedByUserId?: string | null; lastEditedByName?: string | null;
  lastEditedByEmail?: string | null; editedAt?: string | null;
  cancelledAt?: string | null; cancelledBy?: string | null; cancelReason?: string | null;
  royaltySourceKey: string;         // "contract-order:<orderId>"
}
```

### Endpoints **[Proposed]**

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/contracts` | list (+ optional progress summary) | Sales, Finance |
| GET | `/contracts/:id` | detail | Sales, Finance |
| GET | `/contracts/:id/orders` | orders of a contract | Sales, Finance |
| POST | `/contracts` | create (DRAFT) | Finance |
| PUT | `/contracts/:id` | edit (DRAFT only) | Finance |
| POST | `/contracts/:id/activate` | DRAFT → IN_PROGRESS | Finance |
| POST | `/contracts/:id/request-completion` | → READY_FOR_COMPLETION | Finance |
| POST | `/contracts/:id/confirm-completion` | `{ reason? }` (reason required below value) | Finance |
| POST | `/contracts/:id/cancel` | `{ reason }` required; never when CONVERTED | Finance |
| POST | `/contracts/:id/convert` | convert to one Sales Invoice | Finance |
| POST | `/contracts/:id/orders` | complete an order | Sales |
| PATCH | `/contract-orders/:id` | correct an order | Sales (owner) / Finance |
| POST | `/contract-orders/:id/cancel` | `{ reason }` required | Finance |

Rules **[Inferred]**:
- Fulfillment uses VAT-inclusive order totals; reaching the contract value
  only sets `READY_FOR_COMPLETION` (and un-flags if a later correction drops
  below the value) — never auto-convert.
- Conversion requires a confirmed completion and ≥ 1 completed order,
  creates exactly one invoice in `PENDING_FINANCE_REVIEW` with
  `contractId`, `fsNo`, and lines carrying `contractOrderId` + `orderDate`;
  payment details are empty for Finance to complete before approval.
- Conversion must be idempotent under retry/double-click and return the
  same invoice when repeated.
- Order attribution: `completedBy*` immutable; corrections store the editor
  in `lastEditedBy*`; converted contracts freeze their orders.
- Completed orders are royalty-reportable immediately; cancelled orders keep
  their record but stop contributing.

---

## 5. Financial records and payroll records

### Financial records **[Inferred/Proposed]**

```ts
interface FinancialRecordDto {
  id: string;
  recordNumber: string;      // FIN-REC-####
  sourceOrderId: string;     // the confirmed invoice id
  sourceOrderNumber: string;
  customerName: string;
  aggregate: string;         // "00" | "01" | "02" | joined with "+"
  quantity: number; unit: string; unitPrice: number;
  totalPrice: number;        // VAT-inclusive invoice total
  bank: string;
  status: "POSTED";
  postedAt: string; postedBy?: string | null; createdAt: string;
}
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/finance/records` | list |
| GET | `/finance/records/:id` | detail |
| GET | `/finance/records/by-order/:orderId` | lookup (may 404) |

Created only by payment confirmation; exactly one per source order.

### Payroll records **[Inferred/Proposed]**

```ts
interface PayrollFinancialRecordDto {
  id: string;
  recordNumber: string;   // PAY-REC-####
  payrollId: string;
  payrollPeriod: string;  // "August 2026"
  employeeCount: number;
  totalGross: number; totalDeductions: number; totalNet: number;
  status: "POSTED";
  paidAt: string; paidBy?: string | null; createdAt: string;
}
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/finance/payroll-records` | list |
| GET | `/finance/payroll-records/by-payroll/:payrollId` | lookup |

Created once per payroll run marked PAID.

---

## 6. Expenses

### DTO **[Inferred]**

```ts
interface ExpenseDto {
  id: string;
  item: string;                          // required
  category?: string | null;              // controlled list
  expenseType?: "STANDARD" | "CASUAL" | null;   // absent = STANDARD
  amountBeforeVat: number;               // entered amount, ≥ 0
  vatAmount: number;                     // 15% (0 for CASUAL)
  whtEnabled: boolean; whtAmount: number; // 3% of pre-VAT when enabled
  totalTransferred: number;              // total after VAT − WHT
  amount: number;                        // accounting amount = total after VAT
  bank?: string | null;
  paymentReference?: string | null;
  paymentParty?: string | null;
  invoiceAttachment?: AttachmentDto | null;
  whtAttachment?: AttachmentDto | null;
  remark?: string | null;
  expenseDate: string;                   // ISO (business date)
  createdBy?: string | null; createdAt: string; updatedAt: string;
  expenseSource?: "FINANCE" | "ADMIN" | "LEGACY" | null;   // server-assigned
  reviewStatus?: "DRAFT" | "RECORDED" | "PENDING_FINANCE_REVIEW" | "APPROVED" | "REJECTED" | null;
  statusHistory?: { status: string; at: string; actor?: string | null; note?: string | null }[];
  rejectionReason?: string | null; reviewedBy?: string | null; reviewedAt?: string | null;
  paymentStatus?: "DRAFT" | "PENDING_PAYMENT" | "DONE" | "UNVERIFIED" | null; // legacy meaning only
  submittedAt?: string | null; submittedBy?: string | null;
  paidAt?: string | null; paidBy?: string | null; paymentConfirmationNote?: string | null;
}
```

### Conditional validation **[Inferred]**

| Rule | STANDARD | CASUAL |
| --- | --- | --- |
| date, category, item, amount | required | required |
| bank / payment information | required at submission | optional |
| invoice / payment evidence | required at submission | optional |
| VAT | 15%, server-computed | not applicable (0) |
| WHT | optional toggle; evidence required when enabled | same (only when explicitly enabled) |

CASUAL is a company recording classification, **not** a legal tax
determination. Records without `expenseType` are STANDARD. Empty bank/
evidence fields must never be replaced with invented values.

### Lifecycle **[Inferred]**

- Finance-created → `RECORDED` immediately (no queue, counts in totals).
- Admin-created → `DRAFT`; submit → `PENDING_FINANCE_REVIEW`; Finance
  approves → `APPROVED` or rejects with a required reason → `REJECTED`;
  rejected/draft records are corrected and resubmitted with the **same id**.
- Pending/approved records are frozen for edits; approval never marks the
  expense paid; legacy `paymentStatus` values are never relabelled.
- Counting: FINANCE/LEGACY always count; ADMIN counts only when APPROVED —
  exactly once per record.

### Endpoints **[Proposed]**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/expenses?source=&status=&expenseType=&from=&to=&search=&page=&perPage=` | list |
| GET | `/expenses/:id` | detail |
| GET | `/expenses/review-summary` | `{ pendingReview, pendingAmount, approved, rejected, drafts }` |
| POST | `/expenses` | Finance direct record (`RECORDED`) |
| POST | `/expenses/admin-drafts` | Admin draft |
| PATCH | `/expenses/:id` | Finance edit of its own record |
| PATCH | `/expenses/:id/admin-draft` | Admin edit (draft/rejected only) |
| POST | `/expenses/:id/submit` | submit/resubmit |
| POST | `/expenses/:id/approve` | Finance approve |
| POST | `/expenses/:id/reject` | `{ reason }` required |
| DELETE | `/expenses/:id` | Finance deletes its own eligible record |

Write payload (`ExpenseWriteDto`) sends `item`, `category`, `expenseType`,
`amountBeforeVat`, `whtEnabled`, optional payment fields/attachments,
`remark`, `expenseDate`; the server derives every total, source, status,
and timestamp, and rejects a STANDARD submission missing bank/invoice while
accepting a CASUAL record without them.

---

## 7. Royalty report and batches

### Row DTO **[Inferred]**

```ts
interface RoyaltyRowDto {
  key: string;                    // "<invoiceId>-<orderId>" | "contract-order:<orderId>"
  source: "INVOICE" | "CONTRACT_ORDER";
  date: string;                   // business date
  royaltyInvoiceNumber?: string | null;
  aggregate: string;              // "00" | "01" | "02"
  quantity: number;
  unitPrice: number;
  lineTotalExclVat: number;       // Total Price (VAT-exclusive)
  royalty: number;                // 3% of lineTotalExclVat
  invoiceId?: string | null; invoiceNumber?: string | null;
  contractId?: string | null; contractNumber?: string | null;
  contractOrderId?: string | null; contractOrderNumber?: number | null;
}
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/royalty/rows?from=&to=&finalized=` | report rows (excluding finalized keys) |
| GET | `/royalty/batches` | batches |
| GET | `/royalty/eligible` | rows/invoices not yet batched |
| POST | `/royalty/batches` | `{ keys: string[] }` finalize (batch size 50) |
| GET | `/royalty/export?keys=` **[Open]** | optional server-side Excel generation |

Rules **[Inferred]**: exactly seven export columns — Date, Royalty Invoice
Number, Aggregate Type, Quantity (m³), Unit Price, Total Price, 3% — plus a
TOTAL row; approved/confirmed invoice lines and completed contract orders
are both reportable; converted contract lines are reconciled (never
double-reported); finalizing a batch locks its keys; partial exports never
consume the queue.

---

## 8. Inventory

### Records **[Inferred/Proposed]**

```ts
interface InventoryRecordDto {
  id: string;
  sourceInvoiceId?: string | null; sourceOrderId?: string | null;  // dedupe anchor
  invoiceNumber?: string | null; fsNo?: string | null;
  date: string; customerName?: string | null; aggregate?: string | null;
  originalQuantity: number;
  soldQuantity: number;           // physical movement recorded by Finance only
  unsoldQuantity: number;         // derived: max(0, original − sold)
  unit: string;                   // "m³"
  status: "UNSOLD" | "PARTIALLY_SOLD" | "SOLD";   // derived
  origin: "AUTO_SOURCE" | "MANUAL";
  sourceOriginalQuantity?: number | null;
  notes?: string | null;
  createdAt: string; updatedAt: string; createdBy?: string | null;
}
```

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/inventory/records?aggregate=&status=&from=&to=&page=` | list | all portals |
| GET | `/inventory/records/:id` | detail | all portals |
| POST | `/inventory/records` | manual record | Finance |
| PATCH | `/inventory/records/:id` | edit | Finance |
| DELETE | `/inventory/records/:id` | delete | Finance |
| POST | `/inventory/sync` | idempotent create/reconcile from approved invoices | Finance/system |
| GET | `/inventory/summary` | totals, per-aggregate unsold, inconsistencies | all portals |

Rules: invoice approval never marks stock sold; sync matches
`sourceInvoiceId :: sourceOrderId`, never touches recorded sold quantities,
and reconciles source-quantity corrections only when the recorded movement
still fits (otherwise flag, don't overwrite).

### Monthly unsold-aggregate reports **[Inferred/Proposed]**

```ts
interface MonthlyInventoryReportDto {
  id: string;
  period: string;                    // "YYYY-MM"
  status: "DRAFT" | "SUBMITTED";
  quantities: { "00": number; "01": number; "02": number };
  remarks?: string | null;
  createdAt: string; updatedAt: string;
  submittedAt?: string | null; submittedBy?: string | null; submittedByName?: string | null;
  revisions: { quantities: {...}; submittedAt: string; submittedBy?: string | null }[];
  audit: { id: string; action: "DRAFT_SAVED" | "SUBMITTED" | "CORRECTED"; actor?: string | null; at: string; note?: string | null }[];
}
```

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/inventory/monthly-reports` | Finance working list (all) | Finance |
| GET | `/inventory/monthly-reports/submitted` | published reports | Sales, Finance, Admin |
| GET | `/inventory/monthly-reports/periods` | period statuses (`MISSING`/`DRAFT`/`SUBMITTED`) | Sales, Finance, Admin |
| GET | `/inventory/monthly-reports/:period` | one period | Sales, Finance, Admin |
| PUT | `/inventory/monthly-reports/:period/draft` | save/replace draft | Finance |
| POST | `/inventory/monthly-reports/:period/submit` | publish | Finance |
| POST | `/inventory/monthly-reports/:period/correct` | revise a submitted report (keep prior values) | Finance |

Rules: one report per period; quantities are typed by Finance (never
derived from invoices); explicit `0` is valid; negative/NaN/Infinity
rejected; reporting starts at the configured month (`2026-10`); Sales/Admin
never see drafts.

---

## 9. HR (proposed — to be built from scratch)

There is **no working HR API today**. The frontend ships a ready-made HTTP
client for the HR module (`src/services/hr/apiClient.ts`, the
`HRApiClient` interface with its `LiveHRApiClient` implementation) that
already requests exactly the endpoints below under `VITE_HR_API_URL`.
At startup `getHRApiClient()` probes `GET /api/employees` once; when the
request fails (which is always, today — the default base
`https://erpp.page.gd` is a placeholder dev host, not a running NexERP
API) it logs a warning and serves an in-memory mock for the session. So:

- **Every HR endpoint below is [Proposed] and must be created from
  scratch**, like every other module — no HR endpoint has ever been
  answered by a real server.
- **Implementing these exact paths, envelope, and snake_case shapes is the
  seamless integration**: the existing client works unchanged (no page,
  hook, or service edits); only the backend work is new.
- The `{ data, message? }` envelope and snake_case keys are deliberate
  module conventions here (see §0 exception) — the client reads
  `res.data` directly, so list endpoints return bare arrays without `meta`.
- Authentication: the client sends `Authorization: Bearer <token>`, with
  the token injected from the shared session via `setHrAuthToken`. The
  backend must validate the same session token as every other module.

### Dashboard

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/hr/dashboard` | counters for the HR landing view |

```ts
interface HRDashboard {
  totalEmployees: number;       // all employees
  activeEmployees: number;      // is_active = true
  inactiveEmployees: number;    // is_active = false
  presentToday: number;         // attendance records for today, PRESENT
  absentToday: number;          // ABSENT today
  lateToday: number;            // LATE today
  onLeave: number;              // LEAVE today
  pendingLeaveRequests: number; // leave requests with status PENDING
  currentPayrollStatus: string; // free-text summary, e.g. "Processing August 2026 payroll"
}
```

Server computes all counters for the company timezone (§6). Note:
`pendingLeaveRequests` requires the leave endpoints below; the current mock
client hardcodes `0`.

### Employees

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/employees?search=&status=&position=` | list + filter |
| GET | `/api/employees/:id` | detail (`null`-able → 404) |
| POST | `/api/employees` | create |
| PUT | `/api/employees/:id` | update |
| PUT | `/api/employees/:id/status` | `{ is_active }` |

```ts
interface Employee {
  employee_id: string;              // server-generated, e.g. "EMP-001", unique
  full_name: string;
  phone: string;
  position: string;
  hired_date: string;               // ISO date
  emergency_contact_name: string;
  emergency_phone: string;
  document_photo: string;           // URL (attachment storage, §11) or base64
  salary: number;                   // ETB, basic salary for payroll
  is_active: boolean;               // true on create; no hard DELETE
}
interface EmployeeInput {
  full_name: string; phone: string; position: string; hired_date: string;
  emergency_contact_name: string; emergency_phone: string;
  document_photo: string; salary: number;
}
interface EmployeeQueryParams {
  search?: string;                  // matches full_name, position, phone, employee_id
  status?: "active" | "inactive";  // maps to is_active
  position?: string;                // substring match on position
}
```

Rules **[Inferred from the frontend's client and mock]**: deactivation is
soft (status toggle only); `salary` ≥ 0; all input fields required exactly
as in `EmployeeInput` (the form submits the whole shape); search is
case-insensitive over name/position/phone/id; `status` filter values are
lowercase `active`/`inactive`.

### Attendance

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/attendance?employee_id=&date=&start_date=&end_date=` | list + filter |
| GET | `/api/attendance/:id` | detail (404 when missing) |
| POST | `/api/attendance` | create |
| PUT | `/api/attendance/:id` | update |
| DELETE | `/api/attendance/:id` | delete |

```ts
interface AttendanceRecord {
  attendance_id: string;            // server-generated, e.g. "ATT-001"
  employee_id: string;              // must reference an existing employee
  attendance_date: string;          // ISO date
  status: "PRESENT" | "ABSENT" | "LATE" | "LEAVE";
  overtime_hours: number;           // ≥ 0, finite — payroll input
  note: string;                     // may be empty; never invented
}
interface AttendanceInput {
  employee_id: string; attendance_date: string; status: "PRESENT" | "ABSENT" | "LATE" | "LEAVE";
  overtime_hours: number; note: string;
}
```

Rules **[Inferred]**: date filters are inclusive and combinable
(`start_date`/`end_date` range, `date` for a single day); default list sort
is newest `attendance_date` first, then `employee_id` ascending; attendance
rows are the overtime source for payroll, so corrections must flow through
`PUT` (never delete-and-recreate silently).

### Leave requests (replaces the local repository) **[Proposed]**

Today leave lives in a local repository (`LeaveRepository`,
`localStorage`). The endpoints mirror its operations 1:1:

| Method | Path | Mirrors | Purpose |
| --- | --- | --- | --- |
| GET | `/api/leave-requests` | `getRequests()` | list all |
| GET | `/api/leave-requests/:id` | `getRequestById(id)` | detail (404 when missing) |
| POST | `/api/leave-requests` | `createRequest(input)` | create `{ employee_id, type, start_date, end_date, reason }` → status `PENDING` |
| POST | `/api/leave-requests/:id/approve` | `approveRequest(id, reviewedBy)` | `{ reviewed_by }` → `APPROVED` |
| POST | `/api/leave-requests/:id/reject` | `rejectRequest(id, reviewedBy, reason)` | `{ reviewed_by, rejection_reason }` (reason **required**) → `REJECTED` |
| DELETE | `/api/leave-requests/:id` | `deleteRequest(id)` | delete |

```ts
interface LeaveRequest {
  leave_id: string;                 // server-generated, e.g. "LEAVE-001"
  employee_id: string;
  type: "Annual" | "Sick" | "Personal" | "Maternity" | "Paternity" | "Unpaid";
  start_date: string;               // ISO date
  end_date: string;                 // ISO date, ≥ start_date
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  created_date: string;             // ISO datetime, server-set
  reviewed_by?: string;
  reviewed_date?: string;           // ISO datetime, set on approve/reject
  rejection_reason?: string;        // required when rejecting
}
```

Rules **[Inferred]**: only `PENDING` requests can be approved/rejected;
rejecting requires a non-empty reason; date/type/reason required on
create; `created_date`/`reviewed_*` fields are server-owned.

### Payroll runs (replaces the local repository) **[Proposed]**

Today payroll runs live in a local repository (`PayrollRepository`,
`localStorage`, plus a `PayrollConfig`). Endpoints mirror its operations:

| Method | Path | Mirrors | Purpose |
| --- | --- | --- | --- |
| GET | `/api/payroll-runs` | `getRuns()` | list all runs |
| GET | `/api/payroll-runs/:id` | `getRunById(id)` | detail (404 when missing) |
| POST | `/api/payroll-runs` | `createRun(input, employees)` | create run for a period, seeded from employees |
| GET | `/api/payroll/config` | `getConfig()` | `{ overtime: { rate } }` (default `150` ETB/h) |
| PUT | `/api/payroll/config` | `updateConfig(config)` | update overtime rate |
| POST | `/api/payroll-runs/:id/employees` | `addEmployeeToRun(...)` | add employee (loads basic salary + overtime hours from attendance) |
| DELETE | `/api/payroll-runs/:id/employees/:employeeId` | `removeEmployeeFromRun(...)` | remove (only while editable) |
| PATCH | `/api/payroll-runs/:id/employees/:employeeId` | `updateEmployeeRecord(...)` | edit allowances/deductions line items |
| POST | `/api/payroll-runs/:id/calculate` | `calculateRun(runId)` | recompute every record (authoritative) |
| POST | `/api/payroll-runs/:id/submit` | `submitForReview(runId, actor)` | → `PENDING_FINANCE_REVIEW` |
| POST | `/api/payroll-runs/:id/resubmit` | `resubmitRun(runId, actor)` | `REJECTED` → back to review |
| POST | `/api/payroll-runs/:id/approve` | `approveRun(runId, actor)` | Finance → `FINANCE_APPROVED` |
| POST | `/api/payroll-runs/:id/reject` | `rejectRun(runId, actor, reason)` | `{ reason }` **required** → `REJECTED` |
| POST | `/api/payroll-runs/:id/pay` | `markPaid(runId, actor)` | → `PAID` (creates the payroll financial record, §5 — idempotent) |

```ts
interface PayrollLineItem { name: string; amount: number; }   // allowances/deductions
interface PayrollEmployeeRecord {
  employee_id: string;
  basic_salary: number;             // copied from Employee.salary
  allowances: PayrollLineItem[];
  overtime_hours: number;           // summed from attendance for the period
  overtime_pay: number;             // hours × config rate — server-computed
  gross_salary: number;             // basic + allowances + overtime_pay — server-computed
  deductions: PayrollLineItem[];
  net_salary: number;               // gross − deductions — server-computed
}
interface PayrollRun {
  payroll_id: string;               // server-generated, e.g. "PAY-001"
  period_label: string;             // e.g. "August 2026"
  period_month: number;             // 1–12
  period_year: number;
  start_date: string; end_date: string;   // ISO dates
  status: "DRAFT" | "CALCULATED" | "PENDING_FINANCE_REVIEW" | "FINANCE_APPROVED" | "PAID" | "REJECTED";
  employee_records: PayrollEmployeeRecord[];
  created_date: string; created_by?: string;
  submitted_date?: string; submitted_by?: string;
  approved_date?: string; approved_by?: string;
  rejection_reason?: string;
  paid_date?: string; paid_by?: string;
}
interface PayrollRunInput {
  period_label: string; period_month: number; period_year: number;
  start_date: string; end_date: string;
}
```

Payroll math **[Inferred]**: `overtime_pay = overtime_hours × rate`
(default rate 150 ETB/h, per-run config); `gross = basic + allowances +
overtime_pay`; `net = gross − deductions`. Status flow:
`DRAFT → CALCULATED → PENDING_FINANCE_REVIEW → FINANCE_APPROVED → PAID`
(or `REJECTED` → resubmit). The server recomputes `overtime_pay`,
`gross_salary`, and `net_salary` on calculate/submit — client-supplied
values are display-only. Employee records can only change while the run
is `DRAFT`/`CALCULATED`. Marking a run paid must be idempotent and must
create at most one payroll financial record (`PAY-REC-####`, §5).

### Roles and go-live

- Role split per §12: HR creates/edits employees and attendance, manages
  leave, creates/calculates/submits payroll runs; Finance approves and
  marks runs paid. Enforce server-side on every endpoint.
- Go-live steps: implement the endpoints → point `VITE_HR_API_URL` at the
  new backend (or the same host as `VITE_API_BASE_URL`) → delete the
  probe-and-mock fallback in `getHRApiClient()` (a silent mock fallback
  violates `backend-integration.md` ground rule 4) → migrate
  `nexerp.hr.leave.v1` / `.payroll.v1` / `.payroll.config.v1` browser data
  (README §5) like the other modules.

---

## 10. Admin aggregates and reports

Read-only endpoints matching the frontend formulas **[Proposed]**:

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/admin/overview` | sales + finance + HR headline metrics |
| GET | `/admin/sales-report?year=&month=` | by month/aggregate/status, totals, invoice list |
| GET | `/admin/financial-report?year=&month=` | monthly rows, totals, financial + payroll records |
| GET | `/admin/hr-report?status=&position=` | employees/attendance/payroll aggregates |
| GET | `/admin/overall-report?year=&month=` | combined snapshot |
| GET | `/admin/monthly-financials?year=` | per-month sales, VAT, gross, expenses, royalty, net profit |

Formulas **[Inferred]** (must match `src/services/finance/calculations.ts`):
- Total Sales = Σ approved invoice `totalPriceInclVat` (one per invoice;
  confirmed invoices additionally counted in revenue views).
- VAT = total − total / 1.15; Gross = total − VAT.
- Royalty = Σ approved+confirmed order `lineTotalExclVat` × 0.03.
- Expenses = counted expenses (`amount` = total after VAT), each once.
- Net Profit = Gross − Expenses − Royalty.

Monitoring **[Inferred]** signals are derived client-side today (pending
reviews, inventory inconsistencies, royalty obligation) and need no
dedicated endpoint.

---

## 11. Attachments **[Open]**

```ts
interface AttachmentDto {
  id: string;
  fileName: string;
  fileUrl: string;      // download URL (absolute or API-relative)
  mimeType: string;
  fileSize: number;
}
```

Choose multipart upload or signed URLs (see `backend-integration.md` §7).
Used by: sales payment evidence, withholding evidence, contract paper
contracts, expense evidence/WHT documents, HR document photos.

---

## 12. Authorization matrix **[Inferred]**

| Resource / operation | SALES | FINANCE | HR | ADMIN |
| --- | --- | --- | --- | --- |
| Invoice create/edit/submit | ✔ | — | — | — |
| Invoice approve/reject/confirm payment | — | ✔ | — | — |
| Contract create/edit/activate/confirm/cancel/convert | — | ✔ | — | — |
| Contract order complete | ✔ | ✔(correct) | — | — |
| Contract order cancel | — | ✔ | — | — |
| Expense record (Finance workflow) | — | ✔ | — | — |
| Expense create/submit (Admin workflow) | — | — | — | ✔ |
| Expense approve/reject | — | ✔ | — | — |
| Inventory write / monthly report write | — | ✔ | — | — |
| Payroll submit | — | — | ✔ | — |
| Payroll approve/pay | — | ✔ | — | — |
| Leave approve/reject | — | — | ✔ | — |
| User management + audit log | — | — | — | ✔ |
| Read-only reports/dashboards | own portal | own portal | own portal | all |

---

## 13. Not implemented / open questions

- No endpoint in this document exists or has been called by the app.
- The REST expenses adapter implements the §6 subset against this proposal
  and is verified only with stubbed HTTP responses.
- Open decisions are collected in `backend-integration.md` §14 (auth
  strategy, attachment flow, timezone, money storage, concurrency,
  aggregates ownership, realtime, HR endpoint fate, audit retention).
