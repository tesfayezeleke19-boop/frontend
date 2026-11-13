/**
 * API layer verification — client behavior + expense DTO mapping.
 *
 * Run: bun scripts/api-client-verify.ts
 *
 * No network is used. A stub fetch exercises request building, envelopes,
 * error mapping, timeouts, uploads/downloads, and the REST expense adapter's
 * endpoint paths. This proves the frontend contract implementation works; it
 * does NOT prove a backend exists.
 */
import {
  ApiClient,
  ApiConfigurationError,
  ApiError,
  ApiValidationError,
  configureApiAuth,
} from "../src/lib/api";
import {
  createRestExpensesRepository,
  toExpense,
  toExpenseUpdateDto,
  toExpenseWriteDto,
} from "../src/services/adapters/rest";
import type { ApiExpenseDto } from "../src/lib/api/types";
import { EXPENSE_TYPE } from "../src/services/finance/types";
import {
  actorLabel,
  displayEmail,
  displayNameOf,
  initialsOf,
  toUserProfile,
} from "../src/services/auth/profile";

let failures = 0;

function expect(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
  if (!ok) failures++;
}

async function expectError(
  label: string,
  fn: () => Promise<unknown>,
  check: (error: unknown) => boolean,
  describe: string,
): Promise<void> {
  try {
    await fn();
    console.log(`FAIL  ${label} — expected an error, none thrown`);
    failures++;
  } catch (error) {
    const ok = check(error);
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? ` — ${describe}` : ""}`);
    if (!ok) failures++;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function capturingFetch(
  responder: (request: CapturedRequest) => Response | Promise<Response>,
  captured: CapturedRequest[],
): typeof fetch {
  return async (input, init) => {
    const request: CapturedRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    };
    captured.push(request);
    return responder(request);
  };
}

/* ------------------------------------------------------------------ */
/* 1. Client request construction                                      */
/* ------------------------------------------------------------------ */

console.log("\n1 — Request construction and response envelopes");
const captured: CapturedRequest[] = [];
const client = new ApiClient({
  baseUrl: "https://api.test",
  fetchImpl: capturingFetch(() => jsonResponse({ data: { ok: true } }), captured),
});

const unwrapped = await client.get<{ ok: boolean }>("/thing", {
  query: { a: "x y", empty: "", skip: undefined, list: ["a", "b"] },
});
expect("1: { data } envelope unwrapped", unwrapped, { ok: true });
expect(
  "1: query string encoded, empty values skipped, arrays repeated",
  captured[0].url,
  "https://api.test/thing?a=x+y&list=a&list=b",
);
expect("1: GET method and Accept header", [captured[0].method, captured[0].headers.get("accept")], ["GET", "application/json"]);

await client.post("/thing", { name: "Expense" });
expect("1: POST JSON method", captured[1].method, "POST");
expect("1: POST sets JSON content type", captured[1].headers.get("content-type"), "application/json");
expect("1: POST serializes body", JSON.parse(captured[1].body ?? "{}"), { name: "Expense" });

const emptyClient = new ApiClient({
  baseUrl: "https://api.test",
  fetchImpl: capturingFetch(() => new Response(null, { status: 204 }), []),
});
expect("1: 204 resolves undefined", await emptyClient.delete("/thing"), undefined);

const downloadClient = new ApiClient({
  baseUrl: "https://api.test",
  fetchImpl: capturingFetch(
    () => new Response("file-bytes", { status: 200, headers: { "content-type": "application/pdf" } }),
    [],
  ),
});
const blob = await downloadClient.download("/expenses/1/attachment");
expect("1: download returns a Blob", await blob.text(), "file-bytes");

console.log("\n2 — Typed errors");
await expectError(
  "2: 422 becomes ApiValidationError with field errors",
  () =>
    new ApiClient({
      baseUrl: "https://api.test",
      fetchImpl: capturingFetch(
        () => jsonResponse({ message: "Invalid expense", errors: { amount: ["Too low"] } }, 422),
        [],
      ),
    }).post("/expenses", {}),
  (error) =>
    error instanceof ApiValidationError &&
    error.fieldErrors?.amount === "Too low" &&
    error.message === "Invalid expense",
  "validation + field errors",
);

let unauthorizedCalled = 0;
await expectError(
  "2: 401 is surfaced and triggers the centralized handler",
  () =>
    new ApiClient({
      baseUrl: "https://api.test",
      fetchImpl: capturingFetch(() => jsonResponse({ message: "Expired" }, 401), []),
      onUnauthorized: () => {
        unauthorizedCalled++;
      },
    }).get("/expenses"),
  (error) => error instanceof ApiError && error.status === 401 && error.kind === "unauthorized",
  "unauthorized",
);
expect("2: 401 handler invoked once", unauthorizedCalled, 1);

await expectError(
  "2: network failure becomes a retryable network error",
  () =>
    new ApiClient({
      baseUrl: "https://api.test",
      fetchImpl: (async () => {
        throw new TypeError("connection refused");
      }) as typeof fetch,
    }).get("/expenses"),
  (error) => error instanceof ApiError && error.kind === "network" && error.retryable,
  "network",
);

await expectError(
  "2: invalid JSON becomes a parse error",
  () =>
    new ApiClient({
      baseUrl: "https://api.test",
      fetchImpl: capturingFetch(
        () => new Response("{broken", { status: 200, headers: { "content-type": "application/json" } }),
        [],
      ),
    }).get("/expenses"),
  (error) => error instanceof ApiError && error.kind === "parse",
  "parse",
);

await expectError(
  "2: absolute URLs are rejected (base URL stays centralized)",
  () => client.get("https://evil.example/expenses"),
  (error) => error instanceof ApiConfigurationError,
  "configuration",
);

await expectError(
  "2: a hanging request times out with a retryable error",
  () => {
    const slowClient = new ApiClient({
      baseUrl: "https://api.test",
      timeoutMs: 15,
      fetchImpl: ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })) as typeof fetch,
    });
    return slowClient.get("/expenses");
  },
  (error) => error instanceof ApiError && error.kind === "timeout" && error.retryable,
  "timeout",
);

/* ------------------------------------------------------------------ */
/* 3. User profile                                                     */
/* ------------------------------------------------------------------ */

console.log("\n3 — User profile (full name + email)");
expect("3: full name is displayed as provided", displayNameOf("Amina Yusuf", "amina@company.com"), "Amina Yusuf");
expect("3: missing name falls back neutrally", displayNameOf("  ", ""), "Unnamed user");
expect("3: missing email has a safe label", displayEmail(undefined), "Not provided");
expect(
  "3: profile exposes stable id, full name, email, role",
  toUserProfile({
    id: "usr-7",
    name: "Amina Yusuf",
    email: "amina@company.com",
    role: "FINANCE",
    department: "Finance",
  }),
  {
    id: "usr-7",
    fullName: "Amina Yusuf",
    email: "amina@company.com",
    role: "FINANCE",
    department: "Finance",
    accountStatus: undefined,
  },
);
expect("3: initials do not render undefined", initialsOf({ name: "Amina Yusuf", email: "amina@company.com" }), "AY");
expect(
  "3: audit actor prefers the trusted email",
  actorLabel({ name: "Amina Yusuf", email: "amina@company.com" }),
  "amina@company.com",
);

/* ------------------------------------------------------------------ */
/* 4. Expense DTO mapping                                              */
/* ------------------------------------------------------------------ */

console.log("\n4 — Expense DTO mapping");
const casualDto: ApiExpenseDto = {
  id: "exp-1",
  item: "Taxi fare",
  category: null,
  expenseType: "CASUAL",
  amountBeforeVat: "500.00",
  vatApplicable: false,
  vatAmount: "0",
  whtEnabled: false,
  whtAmount: "0",
  totalTransferred: "500.00",
  amount: "500.00",
  bank: null,
  paymentReference: null,
  paymentParty: null,
  invoiceAttachment: null,
  whtAttachment: null,
  remark: "  site visit  ",
  expenseDate: "2026-10-18T00:00:00.000Z",
  createdBy: "finance@company.com",
  createdAt: "2026-10-18T08:00:00.000Z",
  updatedAt: "2026-10-18T08:00:00.000Z",
  expenseSource: "FINANCE",
  reviewStatus: "RECORDED",
};

const mapped = toExpense(casualDto);
expect("4: casual type preserved", mapped.expenseType, EXPENSE_TYPE.CASUAL);
expect("4: decimal strings parsed", [mapped.amountBeforeVat, mapped.vatAmount, mapped.amount], [500, 0, 500]);
expect("4: ISO date converted to epoch ms", mapped.date, Date.parse("2026-10-18T00:00:00.000Z"));
expect("4: nullable optional fields become undefined", [mapped.bank, mapped.category, mapped.invoiceAttachment], [undefined, undefined, undefined]);
expect("4: optional strings trimmed", mapped.remark, "site visit");
expect("4: source and status preserved", [mapped.expenseSource, mapped.reviewStatus], ["FINANCE", "RECORDED"]);

await expectError(
  "4: malformed date is rejected, not rendered",
  async () => toExpense({ ...casualDto, expenseDate: "not-a-date" }),
  (error) => error instanceof ApiError && error.kind === "parse",
  "parse",
);

const writeDto = toExpenseWriteDto({
  item: "Taxi fare",
  category: "Fuel & Transport",
  expenseType: EXPENSE_TYPE.CASUAL,
  amountBeforeVat: 500,
  whtEnabled: false,
  date: Date.parse("2026-10-18T00:00:00.000Z"),
});
expect("4: write DTO uses ISO date", writeDto.expenseDate, "2026-10-18T00:00:00.000Z");
expect("4: write DTO sends classification", writeDto.expenseType, "CASUAL");
expect("4: optional casual payment fields are null, not invented", [writeDto.bank, writeDto.paymentReference, writeDto.invoiceAttachment], [null, null, null]);

const patch = toExpenseUpdateDto({ remark: "corrected" });
expect("4: PATCH sends only provided fields", Object.keys(patch), ["remark"]);
const clearBank = toExpenseUpdateDto({ bank: "" });
expect("4: clearing a field sends null", clearBank.bank, null);

/* ------------------------------------------------------------------ */
/* 5. REST expense adapter paths                                       */
/* ------------------------------------------------------------------ */

console.log("\n5 — REST expense adapter endpoints");
const adapterRequests: CapturedRequest[] = [];
const adapterClient = new ApiClient({
  baseUrl: "https://api.test",
  fetchImpl: capturingFetch((request) => {
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    if (request.url.includes("/expenses/missing")) {
      return jsonResponse({ message: "Not found" }, 404);
    }
    if (request.url.includes("/reject")) {
      return jsonResponse({ data: { ...casualDto, reviewStatus: "REJECTED" } });
    }
    if (
      request.method === "GET" &&
      (request.url.includes("/expenses?") || request.url.endsWith("/expenses"))
    ) {
      return jsonResponse({ data: [casualDto] });
    }
    return jsonResponse({ data: { ...casualDto, item: "Taxi fare" } });
  }, adapterRequests),
});
const rest = createRestExpensesRepository(adapterClient);

expect("5: list maps DTOs to domain records", (await rest.getFinanceExpenses())[0].expenseType, EXPENSE_TYPE.CASUAL);
expect("5: source filter is sent as a query", adapterRequests[0].url, "https://api.test/expenses?source=FINANCE");

const created = await rest.createExpense(
  {
    item: "Taxi fare",
    category: "Fuel & Transport",
    expenseType: EXPENSE_TYPE.CASUAL,
    amountBeforeVat: 500,
    whtEnabled: false,
    date: Date.parse("2026-10-18T00:00:00.000Z"),
  },
  "finance@company.com",
);
expect("5: create posts to /expenses", adapterRequests.at(-1)?.url, "https://api.test/expenses");
expect("5: actor identity is not trusted/sent by the adapter", adapterRequests.at(-1)?.body?.includes("finance@company.com"), false);
expect("5: created record parsed from response", created.id, "exp-1");

const rejected = await rest.rejectAdminExpense("exp-1", "Missing receipt", "finance@company.com");
expect("5: reject posts a reason", JSON.parse(adapterRequests.at(-1)?.body ?? "{}"), { reason: "Missing receipt" });
expect("5: review status mapped", rejected.reviewStatus, "REJECTED");

expect("5: 404 lookup returns null", await rest.getExpenseById("missing"), null);
await rest.deleteExpense("exp-1");
expect("5: delete returns void", adapterRequests.at(-1)?.method, "DELETE");

configureApiAuth({ getAccessToken: () => null });

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
