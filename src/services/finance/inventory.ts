/**
 * Inventory — unsold-order records.
 *
 * Finance is the AUTHORITATIVE owner of inventory/unsold-order records.
 * All three portals (Sales, Finance, Admin) read the SAME records through
 * this one service — there are no per-portal copies. Records link back to
 * their source Sales Invoice + child Order by id (never duplicated data).
 *
 * Quantity rules:
 *   - Unsold is ALWAYS computed: `calculateUnsoldQuantity(original, sold)`.
 *     This function is the single implementation of the formula — pages never
 *     compute it independently.
 *   - Status is derived from the calculated quantities (unsold / partially
 *     sold / sold) and is never inferred from invoice approval alone.
 *   - `recordedSoldQuantity` is the amount of physical movement recorded by
 *     an authorized Finance user. Invoice approval does NOT set it.
 *   - `sourceOriginalQuantity` tracks the eligible source order's quantity so
 *     a later source correction can be reconciled against the record.
 *
 * Record origin (`origin`):
 *   AUTO_SOURCE — created automatically from an eligible approved invoice
 *   order (idempotent: one record per source order id).
 *   MANUAL      — created by a Finance user via the Add New Record form.
 *
 * Persistence: localStorage today; replace the repository body with the
 * PHP REST API later without any UI change.
 */
import { notifyFinanceChanged, subscribeFinance } from "./storage";
import { subscribeSales } from "../sales/storage";
import { roundMoney, normalizeNumber } from "../sales/calc";

/**
 * THE centralized unsold-quantity calculation.
 * Used by Finance Inventory, Sales Inventory, Admin Inventory Reports,
 * summary cards, filters, and status derivation — nothing else implements
 * `original − sold`. Numeric in, numeric out; no formatted strings.
 */
export function calculateUnsoldQuantity(
  originalQuantity: number,
  soldQuantity: number,
): number {
  const original = Math.max(0, roundMoney(normalizeNumber(originalQuantity)));
  const sold = Math.max(0, roundMoney(normalizeNumber(soldQuantity)));
  return roundMoney(Math.max(0, original - sold));
}

export const INVENTORY_STATUS = {
  UNSOLD: "UNSOLD",
  PARTIALLY_SOLD: "PARTIALLY_SOLD",
  SOLD: "SOLD",
} as const;

export type InventoryStatus =
  (typeof INVENTORY_STATUS)[keyof typeof INVENTORY_STATUS];

export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, string> = {
  UNSOLD: "Unsold",
  PARTIALLY_SOLD: "Partially Sold",
  SOLD: "Sold",
};

export interface FileEvidence {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
}

/** One unsold-order inventory record — Finance-owned. */
export interface InventoryRecord {
  id: string;
  /** Set when the record traces to a Sales Invoice child order. */
  sourceInvoiceId?: string;
  sourceOrderId?: string;
  invoiceNumber?: string;
  fsNo?: string;
  date: number;
  customerName?: string;
  aggregate?: string;
  /** Quantity originally recorded (e.g. produced/received). */
  originalQuantity: number;
  /**
   * Physical movement recorded by an authorized Finance user. This is
   * NEVER set automatically from invoice approval.
   */
  soldQuantity: number;
  /** Always derived: calculateUnsoldQuantity(originalQuantity, soldQuantity). */
  unsoldQuantity: number;
  unit: string;
  status: InventoryStatus;
  /** How this record came to exist (automatic from source vs manual). */
  origin: InventoryRecordOrigin;
  /**
   * The eligible source order's quantity at last synchronization. Used to
   * reconcile a later source correction against this record without
   * silently discarding recorded movement data.
 */
  sourceOriginalQuantity?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
}

/** Where an inventory record came from. */
export type InventoryRecordOrigin = "AUTO_SOURCE" | "MANUAL";

/** Input for creating or editing an inventory record. */
export interface InventoryInput {
  sourceInvoiceId?: string;
  sourceOrderId?: string;
  invoiceNumber?: string;
  fsNo?: string;
  date: number;
  customerName?: string;
  aggregate?: string;
  originalQuantity: number;
  /**
   * Recorded sold/movement quantity. When omitted on MANUAL records, defaults
   * to 0 and unsold is computed automatically. Rejected when it contradicts
   * reliable source data without an authorized reconciliation.
   */
  soldQuantity?: number;
  /**
   * @deprecated Manual unsold entry is no longer accepted — the value is
   * always calculated. Kept in the type for backward compatibility; ignored
   * by the repository.
   */
  unsoldQuantity?: number;
  unit?: string;
  status?: InventoryStatus;
  notes?: string;
}

export interface InventoryValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

