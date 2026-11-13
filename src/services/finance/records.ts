/**
 * Financial records repository.
 *
 * Records are derived from the SHARED Sales repository — Finance never keeps
 * a second copy of sales orders. When Finance confirms payment for an
 * approved order, this repository updates the same order record (via
 * salesOrdersRepository.confirmPayment) and creates one financial record that
 * references it.
 *
 * Current implementation persists to localStorage; swap for a PHP REST API
 * implementation of the same interface later without UI changes.
 *
 * NOTE: this is a mock/workflow record for frontend development, not a real
 * accounting entry. The future PHP/ERPNext backend owns authoritative,
 * double-entry accounting.
 */
import { salesOrdersRepository } from "../sales/orders";
import {
  loadRecords,
  notifyFinanceChanged,
  persistRecords,
  subscribeFinance,
} from "./storage";
import {
  FINANCIAL_RECORD_STATUS,
  type FinancialRecord,
} from "./types";

export interface FinancialRecordsRepository {
  getRecords(): Promise<FinancialRecord[]>;
  getRecordById(id: string): Promise<FinancialRecord | null>;
  getRecordByOrderId(orderId: string): Promise<FinancialRecord | null>;
  /**
   * Confirm payment for an approved order and create its financial record.
   * Idempotent — if a record already exists for the order, it is returned
   * without creating a duplicate.
   */
  confirmPaymentAndCreateRecord(
    orderId: string,
    actor?: string,
  ): Promise<{ order: import("../sales/types").SalesOrder; record: FinancialRecord }>;
  subscribe(listener: () => void): () => void;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Sequential record numbers: FIN-REC-0001, FIN-REC-0002, ... */
export function computeNextFinancialRecordNumber(
  recordNumbers: string[],
): string {
  let max = 0;
  for (const recordNumber of recordNumbers) {
    const match = /^FIN-REC-(\d+)$/.exec(recordNumber);
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }
  return `FIN-REC-${String(max + 1).padStart(4, "0")}`;
}

export class LocalFinancialRecordsRepository
  implements FinancialRecordsRepository
{
  async getRecords(): Promise<FinancialRecord[]> {
    return loadRecords().sort((a, b) => b.postedAt - a.postedAt);
  }

  async getRecordById(id: string): Promise<FinancialRecord | null> {
    return loadRecords().find((record) => record.id === id) ?? null;
  }

  async getRecordByOrderId(orderId: string): Promise<FinancialRecord | null> {
    return loadRecords().find((record) => record.sourceOrderId === orderId) ?? null;
  }

  async confirmPaymentAndCreateRecord(
    orderId: string,
    actor?: string,
  ): Promise<{
    order: import("../sales/types").SalesOrder;
    record: FinancialRecord;
  }> {
    const records = loadRecords();

    // Idempotent — never create two records for the same order.
    const existing = records.find((record) => record.sourceOrderId === orderId);
    if (existing) {
      const order = await salesOrdersRepository.getOrderById(orderId);
      if (!order) throw new Error("Order not found");
      return { order, record: existing };
    }

    // Updates the SAME order record Finance reviewed (guards FINANCE_APPROVED).
    const order = await salesOrdersRepository.confirmPayment(orderId, actor);

    const record: FinancialRecord = {
      id: createId(),
      recordNumber: computeNextFinancialRecordNumber(
        records.map((record) => record.recordNumber),
      ),
      sourceOrderId: order.id,
      sourceOrderNumber: order.orderNumber,
      customerName: order.customerName,
      aggregate: order.aggregate,
      quantity: order.quantity,
      unit: order.unit,
      unitPrice: order.unitPrice,
      totalPrice: order.totalPriceInclVat,
      bank: order.bank,
      status: FINANCIAL_RECORD_STATUS.POSTED,
      postedAt: order.paymentConfirmedAt ?? Date.now(),
      postedBy: actor ?? order.paymentConfirmedBy,
      createdAt: Date.now(),
    };

    persistRecords([record, ...records]);
    notifyFinanceChanged();
    return { order, record };
  }

  subscribe(listener: () => void): () => void {
    return subscribeFinance(listener);
  }
}

/** The single financial records repository instance used by the app. */
export const financialRecordsRepository: FinancialRecordsRepository =
  new LocalFinancialRecordsRepository();
