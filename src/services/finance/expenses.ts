/**
 * Expenses repository — TWO separate expense workflows on the SAME record
 * infrastructure (never duplicated records):
 *
 *   Workflow A — Finance-owned (`expenseSource: FINANCE`)
 *     Finance creates and manages its own expenses directly. They are
 *     valid records immediately after being saved — no Admin approval, no
 *     submission step, and they never appear in any Admin queue.
 *
 *   Workflow B — Admin-originated (`expenseSource: ADMIN`)
 *     Admin creates expenses initiated by management, saves drafts, and
 *     submits them for Finance review:
 *       DRAFT → PENDING_FINANCE_REVIEW → APPROVED   (or → REJECTED)
 *     Rejected records can be corrected by their Admin creator and
 *     resubmitted — the SAME record ID, with status history.
 *
 * The old Finance → Admin payment lifecycle (PENDING_PAYMENT / Mark Done)
 * is REMOVED. Its statuses survive only as historical meaning on legacy
 * records, which are never relabelled as approved.
 *
 * `expenseSource` is canonical ownership assigned HERE from the
 * authenticated session's role — never a form choice, never changed by a
 * review. Authorization is enforced in this trusted data layer: privileged
 * writes require an authenticated, active, non-guest session with the
 * right role. Payment/review status never feeds money formulas — amounts
 * stay exclusively in the calculation engine (expenseCalculations.ts).
 */
import { financeApi, adminExpensesApi } from "./api";
import {
  loadExpenses,
  notifyFinanceChanged,
  persistExpenses,
  subscribeFinance,
} from "./storage";
import { calculateExpenseTotals } from "./expenseCalculations";
import { validateExpenseFields } from "./expenseValidation";
import { normalizeNumber, roundMoney } from "../sales/calc";
import { authRepository } from "../auth/authRepository";
import { USER_ROLES } from "../auth/types";
import { DEV_USERS } from "../auth/mockUsers";
import {
  EXPENSE_PAYMENT_STATUS,
  EXPENSE_REVIEW_STATUS,
  EXPENSE_SOURCE,
  EXPENSE_TYPE,
  expenseTypeOf,
  type Expense,
  type ExpenseInput,
  type ExpenseSource,
  type ExpenseStatusHistoryEntry,
  type ExpenseType,
} from "./types";

/* ------------------------------------------------------------------ */
/* Audit trail                                                         */
/* ------------------------------------------------------------------ */

export interface ExpenseAuditEntry {
  id: string;
  expenseId: string;
  action:
    | "CREATED"
    | "DRAFT_UPDATED"
    | "SUBMITTED"
    | "APPROVED"
    | "REJECTED"
    | "DELETED";
  /** Acting user (email/name from the session when available). */
  actor?: string;
  at: number;
  /** Status transition details — no secrets logged. */
  details?: string;
}

const AUDIT_KEY = "nexerp.finance.expenseAudit.v1";

function readAudit(): ExpenseAuditEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(AUDIT_KEY);
    return raw ? (JSON.parse(raw) as ExpenseAuditEntry[]) : [];
  } catch {
    return [];
  }
}

function appendAudit(entry: ExpenseAuditEntry): void {
  try {
    if (typeof localStorage === "undefined") return;
    const all = [...readAudit(), entry];
    localStorage.setItem(AUDIT_KEY, JSON.stringify(all));
  } catch {
    // Audit is best-effort in this persistence layer.
  }
}

export function getExpenseAuditLog(expenseId?: string): ExpenseAuditEntry[] {
  const all = readAudit();
  return expenseId
    ? all.filter((e) => e.expenseId === expenseId)
    : all.sort((a, b) => b.at - a.at);
}

/* ------------------------------------------------------------------ */
/* Authorization helpers                                               */
/* ------------------------------------------------------------------ */

export class ExpensePermissionError extends Error {}

interface Caller {
  id: string;
  name: string;
  role: string;
}

function requireCaller(role: "FINANCE" | "ADMIN", action: string): Caller {
  const session = authRepository.getSession();
  if (!session || session.isGuest) {
    throw new ExpensePermissionError(
      `Sign in as ${role === "ADMIN" ? "Admin" : "Finance"} to ${action}.`,
    );
  }
  if (session.user.accountStatus === "DISABLED") {
    throw new ExpensePermissionError(
      "This account is disabled. Contact an administrator.",
    );
  }
  const required = role === "ADMIN" ? USER_ROLES.ADMIN : USER_ROLES.FINANCE;
  if (session.user.role !== required) {
    throw new ExpensePermissionError(
      role === "ADMIN"
        ? "Only Admin can create, edit, or submit its own expenses."
        : "Only Finance can record, edit, and review expenses.",
    );
  }
  return {
    id: session.user.id,
    name: session.user.email || session.user.name || "User",
    role: session.user.role,
  };
}

