
/**
 * HR API Client
 * React/Vite frontend -> CodeIgniter 4 backend -> PostgreSQL
 *
 * Real API is used by default.
 * Mock data is used only when explicitly selected.
 */

import type {
  ApiResponse,
  AttendanceInput,
  AttendanceQueryParams,
  AttendanceRecord,
  Employee,
  EmployeeInput,
  EmployeeQueryParams,
  HRDashboard,
  LeaveRequest,
  LeaveRequestInput,
} from "./types";

import { getMockData } from "./mockData";
import { HR_API_BASE_URL } from "@/lib/api/config";
import { authRepository } from "@/services/auth/authRepository";

const API_BASE = HR_API_BASE_URL.replace(/\/+$/, "");

/* ------------------------------------------------------------------ */
/* Authentication token                                                */
/* ------------------------------------------------------------------ */

let _token: string | null = null;

export function setHrAuthToken(token: string | null): void {
  _token = token;
}

export function getHrAuthToken(): string | null {
  const session = authRepository.getSession();

  return session?.token ?? _token ?? null;
}

/* ------------------------------------------------------------------ */
/* HTTP helper                                                          */
/* ------------------------------------------------------------------ */

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  headers.set("Accept", "application/json");

  // Let the browser generate the multipart boundary for FormData.
  if (
    options.body !== undefined &&
    !(options.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }

  const token = getHrAuthToken();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    headers.delete("Authorization");
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Network error";

    throw new Error(
      `Cannot connect to the backend at ${API_BASE}. ${detail}`,
    );
  }

  const responseText = await response.text();

  let body: unknown;

  if (responseText.trim()) {
    try {
      body = JSON.parse(responseText);
    } catch {
      if (response.ok) {
        throw new Error(
          `The backend returned invalid JSON for ${path}.`,
        );
      }

      throw new Error(
        `Backend HTTP ${response.status}: ${responseText}`,
      );
    }
  }

  if (!response.ok) {
    const parsed =
      body && typeof body === "object"
        ? (body as Record<string, unknown>)
        : {};

    const errors = parsed.errors;

    let message = String(
      parsed.message ??
        parsed.title ??
        `HTTP ${response.status} ${response.statusText}`,
    );

    if (errors && typeof errors === "object") {
      const details = Object.values(
        errors as Record<string, unknown>,
      )
        .map(String)
        .join(" ");

      if (details) {
        message += ` ${details}`;
      }
    }

    throw new Error(message);
  }

  if (response.status === 204 || !responseText.trim()) {
    return undefined as T;
  }

  return body as T;
}

/* ------------------------------------------------------------------ */
/* Response helpers                                                     */
/* ------------------------------------------------------------------ */

function unwrapData<T>(response: unknown): T {
  if (
    response !== null &&
    typeof response === "object" &&
    "data" in response
  ) {
    return (response as { data: T }).data;
  }

  return response as T;
}

function requireObject(
  raw: unknown,
  description: string,
): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    throw new Error(
      `The backend returned an invalid ${description}.`,
    );
  }

  return raw as Record<string, unknown>;
}

function requireArray<T>(
  raw: unknown,
  description: string,
): T[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      `The backend did not return a valid ${description} list.`,
    );
  }

  return raw as T[];
}

/* ------------------------------------------------------------------ */
/* Employee normalization                                               */
/* ------------------------------------------------------------------ */

function normalizeEmployee(raw: unknown): Employee {
  const employee = requireObject(raw, "employee");
  const active = employee.is_active;

  let isActive: boolean;

  if (typeof active === "boolean") {
    isActive = active;
  } else if (
    active === 1 ||
    active === "1" ||
    active === "t" ||
    active === "true"
  ) {
    isActive = true;
  } else if (
    active === 0 ||
    active === "0" ||
    active === "f" ||
    active === "false"
  ) {
    isActive = false;
  } else {
    isActive = Boolean(active);
  }

  const salary = Number(employee.salary ?? 0);

  if (!Number.isFinite(salary)) {
    throw new Error(
      "The backend returned an invalid employee salary.",
    );
  }

  return {
    ...employee,
    is_active: isActive,
    salary,
    machine_employee_no:
      employee.machine_employee_no == null
        ? null
        : String(employee.machine_employee_no),
    photos: Array.isArray(employee.photos)
      ? employee.photos
      : [],
  } as unknown as Employee;
}

function normalizeEmployees(raw: unknown): Employee[] {
  return requireArray(raw, "employee").map(normalizeEmployee);
}

