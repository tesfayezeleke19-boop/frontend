
import type {
  PayrollRun,
  PayrollEmployeeRecord,
  PayrollLineItem,
  PayrollRunInput,
} from "./types";

/**
 * NexERP — HR Payroll Repository
 *
 * Handles:
 * - Fetching payroll runs
 * - Fetching payroll details
 * - Creating payroll runs
 * - Calculating payroll
 * - Updating employee payroll records
 * - Submitting payroll to Finance
 *
 * Finance approval, rejection, and payment are handled
 * separately through the Finance API.
 */

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "https://backend-production-ac8a256f.up.railway.app"
).replace(/\/+$/, "");

const PAYROLL_ENDPOINT = `${API_BASE_URL}/api/hr/payroll`;

/* ------------------------------------------------------------------ */
/* API types                                                           */
/* ------------------------------------------------------------------ */

interface ApiResponse<T> {
  success?: boolean;
  message?: string;
  data?: T;
}

type PayrollRunApi = Omit<
  Partial<PayrollRun>,
  | "id"
  | "payroll_id"
  | "employees"
  | "employee_records"
  | "employee_count"
  | "basic_salary"
  | "overtime_hours"
  | "overtime_pay"
  | "gross_salary"
  | "total_amount"
  | "version"
> & {
  id?: string;
  payroll_id?: string;
  employees?: PayrollEmployeeApi[];
  employee_records?: PayrollEmployeeApi[];
  employee_count?: number;
  basic_salary?: number | string;
  overtime_hours?: number | string;
  overtime_pay?: number | string;
  gross_salary?: number | string;
  total_amount?: number | string;
  version?: number;
}

interface PayrollEmployeeApi
  extends Omit<
    Partial<PayrollEmployeeRecord>,
    | "id"
    | "payroll_run_id"
    | "employee_id"
    | "employee_code"
    | "employee_name"
    | "full_name"
    | "machine_employee_no"
    | "present_days"
    | "basic_salary"
    | "overtime_hours"
    | "overtime_pay"
    | "gross_salary"
    | "net_salary"
    | "allowances"
    | "deductions"
  > {
  id?: string;
  payroll_run_id?: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  full_name?: string;
  machine_employee_no?: string | null;
  present_days?: number | string;
  basic_salary?: number | string;
  overtime_hours?: number | string;
  overtime_pay?: number | string;
  gross_salary?: number | string;
  net_salary?: number | string;
  allowances?: unknown;
  deductions?: unknown;
}

class PayrollApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "PayrollApiError";
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function normalizeLineItems(value: unknown): PayrollLineItem[] {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "object" && item !== null) {
        const record = item as Record<string, unknown>;

        return {
          name: String(record.name ?? record.description ?? ""),
          amount: toNumber(record.amount),
        };
      }

      return {
        name: String(item ?? ""),
        amount: 0,
      };
    });
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>).map(
      ([name, item]) => ({
        name,
        amount:
          typeof item === "object" && item !== null
            ? toNumber((item as Record<string, unknown>).amount)
            : toNumber(item),
      }),
    );
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);

      if (parsed !== value) {
        return normalizeLineItems(parsed);
      }
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeEmployeeRecord(
  record: PayrollEmployeeApi,
): PayrollEmployeeRecord {
  return {
    employee_id: String(
      record.employee_code ??
        record.employee_id ??
        "",
    ),

    basic_salary: toNumber(record.basic_salary),

    allowances: normalizeLineItems(record.allowances),

    overtime_hours: toNumber(record.overtime_hours),

    overtime_pay: toNumber(record.overtime_pay),

    gross_salary: toNumber(record.gross_salary),

    deductions: normalizeLineItems(record.deductions),

    net_salary: toNumber(record.net_salary),
  };
}

function normalizePayrollRun(
  run: PayrollRunApi,
): PayrollRun {
  const records =
    run.employee_records ??
    run.employees ??
    [];

  return {
    payroll_id: String(run.payroll_id ?? run.id ?? ""),

    period_label:
      run.period_label ??
      `${run.period_month ?? ""}/${run.period_year ?? ""}`,

    period_month: toNumber(run.period_month),

    period_year: toNumber(run.period_year),

    start_date: run.start_date ?? "",

    end_date: run.end_date ?? "",

    status: run.status ?? "DRAFT",

    employee_records: records.map(normalizeEmployeeRecord),

    created_date:
      run.created_date ??
      run.created_date ??
      "",

    created_by: run.created_by,

    submitted_date:
      run.submitted_date ??
      run.submitted_date,

    submitted_by: run.submitted_by,

    approved_date:
      run.approved_date ??
      run.approved_date,

    approved_by: run.approved_by,

    rejection_reason: run.rejection_reason,

    paid_date:
      run.paid_date ??
      run.paid_date,

    paid_by: run.paid_by,
  };
}

