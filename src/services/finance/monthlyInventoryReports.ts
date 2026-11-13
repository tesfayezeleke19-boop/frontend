
import { API_BASE_URL, HR_API_BASE_URL } from "@/lib/api/config";
import { getHrAuthToken } from "@/services/hr/apiClient";

export const MONTHLY_REPORT_STATUS = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
} as const;

export type MonthlyReportStatus =
  (typeof MONTHLY_REPORT_STATUS)[keyof typeof MONTHLY_REPORT_STATUS];

export type PeriodCompleteness = "MISSING" | "DRAFT" | "SUBMITTED";

export type MonthlyReportPeriodType =
  | "ETHIOPIAN"
  | "LEGACY_GREGORIAN";

/**
 * Aggregate types configured in Admin → Operational Settings.
 */
export interface AggregateType {
  id: string;
  name: string;
  pricePerM3: number;
  description: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A quantity belonging to an aggregate type.
 *
 * aggregateTypeId is null for historical records that used the old
 * fixed aggregate codes and have not been mapped to an Admin aggregate type.
 */
export interface MonthlyInventoryQuantity {
  id?: string;
  aggregateTypeId: string | null;
  aggregateName: string;
  quantity: number;
  isLegacy: boolean;
}

/**
 * Data submitted by Finance.
 *
 * New reports must use aggregate type IDs. Legacy codes are only retained
 * when reading old reports.
 */
export interface MonthlyQuantityInput {
  aggregateTypeId: string;
  quantity: number;
}

export interface MonthlyInventoryReport {
  id: string;
  period: string;
  periodType?: MonthlyReportPeriodType;
  status: MonthlyReportStatus;
  quantities: MonthlyInventoryQuantity[];
  aggregateLines?: MonthlyInventoryQuantity[];
  remarks?: string | null;
  submittedAt?: number;
  submittedBy?: string | null;
  submittedByName?: string | null;
  revisionNumber: number;
  version: number;
  createdAt?: number;
  updatedAt?: number;
}

interface ApiAggregateType {
  id?: string | number;
  name?: string;
  price_per_m3?: number | string;
  pricePerM3?: number | string;
  description?: string | null;
  is_active?: boolean | string;
  isActive?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

interface ApiQuantity {
  id?: string;
  aggregateTypeId?: string | number | null;
  aggregate_type_id?: string | number | null;
  aggregateName?: string;
  aggregate_name?: string;
  aggregate?: string;
  quantity?: number | string;
  unsoldQuantity?: number | string;
  unsold_quantity?: number | string;
  isLegacy?: boolean;
  is_legacy?: boolean;
}

type ApiQuantities =
  | ApiQuantity[]
  | Partial<Record<string, number | string>>
  | null;

interface ApiReport {
  id?: string;
  period?: string;
  period_type?: MonthlyReportPeriodType;
  report_month?: string;
  status?: string;

  quantities?: ApiQuantities;
  aggregate_lines?: ApiQuantity[];

  aggregate_00?: number | string;
  aggregate_01?: number | string;
  aggregate_02?: number | string;

  remarks?: string | null;
  submitted_at?: string | null;
  submitted_by?: string | null;
  submitted_by_name?: string | null;
  revision_number?: number | string;
  version?: number | string;
  created_at?: string | null;
  updated_at?: string | null;
}

interface ApiResponse {
  success?: boolean;
  message?: string;

  report?: ApiReport | null;
  reports?: ApiReport[];

  aggregate_types?: ApiAggregateType[];
  aggregateTypes?: ApiAggregateType[];
  types?: ApiAggregateType[];

  data?: ApiReport | ApiReport[] | ApiAggregateType[] | null;
}

const API_BASE = (API_BASE_URL || HR_API_BASE_URL).replace(/\/+$/, "");

const ROOT = "/api/finance/monthly-inventory-reports";
const AGGREGATE_TYPES_ENDPOINT = `${ROOT}/aggregate-types`;

type Listener = () => void;

const listeners = new Set<Listener>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function getAccessToken(): string | null {
  const hrToken = getHrAuthToken();

  if (hrToken) {
    return hrToken;
  }

  if (typeof window === "undefined") {
    return null;
  }

  const stores = [window.sessionStorage, window.localStorage];

  const tokenKeys = [
    "access_token",
    "accessToken",
    "auth_token",
    "token",
    "nexerp.auth.token",
  ];

  for (const store of stores) {
    for (const key of tokenKeys) {
      const token = store.getItem(key);

      if (token?.trim()) {
        return token.trim();
      }
    }

    const sessionKeys = [
      "nexerp.auth.session.v1",
      "auth_session",
      "authSession",
    ];

    for (const key of sessionKeys) {
      const raw = store.getItem(key);

      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);

        const token =
          parsed.accessToken ??
          parsed.access_token ??
          parsed.token;

        if (typeof token === "string" && token.trim()) {
          return token.trim();
        }
      } catch {
        // Ignore session values that are not JSON.
      }
    }
  }

