/**
 * Payroll financial records repository.
 *
 * When Finance marks a payroll run as PAID, a linked financial record is
 * created here. This references the HR Payroll Run — not a disconnected
 * record. The future PHP/ERPNext backend owns authoritative accounting.
 */
import type { PayrollRun } from "@/services/hr/types";
import {
  loadPayrollRecords,
  notifyFinanceChanged,
  persistPayrollRecords,
  subscribeFinance,
} from "./storage";
import {
  PAYROLL_RECORD_STATUS,
  type PayrollFinancialRecord,
} from "./types";

export interface PayrollFinancialRecordsRepository {
  getRecords(): Promise<PayrollFinancialRecord[]>;
  getRecordByPayrollId(
    payrollId: string,
  ): Promise<PayrollFinancialRecord | null>;
  createRecordFromPayroll(
    run: PayrollRun,
    actor?: string,
  ): Promise<PayrollFinancialRecord>;
  subscribe(listener: () => void): () => void;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pay-rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Sequential record numbers: PAY-REC-0001, PAY-REC-0002, ... */
function computeNextRecordNumber(records: PayrollFinancialRecord[]): string {
  let max = 0;
  for (const r of records) {
    const match = /^PAY-REC-(\d+)$/.exec(r.recordNumber);
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }
  return `PAY-REC-${String(max + 1).padStart(4, "0")}`;
}

class LocalPayrollFinancialRecordsRepository
  implements PayrollFinancialRecordsRepository
{
  async getRecords(): Promise<PayrollFinancialRecord[]> {
    return loadPayrollRecords().sort((a, b) => b.paidAt - a.paidAt);
  }

  async getRecordByPayrollId(
    payrollId: string,
  ): Promise<PayrollFinancialRecord | null> {
    return (
      loadPayrollRecords().find((r) => r.payrollId === payrollId) ?? null
    );
  }

  async createRecordFromPayroll(
    run: PayrollRun,
    actor?: string,
  ): Promise<PayrollFinancialRecord> {
    const records = loadPayrollRecords();

    // Idempotent — don't create a second record for the same payroll run
    const existing = records.find((r) => r.payrollId === run.payroll_id);
    if (existing) return existing;

    const totalGross = run.employee_records.reduce(
      (sum, r) => sum + r.gross_salary,
      0,
    );
    const totalDeductions = run.employee_records.reduce(
      (sum, r) => sum + r.deductions.reduce((ds, d) => ds + d.amount, 0),
      0,
    );
    const totalNet = run.employee_records.reduce(
      (sum, r) => sum + r.net_salary,
      0,
    );

    const record: PayrollFinancialRecord = {
      id: createId(),
      recordNumber: computeNextRecordNumber(records),
      payrollId: run.payroll_id,
      payrollPeriod: run.period_label,
      employeeCount: run.employee_records.length,
      totalGross,
      totalDeductions,
      totalNet,
      status: PAYROLL_RECORD_STATUS.POSTED,
      paidAt: run.paid_date ? new Date(run.paid_date).getTime() : Date.now(),
      paidBy: actor ?? run.paid_by,
      createdAt: Date.now(),
    };

    persistPayrollRecords([record, ...records]);
    notifyFinanceChanged();
    return record;
  }

  subscribe(listener: () => void): () => void {
    return subscribeFinance(listener);
  }
}

export const payrollFinancialRecordsRepository: PayrollFinancialRecordsRepository =
  new LocalPayrollFinancialRecordsRepository();