/* ------------------------------------------------------------------ */
/* Request handler                                                     */
/* ------------------------------------------------------------------ */

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${PAYROLL_ENDPOINT}${endpoint}`, {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (error) {
    console.error("Payroll API connection error:", error);

    throw new PayrollApiError(
      "Unable to connect to the payroll server.",
    );
  }

  let result: ApiResponse<T>;

  try {
    result = await response.json();
  } catch {
    throw new PayrollApiError(
      "The payroll server returned an invalid response.",
      response.status,
    );
  }

  if (!response.ok || result.success === false) {
    throw new PayrollApiError(
      result.message ||
        `Payroll request failed with status ${response.status}.`,
      response.status,
    );
  }

  if (
    result &&
    typeof result === "object" &&
    Object.prototype.hasOwnProperty.call(result, "data")
  ) {
    return result.data as T;
  }

  return result as T;
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

class PayrollRepository {
  /**
   * Get all payroll runs.
   */
  async getRuns(): Promise<PayrollRun[]> {
    const data = await request<PayrollRunApi[]>("");

    if (!Array.isArray(data)) {
      return [];
    }

    return data.map(normalizePayrollRun);
  }

  /**
   * Get one payroll run by ID.
   */
  async getRunById(id: string): Promise<PayrollRun> {
    if (!id) {
      throw new PayrollApiError("Payroll run ID is required.");
    }

    const data = await request<PayrollRunApi>(
      `/${encodeURIComponent(id)}`,
    );

    return normalizePayrollRun(data);
  }

  /**
   * Create a payroll run.
   */
  async createRun(payload: PayrollRunInput): Promise<PayrollRun> {
    const data = await request<PayrollRunApi>("", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return normalizePayrollRun(data);
  }

  /**
   * Calculate payroll.
   */
  async calculateRun(id: string): Promise<PayrollRun> {
    if (!id) {
      throw new PayrollApiError("Payroll run ID is required.");
    }

    const data = await request<PayrollRunApi>(
      `/${encodeURIComponent(id)}/calculate`,
      {
        method: "POST",
      },
    );

    return normalizePayrollRun(data);
  }

  /**
   * Update an employee payroll record.
   */
  async updateEmployee(
    runId: string,
    employeeRecordId: string,
    payload: Partial<PayrollEmployeeRecord>,
  ): Promise<PayrollRun> {
    if (!runId || !employeeRecordId) {
      throw new PayrollApiError(
        "Payroll run ID and employee record ID are required.",
      );
    }

    const data = await request<PayrollRunApi>(
      `/${encodeURIComponent(runId)}/employees/${encodeURIComponent(employeeRecordId)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );

    return normalizePayrollRun(data);
  }

  /**
   * Submit payroll to Finance for review.
   */
  async submitForReview(id: string): Promise<PayrollRun> {
    if (!id) {
      throw new PayrollApiError("Payroll run ID is required.");
    }

    const data = await request<PayrollRunApi>(
      `/${encodeURIComponent(id)}/submit`,
      {
        method: "POST",
      },
    );

    return normalizePayrollRun(data);
  }

  /**
   * Finance approval must use the Finance API.
   */
  async approveRun(_id: string): Promise<never> {
    throw new PayrollApiError(
      "Payroll approval must be performed through the Finance API.",
    );
  }

  /**
   * Finance rejection must use the Finance API.
   */
  async rejectRun(
    _id: string,
    _reason: string,
  ): Promise<never> {
    throw new PayrollApiError(
      "Payroll rejection must be performed through the Finance API.",
    );
  }

  /**
   * Payment must use the Finance API.
   */
  async markPaid(_id: string): Promise<never> {
    throw new PayrollApiError(
      "Payroll payment must be performed through the Finance API.",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export const payrollRepository = new PayrollRepository();

export { PayrollApiError, normalizePayrollRun };