function actorFromSession(): string | undefined {
  const session = authRepository.getSession();
  return session?.user.email || session?.user.name || undefined;
}

/* ------------------------------------------------------------------ */
/* Ownership inference (idempotent legacy migration)                   */
/* ------------------------------------------------------------------ */

/** Role of a stored creator identity, when it maps to a known account. */
function roleForIdentity(identity?: string): string | null {
  if (!identity) return null;
  const normalized = identity.trim().toLowerCase();
  if (!normalized) return null;
  const known = DEV_USERS.find((u) => u.email.toLowerCase() === normalized);
  return known?.role ?? null;
}

/**
 * Legacy records could only be created through the old Finance-gated
 * `createExpense`, so a creator whose role can still be resolved as a
 * Finance user is safely a Finance-owned record. Anything else — unknown
 * or contradictory creator identities — stays LEGACY rather than having
 * its ownership invented.
 */
function inferLegacySource(expense: Expense): ExpenseSource {
  if (expense.expenseSource) return expense.expenseSource;
  const creatorRole = roleForIdentity(expense.createdBy);
  if (creatorRole === USER_ROLES.FINANCE) return EXPENSE_SOURCE.FINANCE;
  return EXPENSE_SOURCE.LEGACY;
}

/** Canonical ownership of a stored record (LEGACY when unset/unresolvable). */
export function expenseSourceOf(expense: Expense): ExpenseSource {
  return expense.expenseSource ?? inferLegacySource(expense);
}

/**
 * THE canonical aggregation rule — a record is counted in the approved
 * expense totals exactly once, based on ownership:
 *   FINANCE → counted (valid without Admin approval, existing policy)
 *   LEGACY  → counted (old accounting policy: all recorded expenses counted;
 *             ownership ambiguity is therefore never double-counted)
 *   ADMIN   → counted only when Finance APPROVED it — Draft, Pending
 *             Finance Review, and Rejected Admin expenses are excluded.
 */