  return null;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!API_BASE) {
    throw new Error(
      "API base URL is missing. Check VITE_API_BASE_URL in your frontend configuration.",
    );
  }

  const token = getAccessToken();

  if (!token) {
    throw new Error(
      "Your authentication token was not found. Sign in again, then retry.",
    );
  }

  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);

  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      "Could not connect to the backend. Check the API URL, server status, and network connection.",
    );
  }

  const raw = await response.text();

  let body: ApiResponse | null = null;

  if (raw) {
    try {
      body = JSON.parse(raw) as ApiResponse;
    } catch {
      throw new Error(
        `The backend returned an invalid response (HTTP ${response.status}).`,
      );
    }
  }

  if (!response.ok || body?.success === false) {
    throw new Error(
      body?.message ||
        `Monthly inventory API request failed (HTTP ${response.status}).`,
    );
  }

  return (body ?? {}) as T;
}

function toMillis(value?: string | null): number | undefined {
  if (!value) return undefined;

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return value === "1" || value === 1 || value === "true";
}

function mapAggregateType(raw: ApiAggregateType): AggregateType {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    pricePerM3: Number(raw.price_per_m3 ?? raw.pricePerM3 ?? 0),
    description: String(raw.description ?? ""),
    isActive: toBoolean(raw.is_active ?? raw.isActive),
    createdAt: raw.created_at ?? undefined,
    updatedAt: raw.updated_at ?? undefined,
  };
}

function mapApiQuantity(raw: ApiQuantity): MonthlyInventoryQuantity {
  const aggregateTypeId =
    raw.aggregateTypeId ?? raw.aggregate_type_id ?? null;

  const quantity =
    raw.quantity ??
    raw.unsoldQuantity ??
    raw.unsold_quantity ??
    0;

  const aggregateName =
    raw.aggregateName ??
    raw.aggregate_name ??
    raw.aggregate ??
    "Unknown aggregate";

  return {
    id: raw.id,
    aggregateTypeId:
      aggregateTypeId === null || aggregateTypeId === undefined
        ? null
        : String(aggregateTypeId),
    aggregateName: String(aggregateName),
    quantity: Number(quantity),
    isLegacy:
      raw.isLegacy ??
      raw.is_legacy ??
      (aggregateTypeId === null ||
        aggregateTypeId === undefined),
  };
}

/**
 * Converts old fixed-code quantities into historical quantity lines.
 *
 * These records deliberately have no aggregate type ID because the old
 * codes cannot safely be assumed to match current Admin aggregate types.
 */
function mapLegacyQuantities(raw: ApiReport): MonthlyInventoryQuantity[] {
  const quantities = raw.quantities;

  if (quantities && !Array.isArray(quantities)) {
    return [
      {
        aggregateTypeId: null,
        aggregateName: "00",
        quantity: Number(quantities["00"] ?? raw.aggregate_00 ?? 0),
        isLegacy: true,
      },
      {
        aggregateTypeId: null,
        aggregateName: "01",
        quantity: Number(quantities["01"] ?? raw.aggregate_01 ?? 0),
        isLegacy: true,
      },
      {
        aggregateTypeId: null,
        aggregateName: "02",
        quantity: Number(quantities["02"] ?? raw.aggregate_02 ?? 0),
        isLegacy: true,
      },
    ];
  }

  return [
    {
      aggregateTypeId: null,
      aggregateName: "00",
      quantity: Number(raw.aggregate_00 ?? 0),
      isLegacy: true,
    },
    {
      aggregateTypeId: null,
      aggregateName: "01",
      quantity: Number(raw.aggregate_01 ?? 0),
      isLegacy: true,
    },
    {
      aggregateTypeId: null,
      aggregateName: "02",
      quantity: Number(raw.aggregate_02 ?? 0),
      isLegacy: true,
    },
  ];
}

