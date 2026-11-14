
/**
 * Central Finance, Admin Expenses, Operational Settings,
 * and Sales API clients for CodeIgniter 4.
 *
 * Configure VITE_API_BASE_URL in the frontend environment.
 *
 * Finance endpoints:
 * /api/finance/{path}
 *
 * Admin expense endpoints:
 * /api/admin/expenses/{path}
 *
 * Admin operational settings:
 * /api/admin/operational-settings
 *
 * Sales endpoints:
 * /api/sales/{path}
 */

import { authRepository } from "../auth/authRepository";

// =====================================================
// API CONFIGURATION
// =====================================================

const API_BASE = (
  (import.meta as any).env?.VITE_API_BASE_URL ||
  "https://backend-production-ac8a256f.up.railway.app"
).replace(/\/+$/, "");

/** Normalize the API root; supports host root or host + /api. */
const API_ROOT = API_BASE.replace(/\/api\/?$/i, "");

const FINANCE_API_BASE = `${API_ROOT}/api/finance`;

const ADMIN_EXPENSES_API_BASE =
  `${API_ROOT}/api/admin/expenses`;

const ADMIN_OPERATIONAL_SETTINGS_API_BASE =
  `${API_ROOT}/api/admin/operational-settings`;

const SALES_API_BASE =
  `${API_ROOT}/api/sales`;

// =====================================================
// TYPES
// =====================================================

export interface OperationalSetting {
  id: string;
  settingKey: string;
  settingName: string;
  settingValue: number;
  unit: string;
  description: string;
  updatedAt: string | number;
}

export interface AggregateType {
  id: string;
  name: string;
  pricePerM3: number;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AggregateTypePayload {
  name: string;
  pricePerM3: number;
  description: string;
}

/**
 * Published monthly inventory report returned by
 * GET /api/sales/inventory/monthly-reports
 */
export interface SalesMonthlyInventoryReport {
  id: string;
  period: string;
  status: "SUBMITTED" | "CORRECTED";

  quantities: {
    "00": number;
    "01": number;
    "02": number;
  };

  remarks: string | null;
  submittedByName: string | null;
  submittedAt: string | null;

  createdAt: string;
  updatedAt: string;

  version: number;
  revisionNumber: number;
}

/**
 * Finance payroll employee manual adjustments.
 *
 * These values are saved in the employee payroll record.
 * The backend recalculates gross salary, tax, pension,
 * total deduction, and net salary.
 */
export interface PayrollEmployeeUpdatePayload {
  allowance: number;
  other_deduction: number;
}

// =====================================================
// API ERROR
// =====================================================

export class FinanceApiError extends Error {
  status: number;
  payload: unknown;

  constructor(
    message: string,
    status: number,
    payload: unknown,
  ) {
    super(message);

    this.name = "FinanceApiError";
    this.status = status;
    this.payload = payload;
  }
}

// =====================================================
// AUTHENTICATION TOKEN
// =====================================================

function bearerToken(): string | undefined {
  const session: any = authRepository.getSession();

  const token =
    session?.token ||
    session?.accessToken ||
    session?.access_token;

  return typeof token === "string" && token.trim()
    ? token.trim()
    : undefined;
}

// =====================================================
// COMMON REQUEST FUNCTION
// =====================================================

async function requestFrom<T = unknown>(
  baseUrl: string,
  apiName: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = bearerToken();

  const normalizedPath = path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  const url = normalizedPath
    ? `${baseUrl}/${normalizedPath}`
    : `${baseUrl}/`;

  const headers = new Headers(init.headers || {});

  headers.set("Accept", "application/json");

  if (init.body != null && !headers.has("Content-Type")) {
    // Browser sets multipart boundary automatically for FormData.
    if (!(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch (error) {
    throw new FinanceApiError(
      `Unable to connect to the ${apiName} at ${url}. Check that the backend is running and CORS allows your frontend origin.`,
      0,
      error instanceof Error ? error.message : error,
    );
  }

  const responseText = await response.text();

  let payload: any = null;

  if (responseText.trim()) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = {
        message: responseText,
      };
    }
  }

  if (!response.ok || payload?.success === false) {
    const message =
      payload?.messages?.error ||
      payload?.message ||
      payload?.error ||
      `${apiName} request failed (${response.status})`;

    throw new FinanceApiError(
      message,
      response.status,
      payload,
    );
  }

  return (payload?.data ?? payload) as T;
}

// =====================================================
// REQUEST HELPERS
// =====================================================

/** Finance request function. */
export async function financeRequest<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return requestFrom<T>(
    FINANCE_API_BASE,
    "Finance API",
    path,
    init,
  );
}

/** Sales request function. */
export async function salesRequest<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return requestFrom<T>(
    SALES_API_BASE,
    "Sales API",
    path,
    init,
  );
}