/* ------------------------------------------------------------------ */
/* Employee multipart form data                                        */
/* ------------------------------------------------------------------ */

type EmployeeUploadInput = EmployeeInput & {
  photos?: File[];
};

function buildEmployeeFormData(
  input: EmployeeInput,
): FormData {
  const employeeInput = input as EmployeeUploadInput;
  const formData = new FormData();

  const fields: (keyof EmployeeInput)[] = [
    "machine_employee_no",
    "full_name",
    "phone",
    "position",
    "hired_date",
    "emergency_contact_name",
    "emergency_phone",
    "salary",
  ];

  for (const field of fields) {
    const value = employeeInput[field];

    if (value === undefined || value === null) {
      continue;
    }

    formData.append(field, String(value));
  }

  // Multiple images are sent using the same multipart field name.
  for (const photo of employeeInput.photos ?? []) {
    if (photo instanceof File) {
      formData.append("photos[]", photo, photo.name);
    }
  }

  return formData;
}

/* ------------------------------------------------------------------ */
/* Attendance normalization                                             */
/* ------------------------------------------------------------------ */

function normalizeAttendance(raw: unknown): AttendanceRecord {
  const record = requireObject(raw, "attendance record");

  const overtime = Number(record.overtime_hours ?? 0);

  if (!Number.isFinite(overtime)) {
    throw new Error(
      "The backend returned an invalid attendance overtime value.",
    );
  }

  const attendanceId = String(record.attendance_id ?? "");
  const employeeId = String(record.employee_id ?? "");
  const attendanceDate = String(record.attendance_date ?? "");
  const status = String(
    record.status ?? "PRESENT",
  ).toUpperCase();

  if (!attendanceId) {
    throw new Error(
      "The backend attendance response is missing attendance_id.",
    );
  }

  return {
    ...record,
    attendance_id: attendanceId,
    employee_id: employeeId,
    attendance_date: attendanceDate,
    status,
    overtime_hours: overtime,
    note: String(record.note ?? ""),
  } as unknown as AttendanceRecord;
}

function normalizeAttendanceRecords(
  raw: unknown,
): AttendanceRecord[] {
  return requireArray(raw, "attendance").map(normalizeAttendance);
}

/* ------------------------------------------------------------------ */
/* Leave request normalization                                          */
/* ------------------------------------------------------------------ */

function normalizeLeaveRequest(raw: unknown): LeaveRequest {
  const record = requireObject(raw, "leave request");

  const leaveId = String(record.leave_id ?? "");
  const employeeId = String(record.employee_id ?? "");
  const type = String(record.type ?? record.leave_type ?? "");
  const startDate = String(record.start_date ?? "");
  const endDate = String(record.end_date ?? "");
  const reason = String(record.reason ?? "");
  const status = String(record.status ?? "PENDING").toUpperCase();

  if (!leaveId) {
    throw new Error(
      "The backend leave response is missing leave_id.",
    );
  }

  if (!employeeId) {
    throw new Error(
      `Leave request ${leaveId} is missing employee_id.`,
    );
  }

  return {
    ...record,
    leave_id: leaveId,
    employee_id: employeeId,
    type,
    start_date: startDate,
    end_date: endDate,
    reason,
    status,
    created_date: String(
      record.created_date ?? record.created_at ?? "",
    ),
    reviewed_by:
      record.reviewed_by == null
        ? undefined
        : String(record.reviewed_by),
    reviewed_date:
      record.reviewed_date == null &&
      record.reviewed_at == null
        ? undefined
        : String(record.reviewed_date ?? record.reviewed_at),
    rejection_reason:
      record.rejection_reason == null
        ? undefined
        : String(record.rejection_reason),
  } as unknown as LeaveRequest;
}

function normalizeLeaveRequests(
  raw: unknown,
): LeaveRequest[] {
  return requireArray(raw, "leave request").map(
    normalizeLeaveRequest,
  );
}

/* ------------------------------------------------------------------ */
/* API interface                                                        */
/* ------------------------------------------------------------------ */

export interface HRApiClient {
  getDashboard(): Promise<HRDashboard>;

  getEmployees(params?: EmployeeQueryParams): Promise<Employee[]>;
  getEmployeeById(id: string): Promise<Employee | null>;
  createEmployee(input: EmployeeInput): Promise<Employee>;
  updateEmployee(id: string, input: EmployeeInput): Promise<Employee>;
  setEmployeeStatus(id: string, isActive: boolean): Promise<Employee>;

