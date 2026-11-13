# NexERP — Backend Integration Guide

How the Vite frontend connects to a future production backend, written
deliberately for **either a PHP API (framework of the backend team's choice)
or Python Django (optionally Django REST Framework)**. Nothing here requires
one language, ORM, database, or framework.

Companion documents: `frontend-architecture.md` (current frontend) and
`api-contracts.md` (per-module endpoint requirements).

---

## 1. Ground rules

1. **The current application is the source of truth** until a deliberate,
   verified migration. No endpoint below exists or has been called.
2. **Pages never change for a backend swap.** They depend on repository
   interfaces; adapters implement them.
3. **One composition point** decides which implementation serves a
   repository. Feature code never branches on "which backend".
4. **No silent fallbacks.** A failed request surfaces a typed error; it must
   never degrade into mock data.
5. **The backend is the security boundary.** Frontend role checks exist for
   usability only; every operation must be authorized server-side.
6. **Business rules already implemented in the frontend are the reference
   behavior.** The backend must reproduce them (same formulas, same
   idempotency, same transitions) or explicitly document a change.
7. **Language-neutral contract.** JSON over HTTP, camelCase keys, ISO-8601
   UTC timestamps, decimal-safe money. A PHP team may use Laravel/Symfony or
   plain routers; a Django team may use DRF views/serializers or plain
   views — the contract does not care.

## 2. What exists today

| Concern | Current implementation |
| --- | --- |
| Domain data (sales, contracts, finance, expenses, inventory, payroll, reports) | Browser `localStorage` repositories under `src/services/*` |
| Authentication | Mock identity source (`src/services/auth/authRepository.ts`) with seeded accounts |
| Convex | Auth scaffolding only (`ConvexAuthProvider` in `main.tsx`, `users` table in `src/convex/schema.ts`) — no domain tables, no domain queries |
| HR API | HR module client exists (`src/services/hr/apiClient.ts`) and targets the future HR endpoints under `VITE_HR_API_URL` (default `https://erpp.page.gd` is a placeholder dev host, not a working API). It probes once at startup and falls back to an in-memory mock — the endpoints themselves are not built yet (`api-contracts.md` §9) |
| HTTP layer | New shared client `src/lib/api/client.ts` (typed errors, envelopes, timeouts, upload/download) — not yet used by any feature |
| Reference adapter | `src/services/adapters/rest/expensesRepository.ts` implements the expenses contract; **not active**, not tested against a live server |

Storage keys and the exact record shapes a migration must import are listed
in `frontend-architecture.md` §6 and README §5.

## 3. Target architecture

```
Page / component
      │  renders state, calls operations
Feature hook (src/hooks/use-*-data.ts)
      │
Service repository interface (src/services/<module>)
      │
      ├── Local*Repository        ← active today (browser storage)
      │
      └── Rest*Repository         ← future (src/services/adapters/rest)
                │
          ApiClient (src/lib/api/client.ts)
                │  baseURL, auth, errors, timeouts
          PHP / Django REST API
```

What moves to the backend:

- Persistence and migrations (starting from the localStorage record shapes).
- Authorization, status transitions, and idempotency guarantees.
- Sequence generation (invoice/contract/record numbers) — the frontend
  currently derives them and will accept server-provided values.
- File storage for evidence/attachments.
- Report/summary aggregation (optional: the frontend can keep computing from
  lists until server aggregates exist).

What stays in the frontend:

- Rendering, local form state, optimistic UX.
- Shared calculation helpers for live previews (the server recomputes
  authoritative totals).
- Client-side validation for usability (server revalidates).

## 4. API client (`src/lib/api`)

### Configuration (`config.ts`)

| Env var | Purpose | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Base URL of the API (no trailing slash) | empty — REST calls throw `ApiConfigurationError` |
| `VITE_API_TIMEOUT_MS` | Request timeout | `20000` |
| `VITE_API_WITH_CREDENTIALS` | `credentials: "include"` for cookie auth | `false` |
| `VITE_HR_API_URL` | Base URL for the future HR module endpoints (see `api-contracts.md` §9) | `https://erpp.page.gd` — placeholder dev host, not a running NexERP API |

`apiUrl(path)` joins relative endpoints to the base and rejects absolute
URLs so no feature hardcodes a host.

### Usage

```ts
import { apiClient, configureApiAuth } from "@/lib/api";

// once, from the auth integration:
configureApiAuth({
  getAccessToken: () => sessionToken,
  onUnauthorized: () => clearSessionAndRedirect("/auth"),
});

const invoices = await apiClient.get<SalesInvoiceDto[]>("/invoices", {
  query: { status: "FINANCE_APPROVED", page: 1 },
  signal: abortController.signal,
});
await apiClient.post<ExpenseDto>("/expenses", writeDto);
await apiClient.patch<ExpenseDto>(`/expenses/${id}`, patchDto);
await apiClient.delete(`/expenses/${id}`);
await apiClient.upload<AttachmentDto>("/attachments", formData);
const blob = await apiClient.download(`/attachments/${id}/file`);
```

### Request/response conventions

- Successful bodies are `{ "data": ... }`; list endpoints may add
  `{ "meta": { page, perPage, total, totalPages } }`. `unwrapApiData` also
  tolerates a bare payload during migration.
- JSON by default; `FormData`/`Blob` bodies pass through untouched
  (multipart boundary handled by `fetch`).
- 204/205 and empty bodies resolve to `undefined` — no parse crash.
- Query params: empty/undefined/null values are dropped; arrays repeat the
  key; everything else is stringified.
- Timeouts abort via `AbortController`; caller-supplied `signal` supports
  cancellation.

### Errors

The client maps every failure to `ApiError` with a `kind`, optional
`status`, `code`, `fieldErrors`, `requestId`, and `retryable` flag:

| HTTP | kind | Frontend behavior |
| --- | --- | --- |
| 401 | `unauthorized` | centralized `onUnauthorized` → clear session, redirect to `/auth` |
| 403 | `forbidden` | permission message, no retry |
| 404 | `not_found` | record missing; single-record lookups return `null` |
| 409 | `conflict` | "changed by someone else — reload" |
| 422 | `validation` | `ApiValidationError.fieldErrors` maps to form fields |
| 429 | `rate_limit` | retryable message |
| 5xx | `server` | retryable generic message |
| — | `timeout` / `network` | retryable connection message |
| — | `parse` | malformed payload — never rendered raw |

Backend error envelope:

```json
{
  "message": "Only invoices pending finance review can be approved",
  "code": "INVOICE_NOT_PENDING",
  "errors": { "reason": ["A rejection reason is required."] }
}
```

Field keys in `errors` should match the DTO field names so the frontend can
attach messages to inputs. Return `X-Request-Id` for correlation.

## 5. Authentication and sessions (needs agreement)

**Option A — bearer token (typical SPA + API):**
`POST /auth/login` returns `{ accessToken, refreshToken?, user }`; the auth
service stores it and registers `getAccessToken` with `configureApiAuth`;
refresh happens before/after 401 in one place; logout invalidates
server-side.

**Option B — session cookies:** set `VITE_API_WITH_CREDENTIALS=true`;
backend sets `HttpOnly; Secure; SameSite` cookies for the app origin and
enables credentialed CORS; agree on CSRF (double-submit token or
same-site-only + custom header).

Decisions the backend team must confirm:

1. Login/logout/refresh endpoints, token lifetimes, revocation.
2. `GET /auth/session` (or `/me`) returning the user profile + role.
3. Password reset/OTP email delivery (the frontend currently records
   "initiated" only).
4. CORS origins for local development and production.
5. Rate limiting on auth endpoints.
6. Whether disabled accounts invalidate existing sessions server-side
   (the frontend revalidates on every protected route as defense in depth).

User profile DTO: `ApiUserDto { id, displayName, email, role, department?,
accountStatus? }` (see `api-contracts.md` §1). The backend maps its own user
model; do not copy Convex's shape.

## 6. Money, dates, ids, pagination

- **Money**: serialize as a number or decimal string with at most two
  fraction digits. Never rely on binary floating point for stored totals;
  use decimal columns/types server-side. The frontend normalizes both forms.
  Authoritative totals (invoice summary, expense breakdown, royalty,
  payroll, profit) are recomputed by the server and returned in responses.
- **Dates**: ISO-8601 UTC strings (`2026-10-18T09:30:00.000Z`) for
  timestamps; expense/report business dates are day-scoped — agree the
  company timezone and document it. Filter ranges (`from`/`to`) are
  inclusive and interpreted in that timezone.
- **Ids**: opaque strings. Browser-generated ids (`crypto.randomUUID()`)
  may appear in payloads during migration; the server may adopt or re-key
  them, but references (source order id, contract id, payroll id) must stay
  consistent.
- **Numbers**: sequence fields (`INV-00001`, `CONTRACT-0001`,
  `FIN-REC-0001`, `PAY-REC-0001`, `SALES-REPORT-0001`, per-contract order
  numbers, royalty batch numbers) must be generated by the server with a
  uniqueness guarantee; the frontend displays whatever it is given.
- **Pagination/filter/sort**: `page` + `perPage` in query, `meta` in
  response; filters use the documented names (`status`, `source`,
  `expenseType`, `from`, `to`, `search`, `year`, `month`); default sort per
  endpoint documented (newest first unless noted).

## 7. Files and attachments

One metadata shape everywhere: `{ id, fileName, fileUrl, mimeType,
fileSize }` (used for payment evidence, withholding evidence, contract
attachments, expense attachments).

Pick one flow:

- **A. Multipart upload**: `POST /attachments` (`multipart/form-data`)
  returns the metadata; the client then references `id` in the parent
  record's write payload.
- **B. Signed upload**: `POST /attachments/sign` returns a short-lived
  upload URL; the client uploads directly and submits the resulting
  metadata.

Requirements either way: downloads authorized for the same roles that can
read the parent record; no empty attachment records; size/type limits
enforced server-side (contracts accept PDF/JPG/PNG today; expense evidence
accepts images/PDF); the frontend's object URLs are a demo stand-in only.

## 8. Per-module implementation notes

The authoritative operation list and DTOs are in `api-contracts.md`. The
hard requirements per module:

### Auth / users
- Session identity + role; disabled-account enforcement; account CRUD with
  last-admin protection; audit log; password-reset initiation returning an
  honest result.

### Sales invoices
- Validate on submit (same fields as the frontend validator).
- Status transitions only in the allowed direction; approve/reject require
  `PENDING_FINANCE_REVIEW`; payment confirmation requires
  `FINANCE_APPROVED` and is idempotent (exactly one financial record per
  invoice).
- Recompute line totals, VAT, withholding, and royalties server-side.
- Keep legacy fields (`legacyOrderId`, `legacyReffNo`, …) if importing
  migrated data.

### Contracts
- `POST /contracts/{id}/convert` must be idempotent (three guards in the
  frontend today: already-converted, an invoice already carrying this
  contract id, and an in-flight conversion lock). Exactly one invoice per
  contract; invoice lines keep `contractOrderId` and `orderDate`.
- Reaching the contract value only flags `READY_FOR_COMPLETION`; never
  auto-convert or auto-complete.
- Order completion attribution: `completedBy*` is immutable; corrections
  record the editor separately.
- One FS No per contract, carried into the invoice.

### Expenses
- `expenseType` (`STANDARD`/`CASUAL`) persisted; CASUAL ⇒ VAT not
  applicable, bank/evidence optional; STANDARD ⇒ bank + invoice evidence
  required at submission; WHT attachment required when WHT is enabled.
- `expenseSource` assigned from the authenticated role, never from the
  payload; submission/approval transitions and the counting rule
  (ADMIN records count only when APPROVED) preserved; legacy
  `paymentStatus` values never relabelled.
- Review endpoints return the same record id (no duplicates on
  resubmission).

### Financial & payroll records
- Created by payment confirmation / payroll payment respectively;
  idempotent per source; sequential record numbers.

### Inventory
- Sync endpoint semantics: create or reconcile per
  `sourceInvoiceId :: sourceOrderId`; never touch recorded sold quantities;
  re-running must not duplicate. Unsold is always derived
  (`original − sold`, never negative) and status derived from quantities.

### Monthly unsold-aggregate reports
- One report per `YYYY-MM`; drafts hidden from Sales/Admin; corrections
  append a revision and keep previous submitted values; Finance-only
  writes; reporting starts at the configured month (currently `2026-10`).

### Royalty
- Row keys stable across edits/conversions; finalized batches exclude their
  rows from the report; exactly seven export columns; partial exports never
  consume the queue.

### HR
- There is no working HR API; the backend builds the HR endpoints from
  scratch, matching the shapes the frontend client already speaks (see
  `api-contracts.md` §9): dashboard, employees, attendance — snake_case
  keys, `{ data, message? }` envelope, Bearer auth — plus new leave and
  payroll endpoints mirroring the local repositories. Because the client
  already exists, implementing the contract requires **no frontend
  changes**; afterward, delete the client's startup probe/mock fallback
  (ground rule 4).

### Admin
- Read-only aggregates matching the frontend formulas (VAT extraction,
  gross income, royalty base, expense counting, net profit) so every
  portal shows identical numbers.

## 9. Adding a REST adapter without rewriting pages

1. Agree and implement one module's endpoints (expenses is the reference).
2. Verify payloads against `api-contracts.md` (add a stub-fetch script like
   `scripts/api-client-verify.ts` for the new DTOs).
3. Complete/create `src/services/adapters/rest/<module>.ts` implementing the
   module's repository interface; keep DTO mapping in a sibling file.
4. Add a single adapter-selection point (a small factory/provider) that
   returns either the `Local*` or `Rest*` implementation. Do not branch in
   pages or hooks.
5. Switch module by module; run that module's verification scripts plus
   `bun tsc -b --noEmit` after each switch.
6. Remove the local implementation only after the REST path is verified in
   production-like conditions. Never keep a fallback that hides failures.

Reference implementation: `src/services/adapters/rest/expensesRepository.ts`
(creates/lists/updates/submits/approves/rejects/deletes; `subscribe()` is an
explicit no-op because no realtime channel is agreed yet).

## 10. Data migration from the browser

1. Export each storage key (README §5) as JSON — the shapes are the domain
   types documented in `frontend-architecture.md` §7.
2. Import in dependency order: accounts/users → customers/invoices (+ legacy
   archive) → contracts/orders → financial/payroll records → expenses (+
   audit) → inventory (+ monthly reports) → royalty batches.
3. Preserve original ids or maintain an id map; keep `createdBy`/
   `submittedBy`/`approvedBy` identities as display strings and map them to
   real users where possible.
4. Re-run derived-value reconciliation with the server's formulas; log any
   drift instead of silently rewriting history.
5. Legacy migrations already in the frontend (ORDER-xxxx → invoices;
   expense `expenseSource` inference; inventory `origin`) define expected
   behavior for historical rows — mirror them.

## 11. Implemented vs placeholder

| Item | Status |
| --- | --- |
| Shared API config/client/errors/DTOs | Implemented and script-verified (no live server) |
| Expenses REST adapter + DTO mapping | Implemented against the proposed contract; **not active**, **not live-tested** |
| HR endpoints | Not implemented — the frontend HR client exists, probes `VITE_HR_API_URL` once, and serves mock data while the endpoints are absent (`api-contracts.md` §9) |
| Other REST adapters | Not created (interfaces + contracts only) |
| Adapter selection switch | Not created yet |
| Attachment upload endpoint | Open decision (multipart vs signed URL) |
| Auth token/session exchange | Not implemented (mock auth) |
| Realtime subscriptions | Not implemented; mutations refresh locally |
| Server-side authorization | Backend responsibility |
| Convex removal | Optional; touches only `main.tsx` + `src/convex/*` |

## 12. Recommended sequence

1. Auth + `GET /auth/session`, CORS, error envelope — verify login, 401
   handling, disabled accounts.
2. Users/accounts management + audit log.
3. Reference data (aggregates, banks, expense categories, units).
4. Sales invoices (create/draft/submit/approve/reject/confirm-payment) +
   financial records; wire the Sales and Finance portals.
5. Contracts + contract orders + conversion; verify idempotency under
   double-click and partial-failure tests.
6. Expenses (standard/casual) + review + summary.
7. Inventory sync + monthly reports.
8. Royalty rows + batches + Excel export.
9. HR endpoints (dashboard, employees, attendance, leave, payroll —
   `api-contracts.md` §9); then remove the client's mock fallback.
10. Admin aggregates/reports; then remove the localStorage implementations.

Each phase: implement → contract-verify with stub responses → staging →
switch the adapter → monitor → only then delete the local path.

## 13. Verification approach for a new adapter

- Reuse the existing script harness: run the repository interface through
  the adapter against a stubbed `fetch` (see `scripts/api-client-verify.ts`)
  to assert paths, payloads, envelope handling, and error mapping.
- Add contract tests against the real API (staging) mirroring the
  business-rule scripts (`scripts/*-verify.ts`) so frontend and backend
  agree on transitions, idempotency, and totals.
- Keep `bun tsc -b --noEmit`, `bun run lint`, and `bun run build` green.

## 14. Open questions for the backend team

1. Auth strategy (bearer vs cookies), token lifetime, refresh, logout.
2. Base URL(s), versioning prefix, CORS origins.
3. Money storage (decimal type + scale) and rounding mode; company timezone.
4. Attachment flow and storage backend; size/type limits.
5. Optimistic concurrency strategy (`updatedAt` compare-and-set vs version
   column) — the frontend sends full payloads and expects 409 on conflicts.
6. Whether summaries/aggregates are computed server-side or fetched as
   lists (current frontend computes them).
7. Realtime strategy (none today; the frontend supports refetch-on-notify).
8. Legacy data import ownership and the id-mapping policy.
9. Audit-log retention and who may read it.
10. Which existing HR endpoints survive, and their new base path.
