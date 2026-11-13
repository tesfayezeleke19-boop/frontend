# Backend API requirements — Contract, Credit Contract, Payment & Withholding

Audience: the PHP/CodeIgniter backend maintainers of `ERP/backend/`.
Scope: everything the frontend needs that the **current** backend does not provide.
Status date: 9 November 2026 · Frontend branch: `feature/hati-frontend-theme-credit-contracts`.

This document was produced by inspecting the real backend source (not from
frontend comments or earlier AI reports):

- `backend/app/Config/Routes.php`
- `backend/app/Controllers/Api/*` (notably `SalesInvoicesController`,
  `FinanceRoyaltyReportsController`, `FinanceSalesReviewController`)
- The SQL embedded in `FinanceRoyaltyReportsController`

No PHP file was modified. Everything labelled **PROPOSED** below does not
exist yet and must be treated as a recommendation, not an implemented route.

---

## 1. Honesty statement — what works today and what does not

The frontend has two contract workflows:

1. **Contract Orders** (existing system) — `src/services/contracts/`
2. **Credit Contracts** (additional system) — `src/services/creditContracts/`

Both currently persist **only in browser `localStorage`**
(`nexerp.contracts.v1`, `nexerp.contracts.orders.v1`,
`hati.creditContracts.v1`, `hati.creditContracts.orders.v1`). There are **no
contract endpoints** in `Routes.php`, so:

- Contracts created in one browser are invisible to every other user and device.
- Contract orders can never appear in the shared Royalty Report, even though the
  report SQL already reads contract orders from the database, because nothing
  writes them there.
- Contract → Sales Invoice conversion **does** reach the backend
  (`POST /api/sales/invoices` with `contractId`), and the invoice is real. The
  contract record that points at it is not.

Nothing in the UI claims otherwise: contract pages describe fulfilment and
payment information as contract records, and payment information is explicitly
labelled "not confirmed".

---

## 2. Verified existing backend support

| Area | Support | Evidence |
|---|---|---|
| Login | **Exists** — `POST /api/auth/login` (bearer token) | `Routes.php` |
| Sales invoices | **Exists** — list, create, show, update, submit, approve, reject, confirm-payment | `api/sales/invoices*` |
| Sales invoice contract link | **Exists (partially)** — accepts/returns `contractId`; validated as a UUID | `SalesInvoicesController` (`contractId`, `validUuid`) |
| Sales invoice withholding | **Exists** — `withholdingEnabled`, `withholdingRate` (0.03), `withholdingAmount`, `netAmountAfterWithholding`, `withholdingEvidence` | `SalesInvoicesController::*` (rate fixed at 0.03) |
| Sales invoice payment fields | **Exists** — `bank`, `paymentSender`, `paymentReferenceNumber`, `paymentEvidence` (single confirmation per invoice, no ledger) | `SalesInvoicesController` |
| Evidence upload | **Exists** — `POST /api/sales/attachments/upload`, `GET /api/sales/invoices/attachments/{id}` | `Routes.php` |
| Aggregate types | **Exists** — `GET /api/sales/aggregate-types` | `Routes.php` |
| Finance sales review | **Exists** — approve/reject queue | `api/sales/finance/sales-review*` |
| Royalty report read | **Exists** — `GET /api/finance/royalty-reports`, plus batches/finalize | `FinanceRoyaltyReportsController` |
| Royalty report contract rows | **Read exists, write missing** — the report SQL already unions `contract_orders` + `contracts` as `source = 'CONTRACT_ORDER'` and de-duplicates via `royalty_batch_items.contract_order_id` | `FinanceRoyaltyReportsController::eligibleRows()` |
| Contract/credit-contract tables | **Referenced by SQL** (`contracts`, `contract_orders`) but **no API writes them** and no schema file exists in the repository | royalty SQL |
| Contract CRUD / orders / lifecycle | **Missing** | no `api/contracts` routes |
| Credit contracts | **Missing** — no table or route is referenced anywhere in the backend | no `credit_contracts` references |
| Payment ledger / partial payments | **Missing** — one confirmation per invoice | `confirm-payment` |
| Contract payment / withholding persistence | **Missing** | — |
| Contract financial report | **Missing** | — |
| Contract audit endpoints | **Missing** | — |