  getAttendance(
    params?: AttendanceQueryParams,
  ): Promise<AttendanceRecord[]>;

  getAttendanceById(id: string): Promise<AttendanceRecord | null>;
  createAttendance(input: AttendanceInput): Promise<AttendanceRecord>;

  updateAttendance(
    id: string,
    input: AttendanceInput,
  ): Promise<AttendanceRecord>;

  deleteAttendance(id: string): Promise<void>;

  getLeaveRequests(): Promise<LeaveRequest[]>;

  createLeaveRequest(
    input: LeaveRequestInput,
  ): Promise<LeaveRequest>;

  approveLeaveRequest(id: string): Promise<LeaveRequest>;

  rejectLeaveRequest(
    id: string,
    reason: string,
  ): Promise<LeaveRequest>;
}

/* ------------------------------------------------------------------ */
/* Live CodeIgniter API client                                          */
/* ------------------------------------------------------------------ */

class LiveHRApiClient implements HRApiClient {
  /* Dashboard */

  async getDashboard(): Promise<HRDashboard> {
    const response = await apiFetch<
      HRDashboard | ApiResponse<HRDashboard>
    >("/api/hr/dashboard");

    return unwrapData<HRDashboard>(response);
  }

  /* Employees */

  async getEmployees(
    params?: EmployeeQueryParams,
  ): Promise<Employee[]> {
    const query = new URLSearchParams();

    if (params?.search) query.set("search", params.search);
    if (params?.status) query.set("status", params.status);
    if (params?.position) query.set("position", params.position);

    const qs = query.toString();

    const response = await apiFetch<unknown>(
      `/api/employees${qs ? `?${qs}` : ""}`,
    );

    return normalizeEmployees(unwrapData<unknown>(response));
  }

  async getEmployeeById(
    id: string,
  ): Promise<Employee | null> {
    try {
      const response = await apiFetch<unknown>(
        `/api/employees/${encodeURIComponent(id)}`,
      );

      const data = unwrapData<unknown>(response);

      return data ? normalizeEmployee(data) : null;
    } catch (error) {
      if (error instanceof Error && /\b404\b/.test(error.message)) {
        return null;
      }

      throw error;
    }
  }

  async createEmployee(input: EmployeeInput): Promise<Employee> {
    const formData = buildEmployeeFormData(input);

    const response = await apiFetch<unknown>("/api/employees", {
      method: "POST",
      body: formData,
    });

    return normalizeEmployee(unwrapData<unknown>(response));
  }

  async updateEmployee(
    id: string,
    input: EmployeeInput,
  ): Promise<Employee> {
    const response = await apiFetch<unknown>(
      `/api/employees/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify(input),
      },
    );

    return normalizeEmployee(unwrapData<unknown>(response));
  }

  async setEmployeeStatus(
    id: string,
    isActive: boolean,
  ): Promise<Employee> {
    const response = await apiFetch<unknown>(
      `/api/employees/${encodeURIComponent(id)}/status`,
      {
        method: "PUT",
        body: JSON.stringify({ is_active: isActive }),
      },
    );

    return normalizeEmployee(unwrapData<unknown>(response));
  }

  /* Attendance */

  async getAttendance(
    params?: AttendanceQueryParams,
  ): Promise<AttendanceRecord[]> {
    const query = new URLSearchParams();

    if (params?.employee_id) {
      query.set("employee_id", params.employee_id);
    }

    if (params?.date) query.set("date", params.date);

    if (params?.start_date) {
      query.set("start_date", params.start_date);
    }

    if (params?.end_date) {
      query.set("end_date", params.end_date);
    }

    const qs = query.toString();

    const response = await apiFetch<unknown>(
      `/api/attendance${qs ? `?${qs}` : ""}`,
    );

    return normalizeAttendanceRecords(
      unwrapData<unknown>(response),
    );
  }

  async getAttendanceById(
    id: string,
  ): Promise<AttendanceRecord | null> {
    try {
      const response = await apiFetch<unknown>(
        `/api/attendance/${encodeURIComponent(id)}`,
      );

      const data = unwrapData<unknown>(response);

      return data ? normalizeAttendance(data) : null;
    } catch (error) {
      if (error instanceof Error && /\b404\b/.test(error.message)) {
        return null;
      }

      throw error;
    }
  }

  async createAttendance(
    input: AttendanceInput,
  ): Promise<AttendanceRecord> {
    const payload = {
      employee_id: input.employee_id,
      attendance_date: input.attendance_date,
      status: String(input.status).toUpperCase(),
      overtime_hours: Number(input.overtime_hours ?? 0),
      note: input.note ?? "",
    };

    const response = await apiFetch<unknown>("/api/attendance", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return normalizeAttendance(unwrapData<unknown>(response));
  }

  async updateAttendance(
    id: string,
    input: AttendanceInput,
  ): Promise<AttendanceRecord> {
    const payload = {
      employee_id: input.employee_id,
      attendance_date: input.attendance_date,
      status: String(input.status).toUpperCase(),
      overtime_hours: Number(input.overtime_hours ?? 0),
      note: input.note ?? "",
    };

    const response = await apiFetch<unknown>(
      `/api/attendance/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );

    return normalizeAttendance(unwrapData<unknown>(response));
  }