/** Admin Expenses request function. */
export async function adminExpensesRequest<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return requestFrom<T>(
    ADMIN_EXPENSES_API_BASE,
    "Admin Expenses API",
    path,
    init,
  );
}

/** Admin Operational Settings request function. */
export async function adminOperationalSettingsRequest<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return requestFrom<T>(
    ADMIN_OPERATIONAL_SETTINGS_API_BASE,
    "Admin Operational Settings API",
    path,
    init,
  );
}

// =====================================================
// JSON REQUEST HELPER
// =====================================================

const json = (
  method: string,
  data?: unknown,
): RequestInit => ({
  method,

  ...(data === undefined
    ? {}
    : {
        body: JSON.stringify(data),
      }),
});

// =====================================================
// FINANCE API METHODS
// =====================================================

export const financeApi = {
  dashboard: () =>
    financeRequest("dashboard"),

  records: () =>
    financeRequest("records"),

  createOtherFinancialRecord: (data: unknown) =>
    financeRequest(
      "records",
      json("POST", data),
    ),

  inventoryRecords: () =>
    financeRequest("inventory/records"),

  inventoryRecord: (id: string) =>
    financeRequest(
      `inventory/records/${encodeURIComponent(id)}`,
    ),

  createInventoryRecord: (data: unknown) =>
    financeRequest(
      "inventory/records",
      json("POST", data),
    ),

  updateInventoryRecord: (id: string, data: unknown) =>
    financeRequest(
      `inventory/records/${encodeURIComponent(id)}`,
      json("PUT", data),
    ),

  deleteInventoryRecord: (id: string) =>
    financeRequest(
      `inventory/records/${encodeURIComponent(id)}`,
      json("DELETE"),
    ),

  payrollRecords: () =>
    financeRequest("payroll-records"),

  reports: () =>
    financeRequest("reports"),

  expenses: () =>
    financeRequest("expenses"),

  expense: (id: string) =>
    financeRequest(
      `expenses/${encodeURIComponent(id)}`,
    ),

  createExpense: (data: unknown) =>
    financeRequest(
      "expenses",
      json("POST", data),
    ),

  updateExpense: (id: string, data: unknown) =>
    financeRequest(
      `expenses/${encodeURIComponent(id)}`,
      json("PUT", data),
    ),

  deleteExpense: (id: string) =>
    financeRequest(
      `expenses/${encodeURIComponent(id)}`,
      json("DELETE"),
    ),

  expenseReviewQueue: () =>
    financeRequest("expenses/review-queue"),

  submitExpense: (id: string) =>
    financeRequest(
      `expenses/${encodeURIComponent(id)}/submit`,
      json("POST", {}),
    ),

  approveExpense: (id: string) =>
    financeRequest(
      `expenses/${encodeURIComponent(id)}/approve`,
      json("POST", {}),
    ),

  rejectExpense: (id: string, reason: string) =>
    financeRequest(
      `expenses/${encodeURIComponent(id)}/reject`,
      json("POST", { reason }),
    ),

  monthlyInventoryReports: () =>
    financeRequest("inventory/monthly-reports"),

  submittedInventoryReports: () =>
    financeRequest("inventory/monthly-reports/submitted"),

  inventoryReport: (id: string) =>
    financeRequest(
      `inventory/monthly-reports/${encodeURIComponent(id)}`,
    ),

  saveInventoryReport: (data: unknown, id?: string) =>
    financeRequest(
      id
        ? `inventory/monthly-reports/${encodeURIComponent(id)}`
        : "inventory/monthly-reports",
      json(id ? "PUT" : "POST", data),
    ),

  submitInventoryReport: (id: string) =>
    financeRequest(
      `inventory/monthly-reports/${encodeURIComponent(id)}/submit`,
      json("POST", {}),
    ),

  royaltyBatches: () =>
    financeRequest("royalty/batches"),

  eligibleRoyaltyLines: () =>
    financeRequest("royalty/eligible-lines"),

  createRoyaltyBatch: (data: unknown) =>
    financeRequest(
      "royalty/batches",
      json("POST", data),
    ),

  // -------------------------------------------------
  // PAYROLL
  // -------------------------------------------------

  payrollRuns: () =>
    financeRequest("payroll-runs"),

  payrollRun: (id: string) =>
    financeRequest(
      `payroll-runs/${encodeURIComponent(id)}`,
    ),

  /**
   * Update an employee's manual payroll adjustments.
   *
   * PUT /api/finance/payroll-runs/{runId}/employees/{employeeRecordId}
   *
   * The backend calculates:
   * - Gross salary
   * - Income tax
   * - Pension
   * - Total deduction
   * - Net pay
   */
  updatePayrollEmployee: (
    runId: string,
    employeeRecordId: string,
    payload: PayrollEmployeeUpdatePayload,
  ) =>
    financeRequest(
      `payroll-runs/${encodeURIComponent(runId)}/employees/${encodeURIComponent(employeeRecordId)}`,
      json("PUT", payload),
    ),

  approvePayroll: (id: string) =>
    financeRequest(
      `payroll-runs/${encodeURIComponent(id)}/approve`,
      json("POST", {}),
    ),

  rejectPayroll: (id: string, reason: string) =>
    financeRequest(
      `payroll-runs/${encodeURIComponent(id)}/reject`,
      json("POST", { reason }),
    ),

  markPayrollPaid: (id: string) =>
    financeRequest(
      `payroll-runs/${encodeURIComponent(id)}/mark-paid`,
      json("POST", {}),
    ),
};