export function isExpenseCounted(expense: Expense): boolean {
  const source = expenseSourceOf(expense);
  if (source === EXPENSE_SOURCE.ADMIN) {
    return expense.reviewStatus === EXPENSE_REVIEW_STATUS.APPROVED;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Validation for submission                                           */
/* ------------------------------------------------------------------ */

export interface ExpenseSubmitValidation {
  valid: boolean;
  errors: Record<string, string>;
}

/**
 * Submission validation — required fields plus the attachment rules. Kept
 * in the repository so a draft cannot slip into the Finance review queue
 * through any path, not just through the Admin form. Casual expenses skip
 * the bank and payment-evidence requirements (see expenseValidation.ts).
 */
export function validateExpenseForSubmission(
  expense: Expense,
): ExpenseSubmitValidation {
  const errors = validateExpenseFields(expense);
  return { valid: Object.keys(errors).length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

/**
 * Shape a persisted expense from input — all derived money comes from the
 * central engine, never from hand-typed totals. Legacy fields (amount =
 * before-VAT on old records) upgrade cleanly: old records keep their stored
 * amount as the accounting expense amount and get explicit breakdown values.
 */
function buildExpense(input: Partial<ExpenseInput>, base?: Expense): {
  expenseType: ExpenseType;
  amount: number;
  amountBeforeVat: number;
  vatAmount: number;
  whtEnabled: boolean;
  whtAmount: number;
  totalTransferred: number;
} {
  const expenseType =
    input.expenseType ?? (base ? expenseTypeOf(base) : EXPENSE_TYPE.STANDARD);
  const whtEnabled = input.whtEnabled ?? base?.whtEnabled ?? false;
  // New records enter amountBeforeVat; legacy edits preserve their stored
  // before-VAT value. A record with no before-VAT treats `amount` (legacy
  // semantics) as VAT-exclusive so nothing changes for old data unless edited.
  const amountBeforeVat = roundMoney(
    normalizeNumber(
      input.amountBeforeVat ?? base?.amountBeforeVat ?? input.amount ?? 0,
    ),
  );
  // VAT is computed only for STANDARD expenses. CASUAL expenses are
  // explicitly not subject to VAT in this system — this is never inferred
  // from an empty field.
  const totals = calculateExpenseTotals({
    amountBeforeVat,
    vatApplicable: expenseType === EXPENSE_TYPE.STANDARD,
    whtEnabled,
  });
  return {
    expenseType,
    amount: totals.totalAfterVat,
    amountBeforeVat: totals.amountBeforeVat,
    vatAmount: totals.vatAmount,
    whtEnabled,
    whtAmount: totals.whtAmount,
    totalTransferred: totals.totalTransferred,
  };
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `exp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ExpensesRepository {
  getExpenses(): Promise<Expense[]>;
  getExpenseById(id: string): Promise<Expense | null>;
  /** Workflow A — Finance-owned expenses. */
  getFinanceExpenses(): Promise<Expense[]>;
  /** Workflow B — Admin-originated expenses (all review statuses). */
  getAdminExpenses(): Promise<Expense[]>;
  /** Finance review queue: Admin expenses awaiting Finance review. */
  getFinanceReviewQueue(): Promise<Expense[]>;
  /** Records whose ownership could not be safely established. */
  getLegacyExpenses(): Promise<Expense[]>;
  /** Canonical aggregation rule for financial reports. */
  isExpenseCounted(expense: Expense): boolean;
  /** Counts + pending amount for dashboards. */
  getExpenseReviewSummary(): Promise<{
    pendingReview: number;
    pendingAmount: number;
    approved: number;
    rejected: number;
    drafts: number;
  }>;
  /** Workflow A — Finance records its own expense directly. */
  createExpense(input: ExpenseInput, actor?: string): Promise<Expense>;
  /** Workflow B — Admin creates an expense draft or record. */
  createAdminExpense(input: ExpenseInput, actor?: string): Promise<Expense>;
  /** Finance edits a Finance-owned record (management, no approval path). */
  updateExpense(
    id: string,
    input: Partial<ExpenseInput>,
    actor?: string,
  ): Promise<Expense>;
  /** Admin edits its own draft or rejected expense (same record/ID). */
  updateAdminExpense(
    id: string,
    input: Partial<ExpenseInput>,
    actor?: string,
  ): Promise<Expense>;
  /** Admin submits a draft (or resubmits a rejected record) to Finance. */
  submitAdminExpense(id: string, actor?: string): Promise<Expense>;
  /** Finance approves a pending Admin expense. */
  approveAdminExpense(id: string, actor?: string): Promise<Expense>;
  /** Finance rejects a pending Admin expense — reason is required. */
  rejectAdminExpense(
    id: string,
    reason: string,
    actor?: string,
  ): Promise<Expense>;
  deleteExpense(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export class LocalExpensesRepository implements ExpensesRepository {
  /**
   * Idempotent migration: each record gains its canonical `expenseSource`
   * (owner inferred from the creator where possible, otherwise LEGACY).
   * Legacy statuses and payment info are preserved untouched — nothing is
   * deleted, relabelled as approved, or duplicated. Safe to run again.
   */
  private loadMigrated(): Expense[] {
    const stored = loadExpenses();
    let needsPersist = false;
    const migrated = stored.map((expense) => {
      let next = expense;
      if (!next.expenseSource) {
        next = { ...next, expenseSource: inferLegacySource(next) };
        needsPersist = true;
      }
      if (
        !next.paymentStatus &&
        !next.reviewStatus &&
        next.expenseSource !== EXPENSE_SOURCE.FINANCE
      ) {
        // Pre-lifecycle historical record — flagged for review under its
        // historical meaning, never relabelled as paid or approved.
        next = { ...next, paymentStatus: EXPENSE_PAYMENT_STATUS.UNVERIFIED };
        needsPersist = true;
      }
      return next;
    });
    if (needsPersist) persistExpenses(migrated);
    return migrated;
  }

  async getExpenses(): Promise<Expense[]> {
    return this.loadMigrated().sort((a, b) => b.date - a.date);
  }

  async getExpenseById(id: string): Promise<Expense | null> {
    return this.loadMigrated().find((e) => e.id === id) ?? null;
  }

  async getFinanceExpenses(): Promise<Expense[]> {
    return this.loadMigrated()
      .filter((e) => expenseSourceOf(e) === EXPENSE_SOURCE.FINANCE)
      .sort((a, b) => b.date - a.date);
  }

  async getAdminExpenses(): Promise<Expense[]> {
    return this.loadMigrated()
      .filter((e) => expenseSourceOf(e) === EXPENSE_SOURCE.ADMIN)
      .sort(
        (a, b) =>
          (b.submittedAt ?? b.updatedAt ?? b.date) -
          (a.submittedAt ?? a.updatedAt ?? a.date),
      );
  }

  /** Only Admin-originated expenses awaiting Finance review — never any
   *  Finance-owned record (those do not enter a review queue). */
  async getFinanceReviewQueue(): Promise<Expense[]> {
    return this.loadMigrated()
      .filter(
        (e) =>
          expenseSourceOf(e) === EXPENSE_SOURCE.ADMIN &&
          e.reviewStatus === EXPENSE_REVIEW_STATUS.PENDING_FINANCE_REVIEW,
      )
      .sort((a, b) => (a.submittedAt ?? a.date) - (b.submittedAt ?? b.date));
  }

  async getLegacyExpenses(): Promise<Expense[]> {
    return this.loadMigrated()
      .filter((e) => expenseSourceOf(e) === EXPENSE_SOURCE.LEGACY)
      .sort((a, b) => b.date - a.date);
  }

  isExpenseCounted(expense: Expense): boolean {
    return isExpenseCounted(expense);
  }

  async getExpenseReviewSummary(): Promise<{
    pendingReview: number;
    pendingAmount: number;
    approved: number;
    rejected: number;
    drafts: number;
  }> {
    const adminExpenses = await this.getAdminExpenses();
    const pending = adminExpenses.filter(
      (e) => e.reviewStatus === EXPENSE_REVIEW_STATUS.PENDING_FINANCE_REVIEW,
    );
    return {
      pendingReview: pending.length,
      pendingAmount: roundMoney(
        pending.reduce(
          (s, e) => s + (Number.isFinite(e.amount) ? e.amount : 0),
          0,
        ),
      ),
      approved: adminExpenses.filter(
        (e) => e.reviewStatus === EXPENSE_REVIEW_STATUS.APPROVED,
      ).length,
      rejected: adminExpenses.filter(
        (e) => e.reviewStatus === EXPENSE_REVIEW_STATUS.REJECTED,
      ).length,
      drafts: adminExpenses.filter(
        (e) => e.reviewStatus === EXPENSE_REVIEW_STATUS.DRAFT,
      ).length,
    };
  }

  private insert(
    expense: Expense,
    actor?: string,
    action: ExpenseAuditEntry["action"] = "CREATED",
    details?: string,
  ): Expense {
    const expenses = loadExpenses();
    persistExpenses([expense, ...expenses]);
    appendAudit({
      id: createId(),
      expenseId: expense.id,
      action,
      actor: actor ?? actorFromSession(),
      at: expense.createdAt,
      details,
    });
    notifyFinanceChanged();
    return expense;
  }

  /**
   * Workflow A — Finance records an expense. The record is valid
   * immediately (RECORDED): no Admin approval, no submission, no queue.
   */
  async createExpense(input: ExpenseInput, actor?: string): Promise<Expense> {
    const caller = requireCaller("FINANCE", "record expenses");
    const now = Date.now();
    const money = buildExpense(input);
    const expense: Expense = {
      id: createId(),
      item: input.item,
      category: input.category,
      expenseType: money.expenseType,
      amountBeforeVat: money.amountBeforeVat,
      vatAmount: money.vatAmount,
      whtEnabled: money.whtEnabled,
      whtAmount: money.whtAmount,
      totalTransferred: money.totalTransferred,
      amount: money.amount,
      bank: input.bank,
      paymentReference: input.paymentReference,
      paymentParty: input.paymentParty,
      invoiceAttachment: input.invoiceAttachment,
      whtAttachment: input.whtAttachment,
      remark: input.remark,
      date: input.date,
      expenseSource: EXPENSE_SOURCE.FINANCE,
      reviewStatus: EXPENSE_REVIEW_STATUS.RECORDED,
      statusHistory: [
        {
          status: EXPENSE_REVIEW_STATUS.RECORDED,
          at: now,
          actor: actor ?? caller.name,
          note: "Recorded by Finance",
        },
      ],
      createdBy: actor ?? actorFromSession(),
      createdAt: now,
      updatedAt: now,
    };
    return this.insert(expense, actor ?? caller.name, "CREATED", "Recorded directly by Finance");
  }

  /**
   * Workflow B — Admin creates an expense record. Saved as DRAFT: it is
   * never sent to Finance until Admin explicitly submits it.
   */
  async createAdminExpense(input: ExpenseInput, actor?: string): Promise<Expense> {
    const caller = requireCaller("ADMIN", "create Admin expenses");
    const now = Date.now();
    const money = buildExpense(input);
    const expense: Expense = {
      id: createId(),
      item: input.item,
      category: input.category,
      expenseType: money.expenseType,
      amountBeforeVat: money.amountBeforeVat,
      vatAmount: money.vatAmount,
      whtEnabled: money.whtEnabled,
      whtAmount: money.whtAmount,
      totalTransferred: money.totalTransferred,
      amount: money.amount,
      bank: input.bank,
      paymentReference: input.paymentReference,
      paymentParty: input.paymentParty,
      invoiceAttachment: input.invoiceAttachment,
      whtAttachment: input.whtAttachment,
      remark: input.remark,
      date: input.date,
      expenseSource: EXPENSE_SOURCE.ADMIN,
      reviewStatus: EXPENSE_REVIEW_STATUS.DRAFT,
      statusHistory: [
        {
          status: EXPENSE_REVIEW_STATUS.DRAFT,
          at: now,
          actor: actor ?? caller.name,
          note: "Saved as draft by Admin",
        },
      ],
      createdBy: actor ?? actorFromSession(),
      createdAt: now,
      updatedAt: now,
    };
    return this.insert(expense, actor ?? caller.name, "CREATED", "Saved as Admin draft");
  }

  /** Apply editable field updates without touching ownership/status. */
  private applyFieldUpdates(
    existing: Expense,
    input: Partial<ExpenseInput>,
  ): Expense {
    const money = buildExpense(input, existing);
    return {
      ...existing,
      item: input.item ?? existing.item,
      category: input.category !== undefined ? input.category : existing.category,
      expenseType: money.expenseType,
      amountBeforeVat: money.amountBeforeVat,
      vatAmount: money.vatAmount,
      whtEnabled: money.whtEnabled,
      whtAmount: money.whtAmount,
      totalTransferred: money.totalTransferred,
      amount: money.amount,
      bank: input.bank !== undefined ? input.bank : existing.bank,
      paymentReference:
        input.paymentReference !== undefined
          ? input.paymentReference
          : existing.paymentReference,
      paymentParty:
        input.paymentParty !== undefined
          ? input.paymentParty
          : existing.paymentParty,
      invoiceAttachment:
        input.invoiceAttachment !== undefined
          ? input.invoiceAttachment
          : existing.invoiceAttachment,
      whtAttachment:
        input.whtAttachment !== undefined
          ? input.whtAttachment
          : existing.whtAttachment,
      remark: input.remark !== undefined ? input.remark : existing.remark,
      date: input.date ?? existing.date,
      updatedAt: Date.now(),
    };
  }

  private updateById(id: string, next: Expense): void {
    const expenses = loadExpenses();
    const idx = expenses.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error("Expense not found");
    expenses[idx] = next;
    persistExpenses(expenses);
    notifyFinanceChanged();
  }

  /**
   * Finance edits its own records — direct reps, no approval path. Finance
   * can NEVER rewrite another workflow's records: editing is rejected for
   * ADMIN-owned expenses, and ownership is never altered here.
   */
  async updateExpense(
    id: string,
    input: Partial<ExpenseInput>,
    actor?: string,
  ): Promise<Expense> {
    const caller = requireCaller("FINANCE", "edit expenses");
    const expenses = this.loadMigrated();
    const existing = expenses.find((e) => e.id === id);
    if (!existing) throw new Error("Expense not found");
    const source = expenseSourceOf(existing);
    if (source === EXPENSE_SOURCE.ADMIN) {
      throw new ExpensePermissionError(
        "This expense belongs to the Admin workflow — Finance reviews it, it cannot be edited here.",
      );
    }
    if (source === EXPENSE_SOURCE.LEGACY && existing.paymentStatus !== EXPENSE_PAYMENT_STATUS.DRAFT) {
      throw new ExpensePermissionError(
        "Only legacy draft expenses can be edited — historical records keep their original values.",
      );
    }
    const updated = {
      ...this.applyFieldUpdates(existing, input),
      createdBy: actor ?? caller.name,
    };
    this.updateById(id, updated);
    appendAudit({
      id: createId(),
      expenseId: id,
      action: "DRAFT_UPDATED",
      actor: actor ?? actorFromSession(),
      at: Date.now(),
    });
    notifyFinanceChanged();
    return updated;
  }

  /**
   * Admin edits its own DRAFT or REJECTED record — same ID, append-only
   * history. Pending or approved records are frozen while Finance reviews.
   */
  async updateAdminExpense(
    id: string,
    input: Partial<ExpenseInput>,
    actor?: string,
  ): Promise<Expense> {
    const caller = requireCaller("ADMIN", "edit Admin expenses");
    const expenses = this.loadMigrated();
    const existing = expenses.find((e) => e.id === id);
    if (!existing) throw new Error("Expense not found");
    if (expenseSourceOf(existing) !== EXPENSE_SOURCE.ADMIN) {
      throw new ExpensePermissionError(
        "Only expenses created through the Admin workflow can be edited here.",
      );
    }
    if (
      existing.reviewStatus !== EXPENSE_REVIEW_STATUS.DRAFT &&
      existing.reviewStatus !== EXPENSE_REVIEW_STATUS.REJECTED
    ) {
      throw new Error(
        "Pending and approved expenses cannot be edited while Finance reviews them.",
      );
    }
    // Drafts stay editable by their authorized Admin creator.
    if (
      existing.createdBy &&
      existing.createdBy.trim().toLowerCase() !== caller.name.trim().toLowerCase()
    ) {
      throw new ExpensePermissionError(
        "Only the Admin creator of this expense can edit it.",
      );
    }
    const history: ExpenseStatusHistoryEntry[] = [
      ...(existing.statusHistory ?? []),
    ];
    if (existing.reviewStatus === EXPENSE_REVIEW_STATUS.REJECTED) {
      // Back to draft so it can be corrected and resubmitted explicitly.
      history.push({
        status: EXPENSE_REVIEW_STATUS.DRAFT,
        at: Date.now(),
        actor: actor ?? caller.name,
        note: "Reopened for correction after rejection",
      });
    }
    const updated: Expense = {
      ...this.applyFieldUpdates(existing, input),
      reviewStatus: EXPENSE_REVIEW_STATUS.DRAFT,
      rejectionReason: undefined,
      reviewedBy: undefined,
      reviewedAt: undefined,
      statusHistory: history,
    };
    this.updateById(id, updated);
    appendAudit({
      id: createId(),
      expenseId: id,
      action: "DRAFT_UPDATED",
      actor: actor ?? actorFromSession(),
      at: Date.now(),
      details: existing.reviewStatus === EXPENSE_REVIEW_STATUS.REJECTED
        ? "Reopened after rejection"
        : undefined,
    });
    notifyFinanceChanged();
    return updated;
  }

  /**
   * Admin submits a draft (or resubmits a rejected record) for Finance
   * review. Validates all required fields and attachments; the same record
   * ID is preserved and the submission is recorded in the status history.
   */
  async submitAdminExpense(id: string, actor?: string): Promise<Expense> {
    const caller = requireCaller("ADMIN", "submit expenses for Finance review");
    const expenses = this.loadMigrated();
    const existing = expenses.find((e) => e.id === id);
    if (!existing) throw new Error("Expense not found");
    if (expenseSourceOf(existing) !== EXPENSE_SOURCE.ADMIN) {
      throw new ExpensePermissionError(
        "Only Admin workflow expenses can be submitted for Finance review.",
      );
    }
    if (existing.reviewStatus === EXPENSE_REVIEW_STATUS.PENDING_FINANCE_REVIEW) {
      throw new Error("This expense is already pending Finance review.");
    }
    if (existing.reviewStatus === EXPENSE_REVIEW_STATUS.APPROVED) {
      throw new Error("This expense is already approved — it cannot be resubmitted.");
    }
    if (
      existing.reviewStatus !== EXPENSE_REVIEW_STATUS.DRAFT &&
      existing.reviewStatus !== EXPENSE_REVIEW_STATUS.REJECTED
    ) {
      throw new Error("Only draft or rejected expenses can be submitted.");
    }
    // Drafts/rejections may be submitted by their creator (validated above
    // for edits); submission itself allows any Admin with the identity of
    // the stored creator to keep demo data smooth — enforce owner when stored.
    if (
      existing.createdBy &&
      existing.createdBy.trim().toLowerCase() !== caller.name.trim().toLowerCase()
    ) {
      throw new ExpensePermissionError(
        "Only the Admin creator of this expense can submit it for review.",
      );
    }

    const validation = validateExpenseForSubmission(existing);
    if (!validation.valid) {
      throw new Error(
        `Cannot submit — incomplete record: ${Object.values(validation.errors)[0]}`,
      );
    }

    const now = Date.now();
    const resubmission =
      existing.reviewStatus === EXPENSE_REVIEW_STATUS.REJECTED;
    const updated: Expense = {
      ...existing,
      reviewStatus: EXPENSE_REVIEW_STATUS.PENDING_FINANCE_REVIEW,
      rejectionReason: undefined,
      submittedAt: now,
      submittedBy: actor ?? caller.name,
      statusHistory: [
        ...(existing.statusHistory ?? []),
        {
          status: EXPENSE_REVIEW_STATUS.PENDING_FINANCE_REVIEW,
          at: now,
          actor: actor ?? caller.name,
          note: resubmission ? "Resubmitted to Finance review" : "Submitted to Finance review",
        },
      ],
      updatedAt: now,
    };
    this.updateById(id, updated);
    appendAudit({
      id: createId(),
      expenseId: id,
      action: "SUBMITTED",
      actor: actor ?? actorFromSession(),
      at: now,
      details: resubmission ? "Resubmitted to Finance review" : "Submitted to Finance review",
    });
    notifyFinanceChanged();
    return updated;
  }

  /** Shared transition body for Finance approve/reject. */
  private async applyReview(
    id: string,
    target: typeof EXPENSE_REVIEW_STATUS.APPROVED | typeof EXPENSE_REVIEW_STATUS.REJECTED,
    reason: string | undefined,
    note: string,
    actor?: string,
  ): Promise<Expense> {
    const caller = requireCaller("FINANCE", "review Admin expenses");
    if (target === EXPENSE_REVIEW_STATUS.REJECTED) {
      if (!reason || !reason.trim()) {
        throw new Error("A rejection reason is required.");
      }
    }
    const expenses = this.loadMigrated();
    const existing = expenses.find((e) => e.id === id);
    if (!existing) throw new Error("Expense not found");
    if (expenseSourceOf(existing) !== EXPENSE_SOURCE.ADMIN) {
      throw new ExpensePermissionError(
        "Finance-owned and legacy expenses do not enter the review workflow.",
      );
    }
    if (existing.reviewStatus !== EXPENSE_REVIEW_STATUS.PENDING_FINANCE_REVIEW) {
      throw new Error(
        existing.reviewStatus === EXPENSE_REVIEW_STATUS.APPROVED
          ? "This expense is already approved."
          : "Only expenses pending Finance review can be approved or rejected.",
      );
    }

    const now = Date.now();
    const history: ExpenseStatusHistoryEntry[] = [
      ...(existing.statusHistory ?? []),
      {
        status: target,
        at: now,
        actor: actor ?? caller.name,
        note:
          target === EXPENSE_REVIEW_STATUS.REJECTED
            ? `Rejected: ${reason?.trim()}`
            : note,
      },
    ];
    const updated: Expense = {
      ...existing,
      reviewStatus: target,
      reviewedBy: actor ?? caller.name,
      reviewedAt: now,
      rejectionReason:
        target === EXPENSE_REVIEW_STATUS.REJECTED ? reason!.trim() : undefined,
      statusHistory: history,
      updatedAt: now,
    };
    this.updateById(id, updated);
    appendAudit({
      id: createId(),
      expenseId: id,
      action: target === EXPENSE_REVIEW_STATUS.APPROVED ? "APPROVED" : "REJECTED",
      actor: actor ?? actorFromSession(),
      at: now,
      details:
        target === EXPENSE_REVIEW_STATUS.REJECTED
          ? `Rejected. Reason: ${reason!.trim()}`
          : note,
    });
    notifyFinanceChanged();
    return updated;
  }

  /** Finance approves a pending Admin expense — eligible for reports. */
  async approveAdminExpense(id: string, actor?: string): Promise<Expense> {
    return this.applyReview(
      id,
      EXPENSE_REVIEW_STATUS.APPROVED,
      undefined,
      "Approved by Finance",
      actor,
    );
  }

  /** Finance rejects — reason persisted and returned to Admin. */
  async rejectAdminExpense(
    id: string,
    reason: string,
    actor?: string,
  ): Promise<Expense> {
    return this.applyReview(
      id,
      EXPENSE_REVIEW_STATUS.REJECTED,
      reason,
      "Rejected by Finance",
      actor,
    );
  }

  /**
   * Deletion — Finance manages its own records; ADMIN-owned records can
   * never be deleted from the Finance side (Finance reviews, not destroys),
   * and historical legacy records are preserved except plain drafts.
   */
  async deleteExpense(id: string): Promise<void> {
    requireCaller("FINANCE", "delete expenses");
    const expenses = this.loadMigrated();
    const existing = expenses.find((e) => e.id === id);
    if (!existing) throw new Error("Expense not found");
    const source = expenseSourceOf(existing);
    if (source === EXPENSE_SOURCE.ADMIN) {
      throw new ExpensePermissionError(
        "Admin workflow expenses cannot be deleted — Finance approves or rejects them.",
      );
    }
    if (source === EXPENSE_SOURCE.LEGACY && existing.paymentStatus !== EXPENSE_PAYMENT_STATUS.DRAFT) {
      throw new ExpensePermissionError(
        "Historical records are preserved — only legacy drafts can be deleted.",
      );
    }
    persistExpenses(expenses.filter((e) => e.id !== id));
    appendAudit({
      id: createId(),
      expenseId: id,
      action: "DELETED",
      actor: actorFromSession(),
      at: Date.now(),
    });
    notifyFinanceChanged();
  }

  subscribe(listener: () => void): () => void {
    return subscribeFinance(listener);
  }
}



/** API-backed repository: all expense reads/writes go to CodeIgniter. */
class ApiExpensesRepository implements ExpensesRepository {
  /**
   * Convert expense dates to the YYYY-MM-DD format required by the API.
   * Accepts an already-valid YYYY-MM-DD string, any other parseable date
   * string, a Date instance, or an epoch-millis number. Throws a descriptive
   * error for values that cannot be interpreted as a date.
   */
  private formatApiDate(date: unknown): string {
    if (typeof date === "string") {
      const trimmed = date.trim();

      // Accept an already valid YYYY-MM-DD date.
      const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const parsed = new Date(year, month - 1, day);

        if (
          parsed.getFullYear() === year &&
          parsed.getMonth() === month - 1 &&
          parsed.getDate() === day
        ) {
          return trimmed;
        }
      }

      // Convert other valid date strings to a local calendar date.
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return this.toLocalDateString(parsed);
      }
    }

    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return this.toLocalDateString(date);
    }

    if (typeof date === "number" && Number.isFinite(date)) {
      const parsed = new Date(date);
      if (!Number.isNaN(parsed.getTime())) {
        return this.toLocalDateString(parsed);
      }
    }

    throw new Error(
      "Expense date must be a valid date in YYYY-MM-DD format.",
    );
  }

  /** Use local date components to prevent timezone-related date shifts. */
  private toLocalDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  /**
   * Return a copy of the payload with `date` normalized to YYYY-MM-DD when
   * present. Used on every write path so the backend never receives a raw
   * Date/epoch/localized string.
   */
  private withFormattedDate<T extends { date?: unknown }>(input: T): T {
    if (input.date === undefined || input.date === null || input.date === "") {
      return input;
    }
    return { ...input, date: this.formatApiDate(input.date) as any };
  }

  private async all(): Promise<Expense[]> {
    const result: any = await financeApi.expenses();
    const rows = Array.isArray(result) ? result : (result?.items ?? result?.expenses ?? []);
    return rows as Expense[];
  }
  async getExpenses() { return this.all(); }
  async getExpenseById(id: string) {
    const result: any = await financeApi.expense(id);
    return (result?.expense ?? result ?? null) as Expense | null;
  }
  async getFinanceExpenses() { return (await this.all()).filter(e => expenseSourceOf(e) === EXPENSE_SOURCE.FINANCE); }
  async getAdminExpenses(): Promise<Expense[]> {
    const result: any = await adminExpensesApi.expenses();
    const rows = Array.isArray(result)
      ? result
      : (result?.items ?? result?.expenses ?? []);
    return rows as Expense[];
  }
  async getFinanceReviewQueue() {
    const result: any = await financeApi.expenseReviewQueue();
    return (Array.isArray(result) ? result : (result?.items ?? result?.expenses ?? [])) as Expense[];
  }
  async getLegacyExpenses() { return (await this.all()).filter(e => expenseSourceOf(e) === EXPENSE_SOURCE.LEGACY); }
  isExpenseCounted(expense: Expense) { return isExpenseCounted(expense); }
  async getExpenseReviewSummary() {
    const rows = await this.all();
    const pending = rows.filter(e => e.reviewStatus === EXPENSE_REVIEW_STATUS.PENDING_FINANCE_REVIEW);
    return { pendingReview: pending.length, pendingAmount: pending.reduce((n,e) => n + Number(e.amount || 0), 0), approved: rows.filter(e => e.reviewStatus === EXPENSE_REVIEW_STATUS.APPROVED).length, rejected: rows.filter(e => e.reviewStatus === EXPENSE_REVIEW_STATUS.REJECTED).length, drafts: rows.filter(e => e.reviewStatus === EXPENSE_REVIEW_STATUS.DRAFT).length };
  }

  async createExpense(input: ExpenseInput) {
    const saved = (await financeApi.createExpense({
      ...this.withFormattedDate(input),
      expenseSource: EXPENSE_SOURCE.FINANCE,
    })) as Expense;
    // The API repository must notify Finance subscribers too, otherwise the
    // list keeps showing the pre-create snapshot until a manual refresh.
    notifyFinanceChanged();
    return saved;
  }

  /** Convert UI attachment objects into scalar IDs expected by the API. */
  private withAttachmentIds<T extends Partial<ExpenseInput>>(input: T): T & {
    invoiceAttachmentId?: string | null;
    whtAttachmentId?: string | null;
  } {
    const value: any = { ...input };
    if (Object.prototype.hasOwnProperty.call(value, "invoiceAttachment")) {
      value.invoiceAttachmentId = value.invoiceAttachment?.id ?? null;
      delete value.invoiceAttachment;
    }
    if (Object.prototype.hasOwnProperty.call(value, "whtAttachment")) {
      value.whtAttachmentId = value.whtAttachment?.id ?? null;
      delete value.whtAttachment;
    }
    return value;
  }

  async createAdminExpense(input: ExpenseInput): Promise<Expense> {
    const payload = this.withAttachmentIds(this.withFormattedDate(input));
    const saved = (await adminExpensesApi.createExpense(payload)) as Expense;
    notifyFinanceChanged();
    return saved;
  }

  async updateExpense(id: string, input: Partial<ExpenseInput>) {
    const saved = (await financeApi.updateExpense(
      id,
      this.withFormattedDate(input),
    )) as Expense;
    notifyFinanceChanged();
    return saved;
  }

  async updateAdminExpense(
    id: string,
    input: Partial<ExpenseInput>,
  ): Promise<Expense> {
    const payload = this.withAttachmentIds(this.withFormattedDate(input));
    const saved = (await adminExpensesApi.updateExpense(id, payload)) as Expense;
    notifyFinanceChanged();
    return saved;
  }

  async submitAdminExpense(id: string): Promise<Expense> {
    // The backend validates and performs the status transition.
    const saved = (await adminExpensesApi.submitExpense(id)) as Expense;
    notifyFinanceChanged();
    return saved;
  }

  async approveAdminExpense(id: string) {
    const saved = (await financeApi.approveExpense(id)) as Expense;
    notifyFinanceChanged();
    return saved;
  }
  async rejectAdminExpense(id: string, reason: string) {
    const saved = (await financeApi.rejectExpense(id, reason)) as Expense;
    notifyFinanceChanged();
    return saved;
  }
  async deleteExpense(id: string) {
    await financeApi.deleteExpense(id);
    notifyFinanceChanged();
  }
  subscribe(listener: () => void) { return subscribeFinance(listener); }
}

/** The single API-backed expenses repository instance used by the app. */
export const expensesRepository: ExpensesRepository = new ApiExpensesRepository();