### 2.1 Verified money rules (must not be re-invented)

| Value | Rule | Where verified |
|---|---|---|
| VAT | 15%, invoice total is VAT-inclusive (`subtotal × 1.15`) | `SalesInvoicesController` totals; `src/services/sales/invoice.ts` |
| Withholding | **3% of the VAT-INCLUSIVE total**, only when enabled; `net = gross − withholding` | `SalesInvoicesController` (`$withholdingRate = 0.03`, `$withholdingAmount = round($total * rate)`) |
| Royalty | **3% of the VAT-EXCLUSIVE line total**, never VAT-inclusive | royalty SQL (`ROUND(quantity * unit_price)`) |
| Fulfillment | Contract value vs **VAT-inclusive** fulfilled value; display capped at 100% | frontend `getContractProgress`, `getCreditContractProgress` |
| Payment | Only a `PAYMENT_CONFIRMED` invoice counts as paid | sales invoice lifecycle |

---

## 3. Summary table — what the backend must add

| # | Capability | Current state | Blocked frontend feature |
|---|---|---|---|
| 1 | Contract CRUD + lifecycle | Missing | Contract Orders module (shared multi-user data) |
| 2 | Contract orders CRUD | Missing | Sales order completion under contracts |
| 3 | Credit contract CRUD + finalize | Missing | Credit Contract module |
| 4 | Contract payment information | Missing | Payment Information section (both systems) |
| 5 | Contract withholding | Missing | Withholding section (both systems) |
| 6 | Contract financial report | Missing | Completed-contract financial report |
| 7 | Contract audit history | Missing | Attribution/audit trail |
| 8 | Payment ledger / partial payments | Insufficient | Partial-paid status, exact balances |
| 9 | Contract order → royalty persistence | Read-only | Royalty Report rows for contract orders |
| 10 | Atomic, idempotent conversion | Insufficient | Duplicate-prevention across users |

---

## 4. Proposed endpoints — Contract Orders (existing system)

Base: `/api/contracts` · All requests: `Authorization: Bearer <token>`,
`Accept: application/json`. Finance-only unless stated.

### 4.1 `GET /api/contracts`
List contracts (paged). Sales sees all active contracts (no assignment model).
**Response 200**
```json
{ "success": true, "data": [ { "id": "uuid", "contractNumber": "CONTRACT-0001",
  "customer": { "name": "ABC Construction PLC", "tin": "0012345678" },
  "contractValue": 10000000, "fsNo": "2704301",
  "contractDate": "2026-01-15", "status": "IN_PROGRESS",
  "fulfilledValue": 5000000, "createdBy": "finance@hati.et",
  "createdAt": "2026-01-15T08:00:00Z", "updatedAt": "2026-02-01T10:00:00Z" } ] }
```

### 4.2 `POST /api/contracts`
Create a draft. `fsNo` **required** for the existing contract system (preserve
current behaviour); not required for credit contracts (§5).
**Request**
```json
{ "customerName": "ABC Construction PLC", "tin": "0012345678",
  "contractValue": 10000000, "fsNo": "2704301",
  "contractDate": "2026-01-15", "remark": "optional",
  "attachments": [ { "id": "uuid", "fileName": "contract.pdf",
    "fileUrl": "/api/sales/invoices/attachments/uuid",
    "mimeType": "application/pdf", "fileSize": 240000 } ] }
```
**Validation**: customer name/TIN required; value > 0; valid date; FS No
non-empty; attachment mime `application/pdf|image/jpeg|image/png`.
**Response 201**: the created contract (`status: "DRAFT"`).

### 4.3 `GET /api/contracts/{id}` · `PUT /api/contracts/{id}`
Show / update. Update allowed **only** while `DRAFT` (409 otherwise), so an
activated contract keeps its customer, value, FS No, date and attachments.