function mapReport(raw: ApiReport): MonthlyInventoryReport {
  const period =
    raw.period ||
    (raw.report_month ? raw.report_month.slice(0, 7) : "");

  if (!period) {
    throw new Error(
      "The backend returned a monthly report without a reporting period.",
    );
  }

  const status =
    String(raw.status ?? "DRAFT").toUpperCase() === "SUBMITTED"
      ? MONTHLY_REPORT_STATUS.SUBMITTED
      : MONTHLY_REPORT_STATUS.DRAFT;

  let quantities: MonthlyInventoryQuantity[];

  if (Array.isArray(raw.quantities)) {
    quantities = raw.quantities.map(mapApiQuantity);
  } else if (Array.isArray(raw.aggregate_lines)) {
    quantities = raw.aggregate_lines.map(mapApiQuantity);
  } else {
    quantities = mapLegacyQuantities(raw);
  }

  return {
    id: String(raw.id ?? period),
    period,
    periodType: raw.period_type,
    status,
    quantities,
    aggregateLines: quantities,
    remarks: raw.remarks ?? "",
    submittedAt: toMillis(raw.submitted_at),
    submittedBy: raw.submitted_by ?? null,
    submittedByName: raw.submitted_by_name ?? null,
    revisionNumber: Number(raw.revision_number ?? 0),
    version: Number(raw.version ?? 1),
    createdAt: toMillis(raw.created_at),
    updatedAt: toMillis(raw.updated_at),
  };
}

function extractReports(response: ApiResponse): ApiReport[] {
  if (Array.isArray(response.reports)) {
    return response.reports;
  }

  if (Array.isArray(response.data)) {
    return response.data as ApiReport[];
  }

  if (response.report) {
    return [response.report];
  }

  if (
    response.data &&
    !Array.isArray(response.data) &&
    typeof response.data === "object" &&
    "period" in response.data
  ) {
    return [response.data as ApiReport];
  }

  return [];
}

function extractSingleReport(
  response: ApiResponse,
): ApiReport | null {
  if (response.report) {
    return response.report;
  }

  if (
    response.data &&
    !Array.isArray(response.data) &&
    typeof response.data === "object" &&
    "period" in response.data
  ) {
    return response.data as ApiReport;
  }

  return null;
}

function validatePeriod(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-3])$/.test(period)) {
    throw new Error(
      "Invalid Ethiopian reporting period. Expected YYYY-MM with month 01-13.",
    );
  }
}

function normalizeQuantities(
  quantities: MonthlyQuantityInput[],
): MonthlyQuantityInput[] {
  if (!Array.isArray(quantities)) {
    throw new Error("Aggregate quantities must be provided as a list.");
  }

  const seen = new Set<string>();

  return quantities.map((item) => {
    const aggregateTypeId = String(item.aggregateTypeId ?? "").trim();
    const quantity = Number(item.quantity);

    if (!/^\d+$/.test(aggregateTypeId)) {
      throw new Error("Every quantity must have a valid aggregate type ID.");
    }

    if (seen.has(aggregateTypeId)) {
      throw new Error(
        `Aggregate type ${aggregateTypeId} was provided more than once.`,
      );
    }

    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(
        `Aggregate type ${aggregateTypeId} must have a valid non-negative quantity.`,
      );
    }

    seen.add(aggregateTypeId);

    return {
      aggregateTypeId,
      quantity,
    };
  });
}

function makePayload(
  period: string,
  quantities: MonthlyQuantityInput[],
  remarks: string,
) {
  validatePeriod(period);

  const normalized = normalizeQuantities(quantities);

  if (remarks.length > 500) {
    throw new Error("Remarks cannot exceed 500 characters.");
  }

  return {
    period,
    quantities: normalized,
    remarks: remarks.trim(),
  };
}

/**
 * Retrieves aggregate types available to Finance.
 *
 * The backend endpoint should return active aggregate types only.
 */