// =====================================================
// ADMIN EXPENSES API
// =====================================================

export const adminExpensesApi = {
  expenses: () =>
    adminExpensesRequest(""),

  expense: (id: string) =>
    adminExpensesRequest(
      encodeURIComponent(id),
    ),

  createExpense: (data: unknown) =>
    adminExpensesRequest(
      "",
      json("POST", data),
    ),

  updateExpense: (id: string, data: unknown) =>
    adminExpensesRequest(
      encodeURIComponent(id),
      json("PUT", data),
    ),

  submitExpense: (id: string) =>
    adminExpensesRequest(
      `${encodeURIComponent(id)}/submit`,
      json("POST", {}),
    ),

  uploadAttachment: async (file: File) => {
    const formData = new FormData();

    formData.append("file", file);

    return adminExpensesRequest<{
      id: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
    }>("attachments/upload", {
      method: "POST",
      body: formData,
    });
  },
};

// =====================================================
// ADMIN OPERATIONAL SETTINGS API
// =====================================================

export const adminOperationalSettingsApi = {

  // GENERAL SETTINGS

  settings: () =>
    adminOperationalSettingsRequest<OperationalSetting[]>(""),

  updateSettings: (
    settings: Record<string, number>,
  ) =>
    adminOperationalSettingsRequest<OperationalSetting[]>(
      "",
      json("PUT", { settings }),
    ),

  // AGGREGATE TYPES

  aggregateTypes: () =>
    adminOperationalSettingsRequest<AggregateType[]>(
      "aggregate-types",
    ),

  createAggregateType: (
    data: AggregateTypePayload,
  ) =>
    adminOperationalSettingsRequest<AggregateType>(
      "aggregate-types",
      json("POST", data),
    ),

  updateAggregateType: (
    id: string,
    data: AggregateTypePayload,
  ) =>
    adminOperationalSettingsRequest<AggregateType>(
      `aggregate-types/${encodeURIComponent(id)}`,
      json("PUT", data),
    ),

  deleteAggregateType: (id: string) =>
    adminOperationalSettingsRequest<{
      success: boolean;
      message: string;
    }>(
      `aggregate-types/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
    ),
};

// =====================================================
// SALES API
// =====================================================

export const salesApi = {
  /**
   * Get Finance-published monthly inventory reports.
   * Draft reports are excluded by the backend.
   */
  monthlyInventoryReports: () =>
    salesRequest<SalesMonthlyInventoryReport[]>(
      "inventory/monthly-reports",
    ),
};
