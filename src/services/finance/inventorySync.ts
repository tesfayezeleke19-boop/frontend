/**
 * Inventory source synchronization.
 *
 * Bridges approved Sales Invoices into the shared inventory repository.
 *
 * What counts as an eligible source order — the application's strongest
 * reliable quantity source:
 *   - The invoice was FINANCE_APPROVED or PAYMENT_CONFIRMED (never rejected
 *     and never a draft — rejected invoices must not create stock).
 *   - The child order carries a real quantity and aggregate.
 *
 * What this does NOT do:
 *   - It never marks stock as sold. Invoice approval is a financial event,
 *     not a physical movement. Recorded sold quantities are entered by
 *     authorized Finance users, and remain untouched by sync.
 *
 * Idempotency: the repository matches records by
 * `invoiceId :: orderId`, so re-running (page refresh, review re-open,
 * dashboard load) can never create duplicates.
 */
import { salesInvoicesRepository } from "../sales/invoiceRepo";
import { ORDER_STATUS } from "../sales/types";
import {
  inventoryRepository,
  inventorySourceKey,
  type InventorySourceOrder,
} from "./inventory";

export async function getInventorySourceOrders(): Promise<InventorySourceOrder[]> {
  const invoices = await salesInvoicesRepository.getInvoices();
  const sources: InventorySourceOrder[] = [];
  for (const invoice of invoices) {
    if (
      invoice.status !== ORDER_STATUS.FINANCE_APPROVED &&
      invoice.status !== ORDER_STATUS.PAYMENT_CONFIRMED
    ) {
      continue;
    }
    for (const order of invoice.orders) {
      const quantity = Number(order.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      sources.push({
        sourceInvoiceId: invoice.id,
        sourceOrderId: order.id,
        invoiceNumber: invoice.invoiceNumber,
        fsNo: invoice.fsNo,
        customerName: invoice.customer?.name,
        aggregate: order.aggregate,
        originalQuantity: quantity,
        date: invoice.date,
      });
    }
  }
  return sources;
}

/**
 * Run one synchronization pass. Returns what changed so callers (e.g. the
 * Finance Inventory page) can report honestly.
 */
export async function syncInventoryFromSources(actor?: string): Promise<{
  created: number;
  reconciled: number;
  keys: string[];
}> {
  const sources = await getInventorySourceOrders();
  const result = await inventoryRepository.syncSourceOrders(sources, actor);
  return { ...result, keys: sources.map(inventorySourceKey) };
}