### 4.4 Lifecycle actions
| Method + path | Purpose | Rules |
|---|---|---|
| `POST /api/contracts/{id}/activate` | `DRAFT → IN_PROGRESS` | Finance only |
| `POST /api/contracts/{id}/request-completion` | flag for review | Finance only |
| `POST /api/contracts/{id}/confirm-completion` | `{ "reason": "…" }` | Reason **required** when fulfilledValue < contractValue |
| `POST /api/contracts/{id}/cancel` | `{ "reason": "…" }` | Reason required; rejected if already `CONVERTED`/`CANCELLED` |
| `POST /api/contracts/{id}/convert` | create exactly ONE Sales Invoice | see §4.7 |

Every action appends an audit row (§8) with the authenticated actor.

### 4.5 Contract orders
| Method + path | Purpose | Authorization |
|---|---|---|
| `GET /api/contracts/{id}/orders` | list orders | Sales + Finance |
| `POST /api/contracts/{id}/orders` | complete an order | **Sales** (any authorized Sales user) |
| `PUT /api/contracts/{id}/orders/{orderId}` | correct an order | the completing salesperson or Finance |
| `POST /api/contracts/{id}/orders/{orderId}/cancel` | `{ "reason": "…" }` | Finance only |

**Create request**
```json
{ "aggregate": "01", "quantity": 120.5, "unitPrice": 8500,
  "royaltyInvoiceNumber": "RI-2026-001", "orderDate": "2026-02-10" }
```
Server must:
- reject when the contract is `CANCELLED` or `CONVERTED` (409);
- take `completedBy*` **from the token**, never from the request;
- store the unit price as given (historical prices never recalculated);
- compute `line_total_excl_vat = quantity × unit_price` (VAT-exclusive, royalty
  base) and expose a VAT-inclusive line total for fulfillment;
- assign `order_number` atomically (unique per contract);
- set `royalty_source_key = 'contract-order:{orderId}'` (unique).

**Update**: must preserve the original `completedBy*` and record
`lastEditedBy*`/`editedAt` separately.

### 4.6 Contract financial report
`GET /api/contracts/{id}/financial-report` (Sales read of non-finance fields,
Finance full). Returns exactly the shape the frontend already renders:
```json
{ "contractNumber": "CONTRACT-0001", "customerName": "…", "customerTin": "…",
  "contractDate": "2026-01-15", "completionDate": "2026-03-01",
  "fsNo": "2704301",
  "contractValue": 10000000, "fulfilledValue": 10000000,
  "remainingContractValue": 0, "fulfillmentPercent": 100,
  "rawFulfillmentPercent": 100, "overFulfilled": false,
  "grossAmountDue": 11500000, "totalVat": 1500000,
  "subtotalExclVat": 10000000,
  "withholdingEnabled": true, "withholdingRate": 0.03,
  "withholdingAmount": 345000, "netAmount": 11155000,
  "amountPaid": 7000000, "outstandingBalance": 4155000,
  "paymentStatus": "AWAITING_PAYMENT_CONFIRMATION",
  "withholdingStatus": "APPLIED",
  "invoice": { "id": "uuid", "invoiceNumber": "INV-00001",
    "status": "FINANCE_APPROVED", "paymentConfirmed": false },
  "payment": { "bank": "CBE", "paymentSender": "…",
    "paymentAmount": 7000000, "paymentDate": "2026-03-05",
    "paymentReferenceNumber": "TXN-12345", "recordedBy": "finance@hati.et" },
  "withholding": { "enabled": true, "rate": 0.03,
    "evidence": { "id": "uuid", "fileName": "withholding.pdf",
      "fileUrl": "…", "mimeType": "application/pdf", "fileSize": 120000 } } }
```
`amountPaid` may exceed the frontend's current single-confirmation model once a
payment ledger exists (§7); the frontend already computes
`outstanding = net − amountPaid` from these fields.

`paymentStatus` is one of `NO_PAYMENT_INFORMATION`, `RECORDED_NOT_CONFIRMED`,
`AWAITING_INVOICE_APPROVAL`, `AWAITING_PAYMENT_CONFIRMATION`, `PAID`, or
`INVOICE_UNAVAILABLE` (the contract is converted/invoiced but the invoice could
not be read — the payment position is unknown, never reported as unpaid).

