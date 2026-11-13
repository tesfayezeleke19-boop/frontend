/**
 * REST adapter for Expenses — the reference implementation for the future
 * PHP / Django backend.
 *
 * STATUS: implemented against the PROPOSED contract in
 * docs/api-contracts.md; it has NOT been exercised against a live backend.
 * It is NOT the active data source. The running application still uses
 * `expensesRepository` from `@/services/finance/expenses` (browser storage
 * until the backend replaces it). Do not present this adapter as
 * production-ready until the endpoints exist and are verified.
 *
 * What the adapter owns:
 *   - endpoint paths (centralized here, never in pages)
 *   - DTO <-> domain mapping (expenseDto.ts)
 *   - server error propagation as typed ApiError
 *
 * What it deliberately does NOT do:
 *   - replicate role authorization (the backend is the security boundary;
 *     the caller's actor argument is informational and is not sent)
 *   - invent bank details, references, or attachments
 *   - fall back to mock/local data when a request fails
 *
 * Attachments: `ExpenseAttachment` metadata is sent with the expense. The
 * upload endpoint itself is still an open backend decision (multipart vs
 * signed URL); see docs/backend-integration.md.
 */
import { ApiClient } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type {
  ApiExpenseDto,
  ApiExpenseListQuery,
  ApiExpenseReviewSummaryDto,
  MoneyDto,
} from "@/lib/api/types";
import {
  isExpenseCounted,
  type ExpensesRepository,
} from "@/services/finance/expenses";
import type {
  Expense,
  ExpenseInput,
  ExpenseSource,
} from "@/services/finance/types";
import {
  toExpense,
  toExpenseUpdateDto,
  toExpenseWriteDto,
} from "./expenseDto";

const EXPENSES_PATH = "/expenses";
const ADMIN_DRAFTS_PATH = "/expenses/admin-drafts";
const REVIEW_SUMMARY_PATH = "/expenses/review-summary";

function expensePath(id: string, suffix = ""): string {
  return `${EXPENSES_PATH}/${encodeURIComponent(id)}${suffix}`;
}

function money(value: MoneyDto | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toQuery(query: ApiExpenseListQuery): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  if (query.source) result.source = query.source;
  if (query.status) result.status = query.status;
  if (query.expenseType) result.expenseType = query.expenseType;
  if (query.from) result.from = query.from;
  if (query.to) result.to = query.to;
  if (query.search) result.search = query.search;
  if (query.page) result.page = query.page;
  if (query.perPage) result.perPage = query.perPage;
  return result;
}

export class RestExpensesRepository implements ExpensesRepository {
  private readonly client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  private async list(query: ApiExpenseListQuery = {}): Promise<Expense[]> {
    const rows = await this.client.get<ApiExpenseDto[]>(EXPENSES_PATH, {
      query: toQuery(query),
    });
    return rows.map(toExpense);
  }

  async getExpenses(): Promise<Expense[]> {
    return this.list();
  }

  async getExpenseById(id: string): Promise<Expense | null> {
    try {
      return toExpense(await this.client.get<ApiExpenseDto>(expensePath(id)));
    } catch (error) {
      if (isApiError(error) && error.status === 404) return null;
      throw error;
    }
  }

  async getFinanceExpenses(): Promise<Expense[]> {
    return this.list({ source: "FINANCE" satisfies ExpenseSource });
  }

  async getAdminExpenses(): Promise<Expense[]> {
    return this.list({ source: "ADMIN" satisfies ExpenseSource });
  }

  async getFinanceReviewQueue(): Promise<Expense[]> {
    return this.list({
      source: "ADMIN",
      status: "PENDING_FINANCE_REVIEW",
    });
  }

  async getLegacyExpenses(): Promise<Expense[]> {
    return this.list({ source: "LEGACY" });
  }

  isExpenseCounted(expense: Expense): boolean {
    // Aggregation policy is a shared domain rule, not a transport concern.
    return isExpenseCounted(expense);
  }

  async getExpenseReviewSummary(): Promise<{
    pendingReview: number;
    pendingAmount: number;
    approved: number;
    rejected: number;
    drafts: number;
  }> {
    const summary = await this.client.get<ApiExpenseReviewSummaryDto>(
      REVIEW_SUMMARY_PATH,
    );
    return {
      pendingReview: summary.pendingReview,
      pendingAmount: money(summary.pendingAmount),
      approved: summary.approved,
      rejected: summary.rejected,
      drafts: summary.drafts,
    };
  }

  async createExpense(input: ExpenseInput): Promise<Expense> {
    const created = await this.client.post<ApiExpenseDto>(
      EXPENSES_PATH,
      toExpenseWriteDto(input),
    );
    return toExpense(created);
  }

  async createAdminExpense(input: ExpenseInput): Promise<Expense> {
    const created = await this.client.post<ApiExpenseDto>(
      ADMIN_DRAFTS_PATH,
      toExpenseWriteDto(input),
    );
    return toExpense(created);
  }

  async updateExpense(
    id: string,
    input: Partial<ExpenseInput>,
  ): Promise<Expense> {
    const updated = await this.client.patch<ApiExpenseDto>(
      expensePath(id),
      toExpenseUpdateDto(input),
    );
    return toExpense(updated);
  }

  async updateAdminExpense(
    id: string,
    input: Partial<ExpenseInput>,
  ): Promise<Expense> {
    const updated = await this.client.patch<ApiExpenseDto>(
      expensePath(id, "/admin-draft"),
      toExpenseUpdateDto(input),
    );
    return toExpense(updated);
  }

  async submitAdminExpense(id: string): Promise<Expense> {
    return toExpense(
      await this.client.post<ApiExpenseDto>(expensePath(id, "/submit")),
    );
  }

  async approveAdminExpense(id: string): Promise<Expense> {
    return toExpense(
      await this.client.post<ApiExpenseDto>(expensePath(id, "/approve")),
    );
  }

  async rejectAdminExpense(
    id: string,
    reason: string,
  ): Promise<Expense> {
    return toExpense(
      await this.client.post<ApiExpenseDto>(expensePath(id, "/reject"), {
        reason,
      }),
    );
  }

  async deleteExpense(id: string): Promise<void> {
    await this.client.delete(expensePath(id));
  }

  /**
   * REST has no push channel agreed yet. Mutations already refresh through
   * the feature hooks after they resolve; a future realtime strategy
   * (websocket/SSE/polling) belongs here. This is intentionally a no-op, not
   * a hidden polling loop.
   */
  subscribe(): () => void {
    return () => {};
  }
}

/** Construct the REST repository around an explicitly configured client. */
export function createRestExpensesRepository(
  client: ApiClient,
): ExpensesRepository {
  return new RestExpensesRepository(client);
}
