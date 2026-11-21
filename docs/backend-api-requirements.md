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
| Fulfillment | Standard contracts: contract value vs **VAT-inclusive** fulfilled value, display capped at 100%. Credit contracts have no value/threshold and use accumulated totals. | frontend `getContractProgress`, `getCreditContractTotals` |
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
    "mimeType": "application/pdf", "fileSize": 240000 } ],
  "payment": { "bank": "CBE", "paymentSender": "Abebe Kebede",
    "paymentAmount": 7000000, "paymentDate": "2026-03-05",
    "paymentReferenceNumber": "TXN-12345",
    "paymentEvidence": { "id": "uuid", "fileName": "receipt.jpg",
      "fileUrl": "/api/sales/invoices/attachments/uuid",
      "mimeType": "image/jpeg", "fileSize": 90000 },
    "remark": "optional" },
  "withholding": { "enabled": true, "evidence": { "id": "uuid",
    "fileName": "withholding.pdf", "fileUrl": "…",
    "mimeType": "application/pdf", "fileSize": 120000 } } }
```
**Validation**: customer name/TIN required; value > 0; valid date; FS No
non-empty; attachment mime `application/pdf|image/jpeg|image/png|image/webp`.
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
`lastEditedBy*`/`editedAt` separately. If the contract is already fully
fulfilled, reject any correction that increases the VAT-inclusive fulfilled
total (`409`); equal/lower corrections remain valid. A below-100% correction
may cross the threshold, after which further order entry is closed.

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
| `POST /api/credit-contracts` | create draft | **No FS No**: do not accept, require, or generate one at creation |
| `GET/PUT /api/credit-contracts/{id}` | show / update draft | update only while `DRAFT` |
| `POST /api/credit-contracts/{id}/activate` | `DRAFT → ACTIVE` | Finance |
| `POST /api/credit-contracts/{id}/cancel` | `{ "reason": "…" }` | blocked once `INVOICED` |
| `GET/POST /api/credit-contracts/{id}/orders` | list / add order | any authorized Sales user; no order limit |
| `PUT /api/credit-contracts/{id}/orders/{orderId}` | correct | attribution preserved |
| `POST /api/credit-contracts/{id}/orders/{orderId}/cancel` | cancel with reason | Finance |
| `POST /api/credit-contracts/{id}/finalize` | FS No **required here**; creates ONE invoice | `{ "fsNo": "2704301", "reason": "…" }`; `reason` is an optional note, never a below-value justification |
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
  amount ≥ 0; valid date; evidence type PDF/JPEG/PNG/WebP.

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

---

## 12. Contract / credit-contract / royalty-batch refinement (current frontend implementation)

This section documents the backend work implied by the latest frontend changes.
The frontend is still local-first for contracts (documented limitation, §3), so
no contract/credit-contract endpoint below exists or was called. The only real
backend call added by this work is the already-existing authenticated
attachment upload (`POST /api/sales/attachments/upload`), reused for payment,
withholding, and paper-contract files; it still cannot link those files to a
contract until the contract APIs exist.

### A. Standard contracts — payment information, withholding, 100% order lock

1. **Persist payment information with the contract**
   - `POST /api/contracts` and `PUT /api/contracts/{id}` accept the nested
     shapes the frontend actually sends:
     `payment: { bank, paymentSender, paymentAmount, paymentDate,
     paymentReferenceNumber, paymentEvidence: { id, fileName, fileUrl,
     mimeType, fileSize } | null, remark } | null` and
     `withholding: { enabled, evidence: { id, fileName, fileUrl, mimeType,
     fileSize } | null }`.
     The existing attachment IDs come from
     `POST /api/sales/attachments/upload`; the backend should store the id and
     must not trust a client-only URL/object. (`§6` uses the same nested shape.)
     Evidence is uploaded before the contract save; if the save then fails, the
     uploaded file is orphaned, so the backend needs attachment cleanup/linking.
   - `payment` is optional; when present, `bank`, `paymentSender` and
     `paymentReferenceNumber` are required. `paymentAmount` is a **reported**
     amount, never a confirmation. A payment remark or evidence alone is still
     payment input and is validated rather than silently discarded.
   - Contract creation/editing requires `contractValue > 0`. Legacy zero-value
     rows stay closed for order entry; no order may be accepted against a
     zero/negative value. Correct them through a controlled back-office data
     correction or recreate them — the frontend has no active-contract value
     edit path.
   - `withholding.enabled = true` requires an evidence attachment id.
   - The backend derives `withholdingRate` (0.03) and `withholdingAmount`
     (`grossInclVat × 0.03`); it must never accept a client-computed amount.
   - `paymentHistory` is append-only
     (`PAYMENT_INFORMATION_RECORDED|UPDATED|CLEARED`, `WITHHOLDING_UPDATED`)
     with actor and timestamp. Append an update only when a persisted payment
     field or the evidence attachment ID actually changed; an unrelated
     contract edit must not produce a payment event or change `updatedAt`.
   - Database: `contract_payment_information`, `contract_withholding` (or
     nullable columns on `contracts`) plus `contract_payment_history`.

2. **Contract financial summary**
   - `GET /api/contracts/{id}` should return the same derived shape the
     frontend builds in `services/contracts/financials.ts`:
     `subtotalExclVat`, `totalVat`, `grossAmountDue`, `grossAmountDueBasis`
     (`INVOICE` | `COMPLETED_ORDERS`), `withholdingAmount`, `netAmount`,
     `amountPaid` (only from `PAYMENT_CONFIRMED`), `outstandingBalance`,
     `paymentStatus`, `withholdingStatus`.
   - `contract_value` stays VAT-inclusive; fulfillment is
     `Σ(completed order quantity × unitPrice × 1.15)` — exactly the existing
     frontend `getContractProgress` rule.

3. **100% fulfillment closes order entry**
   - `POST /api/contracts/{id}/orders` must, inside one transaction, lock the
     contract row, recompute the fulfilled value from `COMPLETED` orders, and
     reject with `409 { code: "CONTRACT_FULLY_FULFILLED" }` when
     `fulfilledValue >= contractValue`.
   - The rule applies to the order that **reaches** 100% (it is accepted) and
     to every later attempt, including retries and stale forms. It is not a
     UI-only constraint.
   - `PUT` of an order (correction) and `POST .../cancel` must recompute and
     return the new eligibility. A correction on a fully fulfilled contract
     must reject any increase in fulfilled value (409) while allowing an equal
     or lower total; the frontend applies the same rule before persisting.
     Only a below-100% contract may be corrected up to/over 100%, which then
     closes further entry. The frontend re-enables Add Order when fulfillment
     drops below 100% and the lifecycle still accepts orders.
   - Do not change the existing lifecycle: reaching 100% only flags
     `READY_FOR_COMPLETION`; Finance still confirms and converts.
   - Index: `contract_orders(contract_id, status)` for the sum.

### B. Credit contracts — no initial value, attachments, FS No at finalization

1. **Creation payload**
   - Remove `contractValue` and `fsNo` from `POST /api/credit-contracts`
     (and from the create validation). Accepted fields:
     `customerName`, `tin`, `contractDate`, `remark`, `attachments[]`
     (the uploaded metadata objects below; the frontend does not send raw IDs).
   - `contract_value` must not be used to limit, block, or compute anything.
     Existing rows may keep the column as `NULL`; new rows insert `NULL`.
   - `fs_no` stays nullable until finalization.

2. **Paper contract attachments**
   - The frontend uploads each file through the existing authenticated
     `POST /api/sales/attachments/upload` endpoint (verified: 10 MB maximum;
     PDF/JPEG/PNG/WebP accepted server-side). It stores the returned
     `{ id, fileName, fileUrl, mimeType, fileSize }` on the credit contract
     payload (`attachments`). The contract API must accept these attachment
     IDs/objects and persist them in `credit_contract_attachments`.
   - The frontend validates PDF/JPEG/PNG/WebP and the same 10 MB limit before
     uploading. Invalid or oversized selections block submission until the
     error is dismissed or the file is replaced; failed uploads block saving.
   - `POST /api/sales/attachments/upload` is invoice-namespaced and has no
     contract linkage. If the backend adds a contract-specific upload/purpose,
     point the frontend at it; until then, uploaded paper files have no parent
     record if contract creation later fails. The backend needs an attachment
     link/cleanup operation for that orphan case.
   - Existing uploaded attachments whose `fileUrl` points at the authenticated
     attachment route are fetched with the bearer token and displayed in-app as
     images or PDFs after reload. Local legacy metadata without a server file is
     labelled "metadata only" and cannot be opened; it must be re-uploaded.
   - **Backend still required:** the invoice-namespaced upload/view route does
     not provide per-contract attachment ownership. Contract and Credit Contract
     APIs must persist the attachment IDs/objects and expose an authorized way
     to resolve them after contract creation; orphan cleanup is also required.

3. **Orders and finalization**
   - `POST /api/credit-contracts/{id}/orders` is allowed only while
     `status = ACTIVE`; no value threshold and no order-count limit.
     Reject `DRAFT`, `INVOICED`, `CANCELLED` with `409`.
   - `POST /api/credit-contracts/{id}/finalize` requires `fsNo` (non-empty,
     unique per contract) and at least one completed order; it creates exactly
     one Sales Invoice and freezes the orders.
   - Idempotency: accept an `Idempotency-Key`; a retry must return the same
     invoice instead of creating a second one (`contractId` on the invoice is
     the second guard).
   - Finalization must **not** require a reason for being "below value" —
     credit contracts have no initial value. An optional note may be stored.
   - Accumulated totals (`completedOrderCount`, VAT-inclusive order value,
     VAT-exclusive royalty base) are computed from the orders, not stored on
     the contract.

4. **Finalization recovery (local guard)**
   - The frontend stores a local `finalizationStartedAt` marker and refuses a
     second attempt while it is recent. It clears the marker only after a
     conservative 10-minute timeout when no invoice linked to the contract is
     found — never merely because the page was refreshed.
   - The backend must still provide the authoritative idempotency guarantee
     (`Idempotency-Key`, unique `contractId` on the invoice) and a recovery
     path for an interrupted finalization; the local marker is not a
     cross-session lock.

### C. Royalty batches — 50 records, history download, integrity

Existing and verified against `Routes.php` / `FinanceRoyaltyReportsController`:
`GET /api/finance/royalty-reports`, `GET
/api/finance/royalty-reports/batches`, and `POST
/api/finance/royalty-reports/batches`. The backend excludes rows that belong
to a finalized batch and persists batch totals.

**Current behavior (not yet the required behavior):** `POST /batches` accepts
1–50 keys, revalidates eligibility under an advisory transaction lock, and
returns `409` when a retry contains rows already finalized. It does **not**
return the existing batch for an idempotent replay, and it does **not** enforce
exactly 50. Its `authenticate()` check verifies a valid active session only —
there is no Finance-role authorization.

**Finalization trigger (current decision).** The backend exposes no reliable
"complete the batch when the 50th record is registered" operation. The
frontend therefore never finalizes from page load, refresh or navigation:
those are read-only. A batch that reaches 50 is marked
"ready — Finance must finalize it" and an authorized Finance user presses the
existing **Finalize Batch (50)** action. Do not replace this with a client-side
auto-finalize effect. If the backend later gains an atomic, idempotent
completion-on-50th-record trigger, it must live entirely on the server and the
frontend should only refresh after notification.

Required additions/changes:

1. **Atomic 50-record batch creation**
   - The frontend now rejects anything other than exactly 50 unique keys and
     detects duplicate keys. Partial exports remain separate and never create a
     completed batch. `POST /batches` must enforce the same exact-50 rule
     atomically (unless a separately approved partial-close feature is added).
   - When 50 eligible, unfinalized rows exist, `POST /batches` must create the
     batch, persist its exact row membership and totals, and mark those rows as
     finalized in ONE transaction, returning the batch.
   - Membership is immutable. A row can appear in at most one completed batch
     (unique index on the row key / source reference).
   - Retries are idempotent: same `Idempotency-Key` or the same set of row keys
     must return the existing batch instead of creating another. Current 409
     behavior is a safe rejection but not idempotent replay. The frontend's
     in-flight ref/disabled button only prevents double clicks in ONE tab; it
     is not cross-user or cross-session idempotency, and the backend must reject
     a second batch containing already-finalized rows.
   - A second Finance user finalizing the same 50 rows concurrently must result
     in ONE batch and a clear conflict response (for example
     `409 { code: "BATCH_ALREADY_COMPLETED" }`); the frontend then reloads the
     current rows and Batch History instead of retrying.
   - After an unknown/timeout outcome the frontend reloads both views, because
     the server may have committed the batch before the response was lost.
     The backend endpoint must be safe to retry with the same row keys.
   - Rows beyond 50 stay eligible for the next batch.

2. **Batch history**
   - `GET /batches` returns `id`, `batchNumber`, `recordCount`, `totalSales`,
     `totalRoyalty`, `createdAt`, `status`, `orderIds` (membership).
   - Add `GET /batches/{id}` returning `{ batch, rows[] }`. `batch` must
     include the persisted `recordCount` (and ideally `batchNumber`,
     `totalSales`, `totalRoyalty`); `rows` must be the **snapshot** of the 7
     report columns (`date`, `royaltyInvoiceNumber`, `aggregate`, `quantity`,
     `unitPrice`, `lineTotalExclVat`, `royalty`). The frontend refuses to export
     if `batch` metadata is missing, `recordCount` is invalid, or
     `rows.length !== batch.recordCount`; it never rebuilds a batch from live
     rows.
   - Reuse the existing `royalty_batch_items` table as the snapshot; it already
     stores `invoice_line_id`, `contract_order_id`, `source_order_number`,
     `royalty_invoice_number`, `aggregate`, `quantity`, `unit_price`,
     `line_total_excl_vat`, `royalty_rate`, `royalty_amount`, and
     `source_order_date`. Do not create a duplicate `royalty_batch_rows` table.
     Add the read endpoint and return `source_order_date` as the `date` value.
   - Per-row `royalty_amount` is authoritative for exports; the frontend uses
     it when present and only falls back to `round(line_total_excl_vat × 0.03)`
     for rows that do not carry a snapshot royalty.

3. **Corrections after completion**
   - A completed batch is a historical reporting unit: editing a source order
     must not mutate its snapshot or totals. Corrections should be handled
     with an explicit revision/adjustment record (or a new batch) and
     documented in the audit log. The frontend currently cannot express such a
     correction, so no silent rewrite is possible.

4. **Finance-role authorization (security blocker)**
   - Affected existing endpoints: `GET /api/finance/royalty-reports`,
     `GET /api/finance/royalty-reports/batches`, and `POST
     /api/finance/royalty-reports/batches` (and the proposed
     `GET /batches/{id}`).
   - Current `FinanceRoyaltyReportsController::authenticate()` checks only for a
     valid bearer session and an active account. It does not check the user's
     role, so any authenticated user can read royalty/financial data and create
     a finalized batch through the API.
   - Required: Finance-role authorization on every Finance-only royalty
     operation, returning `401` for missing/invalid sessions and `403` for
     authenticated users without Finance permission. Batch finalization must be
     Finance-only.
   - Hiding or disabling the button in the frontend is not a security boundary.
     This is a backend blocker before production; the frontend alone cannot fix
     it.

### D. Compatibility summary

| Area | Backend today | Frontend now | Required backend work |
|---|---|---|---|
| Standard contracts | localStorage repository; existing attachment upload endpoint | payment/withholding at create+edit with real evidence upload, 100% add + correction lock enforced in repo | persist financial fields/evidence IDs; atomic fulfillment and correction checks; 409 error |
| Credit contracts | localStorage repository | no contract value, no FS No at create; paper files uploaded via existing attachment endpoint; FS No at finalize; no value threshold | column/payload changes, attachment link/cleanup + join, finalize validation |
| Royalty batches | `GET /batches`, `POST /batches` (existing, 1–50, 409 on retry, no role check); no completion-on-50th trigger | explicit Finance `Finalize Batch` at 50; page load is read-only; frontend enforces exactly 50 unique keys and verifies snapshot count; per-batch Download | Finance-role authorization, exact-50 atomic enforcement, `GET /batches/{id}` with `recordCount` + reuse of `royalty_batch_items`, unique membership, idempotent replay |
| Expenses | existing Finance/Admin APIs | API repository now notifies subscribers after mutations | none |
| Sales invoice | existing | New Invoice resets the form instead of reusing the submitted invoice | none |
