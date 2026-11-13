
import { HR_API_BASE_URL } from "@/lib/api/config";
import { getHrAuthToken } from "@/services/hr/apiClient";

/* -------------------------------------------------------------------------- */
/*                                   TYPES                                    */
/* -------------------------------------------------------------------------- */

export type AttendanceImportType = "DAILY" | "MONTHLY";

export type AttendanceImportStatus =
  | "PREVIEW"
  | "APPROVED"
  | "CANCELLED";

/**
 * Attendance supports only PRESENT and ABSENT.
 * LATE and LEAVE have been removed.
 */
export type AttendanceImportAttendanceStatus = "PRESENT" | "ABSENT";

export interface AttendanceImportSourceRow {
  row_number: number;
  machine_employee_no: string;
  employee_name?: string;
  attendance_date: string;
  clock_in: string | null;
  clock_out: string | null;
  work_minutes: number;
  overtime_minutes: number;
  raw_data: Record<string, unknown>;
  warnings: string[];
}

export interface AttendanceImportPreviewRequest {
  import_type: AttendanceImportType;
  start_date: string;
  end_date: string;
  original_filename: string;
  rows: AttendanceImportSourceRow[];
}

export interface AttendanceImportInfo {
  id: string;
  original_filename: string;
  import_type: AttendanceImportType;
  start_date: string;
  end_date: string;
  status: AttendanceImportStatus;
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  warning_rows: number;
  created_at?: string;
  approved_at?: string | null;
}

export interface AttendanceImportRow {
  id: string;
  row_number: number;
  machine_employee_no: string;
  employee_id: string | null;
  employee_name: string | null;
  attendance_date: string;
  clock_in: string | null;
  clock_out: string | null;
  work_minutes: number;
  overtime_minutes: number;
  proposed_status: AttendanceImportAttendanceStatus;
  final_status: AttendanceImportAttendanceStatus;
  warnings: string[];
  correction_reason: string;
}

export interface AttendanceImportRowsUpdate {
  rows: Array<{
    id: string;
    final_status: AttendanceImportAttendanceStatus;
    clock_in: string | null;
    clock_out: string | null;
    work_minutes: number;
    overtime_minutes: number;
    correction_reason: string;
  }>;
}

export interface AttendanceImportListItem extends AttendanceImportInfo {}

interface ApiEnvelope<T> {
  data: T;
  message?: string;
}

/* -------------------------------------------------------------------------- */
/*                               API HELPERS                                  */
/* -------------------------------------------------------------------------- */

function getApiUrl(path: string): string {
  const base = HR_API_BASE_URL.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");

  return `${base}/${cleanPath}`;
}

async function importApiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getHrAuthToken();

  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(getApiUrl(path), {
    ...options,
    headers,
  });

  const responseText = await response.text();

  let result: unknown = null;

  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(
        `The server returned an invalid response (${response.status}).`,
      );
    }
  }

  if (!response.ok) {
    const errorData = result as {
      message?: string;
      error?: string;
      messages?: Record<string, string>;
    } | null;

    const validationMessages = errorData?.messages
      ? Object.values(errorData.messages).join(", ")
      : "";

    throw new Error(
      validationMessages ||
        errorData?.message ||
        errorData?.error ||
        `Request failed with status ${response.status}.`,
    );
  }

  return result as T;
}

/* -------------------------------------------------------------------------- */
/*                             RESPONSE HELPERS                               */
/* -------------------------------------------------------------------------- */

function unwrap<T>(response: ApiEnvelope<T> | T): T {
  if (
    response &&
    typeof response === "object" &&
    "data" in response
  ) {
    return (response as ApiEnvelope<T>).data;
  }

  return response as T;
}

/* -------------------------------------------------------------------------- */
/*                              PREVIEW IMPORT                                */
/* -------------------------------------------------------------------------- */

export async function previewAttendanceImport(
  payload: AttendanceImportPreviewRequest,
): Promise<{
  data: {
    import: AttendanceImportInfo;
    rows: AttendanceImportRow[];
  };
}> {
  const response = await importApiFetch<
    ApiEnvelope<{
      import: AttendanceImportInfo;
      rows: AttendanceImportRow[];
    }>
  >("/api/attendance/import/preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return {
    data: unwrap(response),
  };
}

/* -------------------------------------------------------------------------- */
/*                              IMPORT HISTORY                                */
/* -------------------------------------------------------------------------- */

export async function getAttendanceImports(): Promise<{
  data: AttendanceImportListItem[];
}> {
  const response = await importApiFetch<
    ApiEnvelope<
      | AttendanceImportListItem[]
      | {
          imports: AttendanceImportListItem[];
        }
    >
  >("/api/attendance/imports");

  const data = unwrap(response);

  return {
    data: Array.isArray(data) ? data : data.imports ?? [],
  };
}

/* -------------------------------------------------------------------------- */
/*                               SINGLE IMPORT                                */
/* -------------------------------------------------------------------------- */

export async function getAttendanceImport(
  importId: string,
): Promise<{
  data: {
    import: AttendanceImportInfo;
    rows: AttendanceImportRow[];
  };
}> {
  const response = await importApiFetch<
    ApiEnvelope<{
      import: AttendanceImportInfo;
      rows: AttendanceImportRow[];
    }>
  >(`/api/attendance/import/${encodeURIComponent(importId)}`);

  return {
    data: unwrap(response),
  };
}

/* -------------------------------------------------------------------------- */
/*                                UPDATE ROWS                                 */
/* -------------------------------------------------------------------------- */

export async function updateAttendanceImportRows(
  importId: string,
  payload: AttendanceImportRowsUpdate,
): Promise<unknown> {
  return importApiFetch(
    `/api/attendance/import/${encodeURIComponent(importId)}/rows`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

/* -------------------------------------------------------------------------- */
/*                               APPROVE IMPORT                               */
/* -------------------------------------------------------------------------- */

export async function approveAttendanceImport(
  importId: string,
): Promise<unknown> {
  return importApiFetch(
    `/api/attendance/import/${encodeURIComponent(importId)}/approve`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

/* -------------------------------------------------------------------------- */
/*                                CANCEL IMPORT                               */
/* -------------------------------------------------------------------------- */

export async function cancelAttendanceImport(
  importId: string,
): Promise<unknown> {
  return importApiFetch(
    `/api/attendance/import/${encodeURIComponent(importId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}
