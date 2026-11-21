
/** Central Finance, Sales and Admin Expenses API clients for CodeIgniter 4.
 * Configure VITE_API_BASE_URL in the frontend environment.
 * Finance endpoints: /api/finance/{path}
 * Sales endpoints: /api/sales/{path}
 * Admin expense endpoints: /api/admin/expenses/{path}
 * Admin operational settings: /api/admin/operational-settings/{path}
 */

import { authRepository } from "../auth/authRepository";

const API_BASE = (
  (import.meta as any).env?.VITE_API_BASE_URL ||
  "http://localhost:8080/api"
).replace(/\/+$/, "");

/** Normalize the API root; supports host root or host + /api. */
const API_ROOT = API_BASE.replace(/\/api\/?$/i, "");

const FINANCE_API_BASE = `${API_ROOT}/api/finance`;
const SALES_API_BASE = `${API_ROOT}/api/sales`;
const ADMIN_EXPENSES_API_BASE = `${API_ROOT}/api/admin/expenses`;
const ADMIN_OPERATIONAL_SETTINGS_API_BASE =
  `${API_ROOT}/api/admin/operational-settings`;

export class FinanceApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "FinanceApiError";
    this.status = status;
    this.payload = payload;
  }
}

function bearerToken(): string | undefined {
  const session: any = authRepository.getSession();
  const token = session?.token || session?.accessToken || session?.access_token;

  return typeof token === "string" && token.trim()
    ? token.trim()
    : undefined;
}

async function requestFrom<T = unknown>(
  baseUrl: string,
  apiName: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = bearerToken();
  const normalizedPath = path.replace(/^\/+/, "").replace(/\/+$/, "");
  const url = normalizedPath
    ? `${baseUrl}/${normalizedPath}`
    : `${baseUrl}/`;

  const headers = new Headers(init.headers || {});
  headers.set("Accept", "application/json");

  if (init.body != null && !headers.has("Content-Type")) {
    // The browser must set the multipart boundary for FormData uploads.
    if (!(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(url, { ...init, headers });
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
      payload = { message: responseText };
    }
  }

  if (!response.ok || payload?.success === false) {
    const message =
      payload?.messages?.error ||
      payload?.message ||
      payload?.error ||
      `${apiName} request failed (${response.status})`;

    throw new FinanceApiError(message, response.status, payload);
  }

  return (payload?.data ?? payload) as T;
}

/** Existing Finance request function. */
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

/** Dedicated Sales request function. */
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

/** Dedicated Admin Expenses request function. */
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

/** Dedicated Admin Operational Settings request function. */
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

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
});

/* -------------------------------------------------------------------------- */
/*                              SALES TYPES                                   */
/* -------------------------------------------------------------------------- */

export interface SalesMonthlyInventoryReport {
  id: string;
  period: string;
  status: string;
  quantities?: unknown;
  aggregate_lines?: unknown;
  remarks?: string | null;
  submittedByName?: string | null;
  submittedAt: string | null;
  revisionNumber: number;
}

/* -------------------------------------------------------------------------- */
/*                               FINANCE API                                  */
/* -------------------------------------------------------------------------- */

/** Finance API methods. Keep existing Finance workflow calls here. */
export const financeApi = {
  dashboard: () => financeRequest("dashboard"),
  records: () => financeRequest("records"),

  createOtherFinancialRecord: (data: unknown) =>
    financeRequest("records", json("POST", data)),

  inventoryRecords: () => financeRequest("inventory/records"),

  inventoryRecord: (id: string) =>
    financeRequest(`inventory/records/${encodeURIComponent(id)}`),

  createInventoryRecord: (data: unknown) =>
    financeRequest("inventory/records", json("POST", data)),

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

  payrollRecords: () => financeRequest("payroll-records"),
  reports: () => financeRequest("reports"),

  expenses: () => financeRequest("expenses"),

  expense: (id: string) =>
    financeRequest(`expenses/${encodeURIComponent(id)}`),

  uploadExpenseAttachment: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    return financeRequest<{
      id: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
    }>("expenses/attachments/upload", {
      method: "POST",
      body: formData,
    });
  },

  createExpense: (data: unknown) =>
    financeRequest("expenses", json("POST", data)),

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
    financeRequest("royalty/batches", json("POST", data)),

  payrollRuns: () =>
    financeRequest("payroll-runs"),

  payrollRun: (id: string) =>
    financeRequest(`payroll-runs/${encodeURIComponent(id)}`),

  // Update an employee's allowance and other deduction in a payroll run.
  updatePayrollEmployee: (
    runId: string,
    employeeRecordId: string,
    payload: {
      allowance: number;
      other_deduction: number;
    },
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

/* -------------------------------------------------------------------------- */
/*                                 SALES API                                  */
/* -------------------------------------------------------------------------- */

export const salesApi = {
  monthlyInventoryReports: () =>
    salesRequest<SalesMonthlyInventoryReport[]>(
      "inventory/monthly-reports",
    ),
};

/* -------------------------------------------------------------------------- */
/*                         ADMIN EXPENSES API                                 */
/* -------------------------------------------------------------------------- */

/** Admin-only expense workflow. Finance methods above remain unchanged. */
export const adminExpensesApi = {
  expenses: () => adminExpensesRequest(""),

  expense: (id: string) =>
    adminExpensesRequest(encodeURIComponent(id)),

  createExpense: (data: unknown) =>
    adminExpensesRequest("", json("POST", data)),

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

/* -------------------------------------------------------------------------- */
/*                       ADMIN OPERATIONAL SETTINGS API                       */
/* -------------------------------------------------------------------------- */

export interface OperationalSetting {
  settingKey: string;
  settingValue: string | number;
}

export interface AggregateType {
  id: number;
  name: string;
  pricePerM3: number;
  description?: string | null;
  isActive: boolean;
}

export const adminOperationalSettingsApi = {
  /** Fetch general operational settings. */
  settings: () =>
    adminOperationalSettingsRequest<OperationalSetting[]>(""),

  /** Update general operational settings. */
  updateSettings: (data: {
    overtime_rate: number;
    standard_working_hours: number;
  }) =>
    adminOperationalSettingsRequest(
      "",
      json("PUT", {
        settings: data,
      }),
    ),

  /** Fetch available aggregate types. */
  aggregateTypes: () =>
    adminOperationalSettingsRequest<AggregateType[]>(
      "aggregate-types",
    ),

  /** Create a new aggregate type. */
  createAggregateType: (data: {
    name: string;
    pricePerM3: number;
    description?: string;
    isActive?: boolean;
  }) =>
    adminOperationalSettingsRequest(
      "aggregate-types",
      json("POST", data),
    ),

  /** Update an existing aggregate type. */
  updateAggregateType: (
    id: number,
    data: {
      name?: string;
      pricePerM3?: number;
      description?: string;
      isActive?: boolean;
    },
  ) =>
    adminOperationalSettingsRequest(
      `aggregate-types/${encodeURIComponent(String(id))}`,
      json("PUT", data),
    ),

  /** Delete an existing aggregate type. */
  deleteAggregateType: (id: number) =>
    adminOperationalSettingsRequest(
      `aggregate-types/${encodeURIComponent(String(id))}`,
      json("DELETE"),
    ),
};