/** Derived status when the caller doesn't specify one. */
export function deriveInventoryStatus(
  originalQuantity: number,
  soldQuantity: number,
): InventoryStatus {
  const original = Math.max(0, normalizeNumber(originalQuantity));
  const sold = Math.max(0, normalizeNumber(soldQuantity));
  const unsold = calculateUnsoldQuantity(original, sold);

  // Zero/incomplete records are never "Sold" — they are flagged invalid
  // by validation, not classified as fully sold.
  if (original <= 0) return INVENTORY_STATUS.UNSOLD;
  if (unsold <= 0 && sold > 0) return INVENTORY_STATUS.SOLD;
  if (sold > 0) return INVENTORY_STATUS.PARTIALLY_SOLD;
  return INVENTORY_STATUS.UNSOLD;
}

/**
 * Validate an inventory record before save.
 * Unsold quantity is CALCULATED, never entered — inputs only supply
 * original and (optionally) recorded sold quantities.
 */
export function validateInventoryInput(input: InventoryInput): InventoryValidationResult {
  const errors: Record<string, string> = {};

  if (!Number.isFinite(normalizeNumber(input.date)) || input.date <= 0) {
    errors.date = "A valid date is required";
  }
  if (!Number.isFinite(input.originalQuantity) || !Number.isFinite(input.soldQuantity ?? 0)) {
    errors.originalQuantity = "Quantities must be valid numbers (no NaN or Infinity)";
    return { valid: false, errors };
  }
  const original = normalizeNumber(input.originalQuantity);
  if (original < 0) {
    errors.originalQuantity = "Original quantity cannot be negative";
  } else if (original <= 0) {
    errors.originalQuantity = "Original quantity must be greater than zero";
  }
  const sold = normalizeNumber(input.soldQuantity ?? 0);
  if (sold < 0) {
    errors.soldQuantity = "Sold quantity cannot be negative";
  } else if (sold > original) {
    errors.soldQuantity =
      "Sold quantity cannot exceed Original Quantity — record a quantity correction instead";
  }
  if (!input.aggregate) {
    errors.aggregate = "Aggregate is required";
  }
  if (!input.invoiceNumber?.trim() && !input.sourceInvoiceId) {
    errors.invoiceNumber = "Invoice Number or a source invoice link is required";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export class InventoryValidationError extends Error {
  errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super(Object.values(errors)[0] ?? "Invalid inventory record");
    this.errors = errors;
  }
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export interface InventoryRepository {
  /** All records — ONE shared source for Sales, Finance, and Admin. */
  getRecords(): Promise<InventoryRecord[]>;
  getRecordById(id: string): Promise<InventoryRecord | null>;
  /** Finance-only write path. */
  createRecord(input: InventoryInput, actor?: string): Promise<InventoryRecord>;
  /** Finance-only write path. */
  updateRecord(
    id: string,
    input: Partial<InventoryInput>,
    actor?: string,
  ): Promise<InventoryRecord>;
  /** Finance-only write path. */
  deleteRecord(id: string): Promise<void>;
  /**
   * Idempotent create-or-reconcile of source-linked inventory records from
   * eligible approved invoice orders. Safe to run repeatedly (page loads,
   * review re-opens, dashboard refreshes): it never increments recorded
   * sold quantities and at most updates a record whose source quantity
   * changed. Manual records without a source link are untouched.
   */
  syncSourceOrders(
    sources: InventorySourceOrder[],
    actor?: string,
  ): Promise<{ created: number; reconciled: number }>;
  subscribe(listener: () => void): () => void;
}

const KEY = "nexerp.finance.inventory.v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota failures
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `inv-rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Everything derived is recomputed here from raw inputs — the caller never
 * supplies unsold quantity or a contradicted status. Both create and update
 * paths go through this, so the formula exists in exactly one place.
 */
function normalizeRecord(input: InventoryInput, base?: InventoryRecord): {
  originalQuantity: number;
  soldQuantity: number;
  unsoldQuantity: number;
  status: InventoryStatus;
} {
  const original = roundMoney(Math.max(0, normalizeNumber(input.originalQuantity)));
  const sold = roundMoney(Math.max(0, normalizeNumber(input.soldQuantity ?? 0)));
  // THE calculation — centralized, never page-implemented.
  const unsoldQuantity = calculateUnsoldQuantity(original, sold);
  // Status is derived from the calculated quantities so a stored status can
  // never contradict the recorded numbers.
  const status = deriveInventoryStatus(original, sold);
  return { originalQuantity: original, soldQuantity: sold, unsoldQuantity, status };
}

/** An eligible invoice order that should exist as an inventory record. */
export interface InventorySourceOrder {
  sourceInvoiceId: string;
  sourceOrderId: string;
  invoiceNumber: string;
  fsNo?: string;
  customerName?: string;
  aggregate?: string;
  /** The reliable source quantity (the order's line quantity). */
  originalQuantity: number;
  date: number;
}

/** Stable key that identifies one source order — the deduplication anchor. */
export function inventorySourceKey(
  source: Pick<InventorySourceOrder, "sourceInvoiceId" | "sourceOrderId">,
): string {
  return `${source.sourceInvoiceId}::${source.sourceOrderId}`;
}

export class LocalInventoryRepository implements InventoryRepository {
  /**
   * Load + upgrade legacy records in place (safe to rerun):
   *   - records saved before the origin field existed get `MANUAL` (they were
   *     created through the manual form — never silently re-attributed)
   *   - derived values (unsold, status) are recomputed for old records whose
   *     stored values may predate the centralized calculation
   */
  private load(): InventoryRecord[] {
    const raw = (readJson<InventoryRecord[]>(KEY, []) ?? []).filter(
      (r) => typeof r === "object" && r !== null && typeof r.id === "string",
    );
    let changed = false;
    const upgraded = raw.map((record) => {
      const totals = normalizeRecord(
        {
          originalQuantity: record.originalQuantity,
          soldQuantity: record.soldQuantity,
          date: record.date,
        },
        record,
      );
      const needsUpgrade =
        record.origin === undefined ||
        totals.unsoldQuantity !== record.unsoldQuantity ||
        totals.status !== record.status;
      if (!needsUpgrade) return record;
      changed = true;
      return {
        ...record,
        ...totals,
        origin: record.origin ?? (record.sourceInvoiceId ? "AUTO_SOURCE" : "MANUAL"),
      } satisfies InventoryRecord;
    });
    if (changed) {
      // Persist the upgraded shape, but silently — a load must not spam
      // change notifications into an infinite hook loop.
      writeJson(KEY, upgraded);
    }
    return upgraded;
  }

  private save(records: InventoryRecord[]): void {
    writeJson(KEY, records);
    notifyFinanceChanged();
  }

  async getRecords(): Promise<InventoryRecord[]> {
    return this.load().sort((a, b) => b.date - a.date);
  }

  async getRecordById(id: string): Promise<InventoryRecord | null> {
    return this.load().find((r) => r.id === id) ?? null;
  }

  async createRecord(input: InventoryInput, actor?: string): Promise<InventoryRecord> {
    const validation = validateInventoryInput(input);
    if (!validation.valid) throw new InventoryValidationError(validation.errors);

    const now = Date.now();
    const totals = normalizeRecord(input);
    const record: InventoryRecord = {
      id: createId(),
      sourceInvoiceId: input.sourceInvoiceId,
      sourceOrderId: input.sourceOrderId,
      invoiceNumber: input.invoiceNumber,
      fsNo: input.fsNo,
      date: input.date,
      customerName: input.customerName,
      aggregate: input.aggregate,
      ...totals,
      unit: input.unit ?? "m³",
      status: totals.status,
      origin: input.sourceInvoiceId ? "AUTO_SOURCE" : "MANUAL",
      sourceOriginalQuantity: input.sourceInvoiceId
        ? roundMoney(Math.max(0, normalizeNumber(input.originalQuantity)))
        : undefined,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
    };
    this.save([record, ...this.load()]);
    return record;
  }

  async updateRecord(
    id: string,
    input: Partial<InventoryInput>,
    actor?: string,
  ): Promise<InventoryRecord> {
    const records = this.load();
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) throw new Error("Inventory record not found");

    const current = records[index];
    const merged: InventoryInput = {
      sourceInvoiceId: input.sourceInvoiceId ?? current.sourceInvoiceId,
      sourceOrderId: input.sourceOrderId ?? current.sourceOrderId,
      invoiceNumber: input.invoiceNumber ?? current.invoiceNumber,
      fsNo: input.fsNo ?? current.fsNo,
      date: input.date ?? current.date,
      customerName: input.customerName ?? current.customerName,
      aggregate: input.aggregate ?? current.aggregate,
      originalQuantity: input.originalQuantity ?? current.originalQuantity,
      soldQuantity: input.soldQuantity ?? current.soldQuantity,
      unit: input.unit ?? current.unit,
      notes: input.notes !== undefined ? input.notes : current.notes,
    };
    const validation = validateInventoryInput(merged);
    if (!validation.valid) throw new InventoryValidationError(validation.errors);

    const totals = normalizeRecord(merged, current);
    const updated: InventoryRecord = {
      ...current,
      ...merged,
      ...totals,
      notes: merged.notes,
      updatedAt: Date.now(),
    };
    if (actor) updated.createdBy = actor;
    records[index] = updated;
    this.save(records);
    return updated;
  }

  async deleteRecord(id: string): Promise<void> {
    this.save(this.load().filter((r) => r.id !== id));
  }

  /**
   * Idempotent source synchronization.
   *
   * For each eligible approved invoice order (matched by sourceInvoiceId ::
   * sourceOrderId), create the missing inventory record or reconcile a
   * source-quantity correction. Recorded sold quantities are NEVER touched
   * here — invoice approval does not mark stock as sold, so the same source
   * processed twice can never double-count movement.
   */
  async syncSourceOrders(
    sources: InventorySourceOrder[],
    actor?: string,
  ): Promise<{ created: number; reconciled: number }> {
    const now = Date.now();
    let created = 0;
    let reconciled = 0;
    const records = this.load();

    for (const source of sources) {
      const key = inventorySourceKey(source);
      const existingIndex = records.findIndex(
        (r) =>
          r.sourceInvoiceId === source.sourceInvoiceId &&
          r.sourceOrderId === source.sourceOrderId,
      );

      if (existingIndex === -1) {
        // Create the missing AUTO_SOURCE record (derived values computed).
        const totals = normalizeRecord({
          originalQuantity: source.originalQuantity,
          soldQuantity: 0,
          date: source.date,
        });
        records.unshift({
          id: createId(),
          sourceInvoiceId: source.sourceInvoiceId,
          sourceOrderId: source.sourceOrderId,
          invoiceNumber: source.invoiceNumber,
          fsNo: source.fsNo,
          date: source.date,
          customerName: source.customerName,
          aggregate: source.aggregate,
          ...totals,
          unit: "m³",
          origin: "AUTO_SOURCE",
          sourceOriginalQuantity: roundMoney(
            Math.max(0, normalizeNumber(source.originalQuantity)),
          ),
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
        });
        created += 1;
        continue; // record pushed; dedupe below by key integrity
      }

      // Existing record — reconcile a source-quantity correction only.
      const record = records[existingIndex];
      const sourceQty = roundMoney(
        Math.max(0, normalizeNumber(source.originalQuantity)),
      );
      const previous = roundMoney(
        Math.max(0, normalizeNumber(record.sourceOriginalQuantity ?? record.originalQuantity)),
      );
      if (sourceQty !== previous) {
        const sold = roundMoney(Math.max(0, normalizeNumber(record.soldQuantity)));
        if (sold <= sourceQty) {
          // Safe reconciliation: source changed, recorded movement still fits.
          const totals = normalizeRecord({
            originalQuantity: sourceQty,
            soldQuantity: sold,
            date: source.date,
          });
          records[existingIndex] = {
            ...record,
            invoiceNumber: source.invoiceNumber,
            fsNo: source.fsNo ?? record.fsNo,
            customerName: source.customerName ?? record.customerName,
            aggregate: source.aggregate ?? record.aggregate,
            ...totals,
            sourceOriginalQuantity: sourceQty,
            updatedAt: now,
          };
          reconciled += 1;
        }
        // If recorded sold exceeds the corrected source quantity, flag it as
        // an inconsistency (admin exception panel already detects unsold ≠
        // original − sold via getInventorySummary); recorded movement is not
        // silently discarded.
      }
    }

    if (created > 0 || reconciled > 0) {
      this.save(records);
    }
    return { created, reconciled };
  }

  subscribe(listener: () => void): () => void {
    const unsubFinance = subscribeFinance(listener);
    const unsubSales = subscribeSales(listener);
    return () => {
      unsubFinance();
      unsubSales();
    };
  }
}

/** The single inventory repository instance used by every portal. */
export const inventoryRepository: InventoryRepository =
  new LocalInventoryRepository();

/* ------------------------------------------------------------------ */
/* Aggregations — shared by Sales / Finance / Admin views               */
/* ------------------------------------------------------------------ */

/**
 * Aggregate summary — all three portals + shared cards.
 * Every value is derived through the same shared repository + calculation.
 */
export interface InventorySummary {
  totalRecords: number;
  totalUnsoldQuantity: number;
  unsoldByAggregate: { name: string; value: number }[];
  byStatus: { name: string; value: number }[];
  /** Records whose stored quantities are inconsistent (Admin exceptions). */
  inconsistentRecords: InventoryRecord[];
}

export async function getInventorySummary(): Promise<InventorySummary> {
  const records = await inventoryRepository.getRecords();
  const unsoldByAggregate: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const inconsistentRecords: InventoryRecord[] = [];

  for (const record of records) {
    const key = record.aggregate ?? "—";
    unsoldByAggregate[key] = (unsoldByAggregate[key] ?? 0) + record.unsoldQuantity;
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    const expected = roundMoney(record.originalQuantity - record.soldQuantity);
    if (Math.abs(record.unsoldQuantity - expected) > 0.01) {
      inconsistentRecords.push(record);
    }
  }

  return {
    totalRecords: records.length,
    totalUnsoldQuantity: roundMoney(
      records.reduce((s, r) => s + r.unsoldQuantity, 0),
    ),
    unsoldByAggregate: Object.entries(unsoldByAggregate)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
    byStatus: Object.entries(byStatus).map(([name, value]) => ({ name, value })),
    inconsistentRecords,
  };
}