  async deleteAttendance(id: string): Promise<void> {
    await apiFetch<unknown>(
      `/api/attendance/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  /* Leave requests */

  async getLeaveRequests(): Promise<LeaveRequest[]> {
    const response = await apiFetch<unknown>(
      "/api/leave-requests",
    );

    return normalizeLeaveRequests(unwrapData<unknown>(response));
  }

  async createLeaveRequest(
    input: LeaveRequestInput,
  ): Promise<LeaveRequest> {
    const payload = {
      employee_id: input.employee_id,
      type: input.type,
      start_date: input.start_date,
      end_date: input.end_date,
      reason: input.reason,
    };

    const response = await apiFetch<unknown>(
      "/api/leave-requests",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    return normalizeLeaveRequest(unwrapData<unknown>(response));
  }

  async approveLeaveRequest(
    id: string,
  ): Promise<LeaveRequest> {
    const response = await apiFetch<unknown>(
      `/api/leave-requests/${encodeURIComponent(id)}/approve`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );

    return normalizeLeaveRequest(unwrapData<unknown>(response));
  }

  async rejectLeaveRequest(
    id: string,
    reason: string,
  ): Promise<LeaveRequest> {
    const response = await apiFetch<unknown>(
      `/api/leave-requests/${encodeURIComponent(id)}/reject`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    );

    return normalizeLeaveRequest(unwrapData<unknown>(response));
  }
}

/* ------------------------------------------------------------------ */
/* Explicit mock client                                                 */
/* ------------------------------------------------------------------ */

class MockHRApiClient implements HRApiClient {
  private mock = getMockData();

  async getDashboard(): Promise<HRDashboard> {
    const today = new Date().toISOString().slice(0, 10);

    const records = this.mock.attendance.filter(
      (item) => item.attendance_date === today,
    );

    return {
      totalEmployees: this.mock.employees.length,
      activeEmployees: this.mock.employees.filter(
        (item) => item.is_active,
      ).length,
      inactiveEmployees: this.mock.employees.filter(
        (item) => !item.is_active,
      ).length,
      presentToday: records.filter(
        (item) => item.status === "PRESENT",
      ).length,
      absentToday: records.filter(
        (item) => item.status === "ABSENT",
      ).length,
      lateToday: records.filter(
        (item) => item.status === "LATE",
      ).length,
      onLeave: records.filter(
        (item) => item.status === "LEAVE",
      ).length,
      pendingLeaveRequests: 0,
      currentPayrollStatus: "Processing",
    };
  }

  async getEmployees(
    params?: EmployeeQueryParams,
  ): Promise<Employee[]> {
    let result = [...this.mock.employees];

    if (params?.search) {
      const search = params.search.toLowerCase();

      result = result.filter(
        (item) =>
          item.full_name.toLowerCase().includes(search) ||
          item.employee_id.toLowerCase().includes(search) ||
          item.position.toLowerCase().includes(search) ||
          item.phone.includes(search),
      );
    }

    if (params?.status) {
      const active = params.status.toLowerCase() === "active";

      result = result.filter(
        (item) => item.is_active === active,
      );
    }

    if (params?.position) {
      const position = params.position.toLowerCase();

      result = result.filter((item) =>
        item.position.toLowerCase().includes(position),
      );
    }

    return result;
  }

  async getEmployeeById(id: string): Promise<Employee | null> {
    return (
      this.mock.employees.find(
        (item) =>
          item.employee_id === id ||
          (item as Employee & { id?: string }).id === id,
      ) ?? null
    );
  }

  async createEmployee(input: EmployeeInput): Promise<Employee> {
    const employee = {
      ...input,
      employee_id: `EMP-${String(
        this.mock.employees.length + 1,
      ).padStart(6, "0")}`,
      is_active: true,
    } as Employee;

    this.mock.employees.push(employee);

    return employee;
  }

  async updateEmployee(
    id: string,
    input: EmployeeInput,
  ): Promise<Employee> {
    const index = this.mock.employees.findIndex(
      (item) =>
        item.employee_id === id ||
        (item as Employee & { id?: string }).id === id,
    );

    if (index < 0) throw new Error("Employee not found.");

    this.mock.employees[index] = {
      ...this.mock.employees[index],
      ...input,
    } as Employee;

    return this.mock.employees[index];
  }

  async setEmployeeStatus(
    id: string,
    isActive: boolean,
  ): Promise<Employee> {
    const index = this.mock.employees.findIndex(
      (item) =>
        item.employee_id === id ||
        (item as Employee & { id?: string }).id === id,
    );

    if (index < 0) throw new Error("Employee not found.");

    this.mock.employees[index].is_active = isActive;

    return this.mock.employees[index];
  }

  async getAttendance(
    params?: AttendanceQueryParams,
  ): Promise<AttendanceRecord[]> {
    let result = [...this.mock.attendance];

    if (params?.employee_id) {
      result = result.filter(
        (item) => item.employee_id === params.employee_id,
      );
    }

    if (params?.date) {
      result = result.filter(
        (item) => item.attendance_date === params.date,
      );
    }

    if (params?.start_date) {
      result = result.filter(
        (item) => item.attendance_date >= params.start_date!,
      );
    }

    if (params?.end_date) {
      result = result.filter(
        (item) => item.attendance_date <= params.end_date!,
      );
    }

    return result.sort(
      (a, b) =>
        b.attendance_date.localeCompare(a.attendance_date),
    );
  }

  async getAttendanceById(
    id: string,
  ): Promise<AttendanceRecord | null> {
    return (
      this.mock.attendance.find(
        (item) => item.attendance_id === id,
      ) ?? null
    );
  }

  async createAttendance(
    input: AttendanceInput,
  ): Promise<AttendanceRecord> {
    const record = {
      ...input,
      attendance_id: `ATT-${String(
        this.mock.attendance.length + 1,
      ).padStart(6, "0")}`,
      overtime_hours: Number(input.overtime_hours ?? 0),
      note: input.note ?? "",
    } as AttendanceRecord;

    this.mock.attendance.push(record);

    return record;
  }

  async updateAttendance(
    id: string,
    input: AttendanceInput,
  ): Promise<AttendanceRecord> {
    const index = this.mock.attendance.findIndex(
      (item) => item.attendance_id === id,
    );

    if (index < 0) {
      throw new Error("Attendance record not found.");
    }

    this.mock.attendance[index] = {
      ...this.mock.attendance[index],
      ...input,
      overtime_hours: Number(input.overtime_hours ?? 0),
    };

    return this.mock.attendance[index];
  }

  async deleteAttendance(id: string): Promise<void> {
    this.mock.attendance = this.mock.attendance.filter(
      (item) => item.attendance_id !== id,
    );
  }

  /* Leave requests */

  async getLeaveRequests(): Promise<LeaveRequest[]> {
    throw new Error(
      "Leave requests are not implemented in the mock HR client. Use the live backend.",
    );
  }

  async createLeaveRequest(
    _input: LeaveRequestInput,
  ): Promise<LeaveRequest> {
    throw new Error(
      "Leave requests are not implemented in the mock HR client. Use the live backend.",
    );
  }

  async approveLeaveRequest(
    _id: string,
  ): Promise<LeaveRequest> {
    throw new Error(
      "Leave requests are not implemented in the mock HR client. Use the live backend.",
    );
  }

  async rejectLeaveRequest(
    _id: string,
    _reason: string,
  ): Promise<LeaveRequest> {
    throw new Error(
      "Leave requests are not implemented in the mock HR client. Use the live backend.",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Client selection                                                     */
/* ------------------------------------------------------------------ */

let _client: HRApiClient | null = null;

export async function getHRApiClient(): Promise<HRApiClient> {
  if (!_client) {
    _client = new LiveHRApiClient();
  }

  return _client;
}

export function useMockHRClient(): void {
  _client = new MockHRApiClient();
}

export function resetHRApiClient(): void {
  _client = null;
}

export { HR_API_BASE_URL };