async function getAggregateTypes(): Promise<AggregateType[]> {
  const response = await request<ApiResponse>(
    AGGREGATE_TYPES_ENDPOINT,
  );

  const rawTypes =
    response.aggregate_types ??
    response.aggregateTypes ??
    response.types ??
    (Array.isArray(response.data)
      ? (response.data as ApiAggregateType[])
      : []);

  return rawTypes
    .map(mapAggregateType)
    .filter((type) => type.id && type.isActive)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

async function getReports(): Promise<MonthlyInventoryReport[]> {
  const response = await request<ApiResponse>(ROOT);

  return extractReports(response)
    .map(mapReport)
    .sort((a, b) => b.period.localeCompare(a.period));
}

async function getReport(
  period: string,
): Promise<MonthlyInventoryReport | null> {
  validatePeriod(period);

  const response = await request<ApiResponse>(
    `${ROOT}/${encodeURIComponent(period)}`,
  );

  const raw = extractSingleReport(response);

  return raw ? mapReport(raw) : null;
}

async function saveDraft(
  period: string,
  quantities: MonthlyQuantityInput[],
  remarks: string,
): Promise<MonthlyInventoryReport | null> {
  const payload = makePayload(period, quantities, remarks);

  const response = await request<ApiResponse>(`${ROOT}/draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  notifyListeners();

  const raw = extractSingleReport(response);

  return raw ? mapReport(raw) : getReport(period);
}

async function submitReport(
  period: string,
  quantities: MonthlyQuantityInput[],
  remarks: string,
): Promise<MonthlyInventoryReport | null> {
  const payload = makePayload(period, quantities, remarks);

  const response = await request<ApiResponse>(`${ROOT}/submit`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  notifyListeners();

  const raw = extractSingleReport(response);

  return raw ? mapReport(raw) : getReport(period);
}

async function correctSubmittedReport(
  period: string,
  quantities: MonthlyQuantityInput[],
  remarks: string,
): Promise<MonthlyInventoryReport | null> {
  const payload = makePayload(period, quantities, remarks);

  const response = await request<ApiResponse>(`${ROOT}/correct`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  notifyListeners();

  const raw = extractSingleReport(response);

  return raw ? mapReport(raw) : getReport(period);
}

async function getSubmittedReports(): Promise<MonthlyInventoryReport[]> {
  const reports = await getReports();

  return reports.filter(
    (report) => report.status === MONTHLY_REPORT_STATUS.SUBMITTED,
  );
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export const monthlyInventoryReportsRepository = {
  getAggregateTypes,
  getReports,
  getReport,
  getSubmittedReports,
  saveDraft,
  submitReport,
  correctSubmittedReport,
  subscribe,
};

/**
 * Ethiopian reporting periods begin with Tikimt 2019.
 * The current period is determined using the Ethiopian calendar.
 */
export function listEligiblePeriods(): string[] {
  const startYear = 2019;
  const startMonth = 2;

  const formatter = new Intl.DateTimeFormat(
    "en-US-u-ca-ethiopic-nu-latn",
    {
      year: "numeric",
      month: "numeric",
    },
  );

  const parts = formatter.formatToParts(new Date());

  const currentYear = Number(
    parts.find((part) => part.type === "year")?.value,
  );

  const currentMonth = Number(
    parts.find((part) => part.type === "month")?.value,
  );

  if (
    !Number.isFinite(currentYear) ||
    !Number.isFinite(currentMonth) ||
    currentMonth < 1 ||
    currentMonth > 13
  ) {
    throw new Error("Unable to determine the current Ethiopian month.");
  }

  const periods: string[] = [];

  let year = startYear;
  let month = startMonth;

  while (
    year < currentYear ||
    (year === currentYear && month <= currentMonth)
  ) {
    periods.push(`${year}-${String(month).padStart(2, "0")}`);

    month++;

    if (month > 13) {
      month = 1;
      year++;
    }
  }

  return periods.reverse();
}

/**
 * Returns the English transliterated Ethiopian month name.
 */
export function periodLabel(period: string): string {
  validatePeriod(period);

  const [year, month] = period.split("-").map(Number);

  const months = [
    "Meskerem",
    "Tikimt",
    "Hidar",
    "Tahsas",
    "Tir",
    "Yekatit",
    "Megabit",
    "Miazia",
    "Ginbot",
    "Sene",
    "Hamle",
    "Nehase",
    "Pagume",
  ];

  return `${months[month - 1]} ${year}`;
}

export function validateQuantitiesForSubmit(
  quantities: MonthlyQuantityInput[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(quantities) || quantities.length === 0) {
    return {
      valid: false,
      errors: ["At least one aggregate quantity is required."],
    };
  }

  const seen = new Set<string>();

  for (const item of quantities) {
    const id = String(item.aggregateTypeId ?? "").trim();
    const value = Number(item.quantity);

    if (!/^\d+$/.test(id)) {
      errors.push("Every aggregate must have a valid aggregate type ID.");
      continue;
    }

    if (seen.has(id)) {
      errors.push(`Aggregate type ${id} appears more than once.`);
      continue;
    }

    seen.add(id);

    if (!Number.isFinite(value) || value < 0) {
      errors.push(
        `Aggregate type ${id} must have a valid non-negative quantity.`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