### 4.7 Conversion (atomic + idempotent)
`POST /api/contracts/{id}/convert`
- Requires `completionConfirmedAt` and at least one completed order.
- Creates ONE invoice through the existing invoice rules (15% VAT, withholding
  per §2.1, `contract_id`, one line per contract order with
  `contract_order_id` and the order's business date).
- Stores `sales_invoices.contract_id`; the frontend also adopts an existing
  invoice whose `contractId` matches, so a **unique index on
  `sales_invoices.contract_id`** is required to make double conversion
  impossible server-side.
- Must be retry-safe: repeated calls return the same invoice (HTTP 200) instead
  of creating a second one.
- On success: `contracts.status = 'CONVERTED'`, `sales_invoice_id` set, audit row
  written — in one transaction.

---

## 5. Proposed endpoints — Credit Contracts

Base: `/api/credit-contracts`. Same auth model as §4.

Recommended storage: separate `credit_contracts` / `credit_contract_orders`
tables (the lifecycle and the FS-No rule differ from standard contracts, and
mixing them would reinterpret existing records). If the team prefers one table,
add `contract_kind ('STANDARD' | 'CREDIT')` and keep every query filtered.

| Method + path | Purpose | Notes |
|---|---|---|
| `GET /api/credit-contracts` | list | Sales sees active ones |
| `POST /api/credit-contracts` | create draft | **FS No optional**; never generate a placeholder |
| `GET/PUT /api/credit-contracts/{id}` | show / update draft | update only while `DRAFT` |
| `POST /api/credit-contracts/{id}/activate` | `DRAFT → ACTIVE` | Finance |
| `POST /api/credit-contracts/{id}/cancel` | `{ "reason": "…" }` | blocked once `INVOICED` |
| `GET/POST /api/credit-contracts/{id}/orders` | list / add order | any authorized Sales user; no order limit |
| `PUT /api/credit-contracts/{id}/orders/{orderId}` | correct | attribution preserved |
| `POST /api/credit-contracts/{id}/orders/{orderId}/cancel` | cancel with reason | Finance |
| `POST /api/credit-contracts/{id}/finalize` | FS No **required here**; creates ONE invoice | `{ "fsNo": "2704301", "reason": "…" }`; reason required below contract value |
| `GET /api/credit-contracts/{id}/financial-report` | same shape as §4.6 | |
| `GET /api/credit-contracts/{id}/invoice` | resulting invoice | for the "View Invoice" link |

Finalization must run in one transaction: validate FS No → validate completed
orders → create invoice (`contractId`) → mark `INVOICED` → freeze orders →
write audit. Retries must return the existing invoice, never a duplicate.
Contract orders must not count as finalized revenue until that invoice is
Finance-approved (the existing invoice lifecycle already models this).

---

## 6. Proposed endpoints — contract payment information & withholding

These apply to **both** contract systems (a `kind`/base-path distinction is
enough; the payloads are identical).

| Method + path | Purpose | Authorization |
|---|---|---|
| `PUT /api/contracts/{id}/payment-information` | record/update | Finance only |
| `DELETE /api/contracts/{id}/payment-information` | clear (audited) | Finance only |
| `GET /api/contracts/{id}/payment-information` | read | Sales (read) + Finance |
| `PUT /api/contracts/{id}/withholding` | enable/disable + evidence | Finance only |
| `GET /api/contracts/{id}/payment-history` | audit trail | Finance; Sales read-only summary |

**Payment payload**
```json
{ "bank": "CBE", "paymentSender": "Abebe Kebede",
  "paymentAmount": 7000000, "paymentDate": "2026-03-05",
  "paymentReferenceNumber": "TXN-12345",
  "paymentEvidence": { "id": "uuid", "fileName": "receipt.jpg", "fileUrl": "…",
    "mimeType": "image/jpeg", "fileSize": 90000 },
  "remark": "First instalment" }
```
Rules:
- Optional at contract creation and after completion; **never** mandatory to
  finalize/convert.
- Recording details must **not** change `paid` amounts or payment status to
  "paid". Only the invoice payment confirmation does that.
- `paymentAmount` is informational (`reported`, not `confirmed`).
- `recordedBy`/`recordedAt` come from the token; later edits keep the original
  recorder and add `updatedAt`.
- Validation: bank/sender/reference required **when the record is submitted**;
  amount ≥ 0; valid date; evidence type PDF/JPG/PNG.

**Withholding payload**
```json
{ "enabled": true,
  "evidence": { "id": "uuid", "fileName": "withholding.pdf", "fileUrl": "…",
    "mimeType": "application/pdf", "fileSize": 120000 } }
```
Rules:
- Rate is fixed at **0.03 of the VAT-inclusive total** (server calculates; the
  client never sends an amount).
- Evidence **required when enabled**, ignored/cleared when disabled — mirroring
  the Sales Invoice rule.
- Withholding is never a payment, never fulfillment, and must not be
  double-counted in balances.
- Disabling withholding must set amount/net back to the no-withholding values.

When the contract converts/finalizes, these values must flow into the invoice
(the frontend already sends `withholdingEnabled`, `withholdingEvidence` and the
payment fields, all of which the invoice controller accepts).

---

## 7. Payment ledger (insufficient support today)

Today `POST /api/sales/invoices/{id}/confirm-payment` records ONE confirmation
and the invoice becomes `PAYMENT_CONFIRMED` in full. Consequences:

- The frontend cannot show **Partially paid** truthfully, so it reports
  "Recorded — not confirmed", "Awaiting payment confirmation" or "Paid".
- `amountPaid` is either 0 or the full net amount.

Proposed (needed for partial payments):
| Method + path | Purpose |
|---|---|
| `GET /api/sales/invoices/{id}/payments` | list confirmed payments |
| `POST /api/sales/invoices/{id}/payments` | record a payment `{ amount, bank, paymentSender, paymentReferenceNumber, paymentDate, evidence }` |
| `POST /api/sales/invoices/{id}/payments/{paymentId}/confirm` | Finance confirmation |
| `GET /api/sales/invoices/{id}/payment-summary` | `{ amountDue, amountPaid, outstanding, status }` |

Until this exists, the frontend keeps `amountPaid = netAmount` for a
`PAYMENT_CONFIRMED` invoice and `0` otherwise, and **does not invent** partial
amounts. A `sales_invoice_payments` table with a `SUM(confirmed amount)` view is
the recommended single source of truth; `amountPaid` must never exceed
`net_amount_after_withholding` without an explicit overpayment flag.

---

## 8. Audit & idempotency requirements

1. **Actor identity from the token** — never accept `completedBy`, `createdBy`,
   `recordedBy` or similar from the request body.
2. **Append-only history** for contract lifecycle
   (`contract_status_history`), order edits (`last_edited_by*`), and
   payment/withholding changes (`contract_financial_history`:
   `action, at, by, note`). The frontend already renders
   `paymentHistory` entries (`PAYMENT_INFORMATION_RECORDED`,
   `PAYMENT_INFORMATION_UPDATED`, `PAYMENT_INFORMATION_CLEARED`,
   `WITHHOLDING_UPDATED`).
3. **Idempotency keys** — `royalty_source_key = 'contract-order:{orderId}'`
   (unique) and `sales_invoices.contract_id` (unique) are the two guards the
   frontend relies on to avoid duplicate royalty rows and duplicate invoices.
4. **Transactions** — finalize/convert must be atomic: invoice creation + status
   change + audit. A failed conversion must leave the contract unconverted and
   retryable.
5. **Concurrency** — order numbers per contract must be assigned inside the
   transaction (`MAX(order_number) + 1` under a row lock), because multiple
   Sales users can add orders to the same contract.

---

## 9. Proposed schema (minimum)

```sql
-- already referenced by the royalty SQL; add only what is missing
ALTER TABLE contracts
  ADD COLUMN completion_confirmed_at  timestamptz,
  ADD COLUMN completion_confirmed_by  text,
  ADD COLUMN completion_reason        text,
  ADD COLUMN closed_below_value       boolean DEFAULT false,
  ADD COLUMN sales_invoice_id         uuid REFERENCES sales_invoices(id),
  ADD COLUMN cancelled_at             timestamptz,
  ADD COLUMN cancelled_by             text,
  ADD COLUMN cancellation_reason      text;
CREATE UNIQUE INDEX contracts_sales_invoice_uq ON contracts(sales_invoice_id);

ALTER TABLE contract_orders
  ADD COLUMN completed_by_user_id  text,
  ADD COLUMN completed_by_name     text,
  ADD COLUMN completed_by_email    text,
  ADD COLUMN last_edited_by_user_id text,
  ADD COLUMN last_edited_by_name   text,
  ADD COLUMN edited_at             timestamptz,
  ADD COLUMN royalty_source_key    text,
  ADD COLUMN cancelled_at          timestamptz,
  ADD COLUMN cancel_reason         text;
CREATE UNIQUE INDEX contract_orders_royalty_key_uq
  ON contract_orders(royalty_source_key);
CREATE UNIQUE INDEX contract_orders_number_uq
  ON contract_orders(contract_id, order_number);

CREATE TABLE contract_payment_information (
  id uuid PRIMARY KEY,
  contract_kind text NOT NULL,            -- 'STANDARD' | 'CREDIT'
  contract_id uuid NOT NULL,
  bank text NOT NULL,
  payment_sender text NOT NULL,
  payment_amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_date date,
  payment_reference_number text NOT NULL,
  evidence_attachment_id uuid,
  remark text,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contract_withholding_information (
  contract_kind text NOT NULL,
  contract_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  rate numeric(5,4) NOT NULL DEFAULT 0,
  evidence_attachment_id uuid,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contract_financial_history (
  id uuid PRIMARY KEY,
  contract_kind text NOT NULL,
  contract_id uuid NOT NULL,
  action text NOT NULL,
  note text,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 10. Frontend mapping (where each endpoint is consumed)

| Frontend file | Needs |
|---|---|
| `src/services/contracts/repository.ts` | §4.1–4.7, §6 |
| `src/services/contracts/financials.ts` | §4.6 shape (payment/withholding statuses) |
| `src/services/creditContracts/repository.ts` | §5, §6 |
| `src/services/sales/apiInvoiceRepo.ts` | existing invoice + attachment endpoints (already wired) |
| `src/services/finance/royaltyReport.ts` | existing `GET /api/finance/royalty-reports` (already wired) |
| `src/components/contracts/ContractPaymentDialog.tsx` | attachments upload (existing) + §6 |
| `src/components/contracts/ContractFinancialReportCard.tsx` | §4.6 |

Suggested frontend implementation order once the endpoints land: replace
`src/services/contracts/storage.ts` and
`src/services/creditContracts/storage.ts` with API-backed repositories; the
pages, hooks and calculations do not change.

---

## 11. Assumptions requiring backend confirmation

1. `contracts` / `contract_orders` tables exist in the deployed database (the
   royalty SQL references them, but no schema file is in the repository). Their
   exact columns — especially attribution and `royalty_invoice_number` — must be
   confirmed before the ALTERs above are written.
2. Credit contracts are assumed to need their **own** tables/endpoints. If the
   backend prefers a `contract_kind` column on `contracts`, the endpoints in §5
   can be merged into §4 with that filter.
3. `POST /api/sales/invoices` already accepts `contractId`, `withholding*` and
   `payment` fields; whether it stores `contractId` for a contract that does not
   exist in the database was not verifiable without running the backend, and it
   must be validated against the (to-be-implemented) contract endpoints.
4. Partial payments are unsupported (§7); the frontend therefore never displays
   a partial amount as paid.
5. Withholding evidence is uploaded through the existing invoice attachment
   endpoint (`POST /api/sales/attachments/upload`). If contract attachments get
   their own upload endpoint, the frontend must be pointed at it.
6. Nothing here was tested against a running PHP backend during this task; all
   backend statements come from reading `Routes.php`, the controllers and their
   SQL.
