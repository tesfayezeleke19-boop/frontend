
/**
 * NexERP — HR data model.
 */

/* ------------------------------------------------------------------ */
/* Employees                                                           */
/* ------------------------------------------------------------------ */

export interface EmployeePhoto {
  id: string;
  file_name: string;
  storage_key: string;
  mime_type: string;
  file_size: number;
  created_at?: string;
}

export interface Employee {
  id?: string;
  employee_id: string;

  // Manually entered attendance machine employee number.
  machine_employee_no?: string | null;

  full_name: string;
  phone: string;
  position: string;
  hired_date: string;

  emergency_contact_name: string;
  emergency_phone: string;

  // Retained for compatibility with the existing attachments table.
  document_attachment_id?: string | null;
  document_photo?: string | null;

  // Multiple employee photos linked through employee_attachments.
  photos?: EmployeePhoto[];

  salary: number;
  is_active: boolean;

  created_at?: string;
  updated_at?: string;
}

export interface EmployeeInput {
  full_name: string;
  phone: string;
  position: string;
  hired_date: string;

  emergency_contact_name: string;
  emergency_phone: string;

  // Entered manually by HR.
  machine_employee_no?: string | null;

  document_attachment_id?: string | null;
  document_photo?: string | null;

  // New image files selected from the frontend.
  photos?: File[];

  salary: number;
  is_active?: boolean;
}

export interface EmployeeQueryParams {
  search?: string;
  status?: "active" | "inactive";
  position?: string;
}

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */

export const ATTENDANCE_STATUS = {
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
  LATE: "LATE",
  LEAVE: "LEAVE",
} as const;

export type AttendanceStatus =
  (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS];

export const ATTENDANCE_STATUS_LABELS: Record<
  AttendanceStatus,
  string
> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  LEAVE: "On Leave",
};

export type AttendanceSource = "MANUAL" | "ZKTECO";

export interface AttendanceRecord {
  id?: string;
  attendance_id: string;
  employee_id: string;
  employee_name?: string;
  attendance_date: string;
  status: AttendanceStatus;
  overtime_hours: number;
  overtime_minutes?: number;
  work_minutes?: number;
  clock_in?: string | null;
  clock_out?: string | null;
  source?: AttendanceSource;
  import_id?: string | null;
  correction_reason?: string;
  note: string;
  created_at?: string;
  updated_at?: string;
}

export interface AttendanceInput {
  employee_id: string;
  attendance_date: string;
  status: AttendanceStatus;
  overtime_hours: number;
  overtime_minutes?: number;
  work_minutes?: number;
  clock_in?: string | null;
  clock_out?: string | null;
  source?: AttendanceSource;
  correction_reason?: string;
  note: string;
}

export interface AttendanceQueryParams {
  employee_id?: string;
  date?: string;
  start_date?: string;
  end_date?: string;
  month?: string;
}

/* ------------------------------------------------------------------ */
/* Attendance import                                                   */
/* ------------------------------------------------------------------ */

export type AttendanceImportType = "DAILY" | "MONTHLY";

export type AttendanceImportStatus =
  | "PREVIEW"
  | "APPROVED"
  | "CANCELLED";

export interface AttendanceImportSourceRow {
  row_number: number;
  machine_employee_no: string;
  employee_name?: string;
  attendance_date: string;
  clock_in?: string | null;
  clock_out?: string | null;
  work_minutes: number;
  overtime_minutes: number;
  raw_data?: Record<string, unknown>;
  warnings?: string[];
}

export interface AttendanceImportPreviewInput {
  import_type: AttendanceImportType;
  original_filename: string;
  start_date: string;
  end_date: string;
  rows: AttendanceImportSourceRow[];
  notes?: string;
}

export interface AttendanceImportRow {
  id: string;
  row_number: number;
  machine_employee_no: string;
  employee_id: string | null;
  employee_name?: string | null;
  attendance_date: string;
  clock_in: string | null;
  clock_out: string | null;
  work_minutes: number;
  overtime_minutes: number;
  proposed_status: AttendanceStatus;
  final_status: AttendanceStatus;
  warnings: string[];
  correction_reason: string;
  raw_data?: Record<string, unknown>;
}

export interface AttendanceImport {
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
  imported_by?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  notes?: string;
  created_at: string;
  updated_at?: string;
}

export interface AttendanceImportPreview {
  import: AttendanceImport;
  rows: AttendanceImportRow[];
}

export interface AttendanceImportRowUpdate {
  id: string;
  final_status: AttendanceStatus;
  clock_in: string | null;
  clock_out: string | null;
  work_minutes: number;
  overtime_minutes: number;
  correction_reason: string;
}

export interface AttendanceImportRowsUpdateInput {
  rows: AttendanceImportRowUpdate[];
}

export interface AttendanceSettings {
  id?: number;
  required_work_minutes: number;
  overtime_enabled: boolean;
  updated_by?: string | null;
  updated_at?: string;
}

/* ------------------------------------------------------------------ */
/* Leave                                                               */
/* ------------------------------------------------------------------ */

export const LEAVE_TYPES = [
  "Annual",
  "Sick",
  "Personal",
  "Maternity",
  "Paternity",
  "Unpaid",
] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

export type LeaveStatus =
  (typeof LEAVE_STATUS)[keyof typeof LEAVE_STATUS];

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export interface LeaveRequest {
  leave_id: string;
  employee_id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  created_date: string;
  reviewed_by?: string;
  reviewed_date?: string;
  rejection_reason?: string;
}

export interface LeaveRequestInput {
  employee_id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Payroll                                                             */
/* ------------------------------------------------------------------ */

export const PAYROLL_STATUS = {
  DRAFT: "DRAFT",
  CALCULATED: "CALCULATED",
  PENDING_FINANCE_REVIEW: "PENDING_FINANCE_REVIEW",
  FINANCE_APPROVED: "FINANCE_APPROVED",
  PAID: "PAID",
  REJECTED: "REJECTED",
} as const;

export type PayrollStatus =
  (typeof PAYROLL_STATUS)[keyof typeof PAYROLL_STATUS];

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  DRAFT: "Draft",
  CALCULATED: "Calculated",
  PENDING_FINANCE_REVIEW: "Pending Finance Review",
  FINANCE_APPROVED: "Finance Approved",
  PAID: "Paid",
  REJECTED: "Rejected",
};

export interface PayrollLineItem {
  name: string;
  amount: number;
}

export interface OvertimeConfig {
  rate: number;
}

export interface PayrollEmployeeRecord {
  employee_id: string;
  basic_salary: number;
  allowances: PayrollLineItem[];
  overtime_hours: number;
  overtime_pay: number;
  gross_salary: number;
  deductions: PayrollLineItem[];
  net_salary: number;
}

export interface PayrollRun {
  payroll_id: string;
  period_label: string;
  period_month: number;
  period_year: number;
  start_date: string;
  end_date: string;
  status: PayrollStatus;
  employee_records: PayrollEmployeeRecord[];
  created_date: string;
  created_by?: string;
  submitted_date?: string;
  submitted_by?: string;
  approved_date?: string;
  approved_by?: string;
  rejection_reason?: string;
  paid_date?: string;
  paid_by?: string;
}

export interface PayrollRunInput {
  period_label: string;
  period_month: number;
  period_year: number;
  start_date: string;
  end_date: string;
}

/* ------------------------------------------------------------------ */
/* HR Dashboard                                                        */
/* ------------------------------------------------------------------ */

export interface HRDashboard {
  totalEmployees: number;
  activeEmployees: number;
  inactiveEmployees: number;
  presentToday: number;
  absentToday: number;
  lateToday: number;
  onLeave: number;
  pendingLeaveRequests: number;
  currentPayrollStatus: string;
}

/* ------------------------------------------------------------------ */
/* API types                                                           */
/* ------------------------------------------------------------------ */

export interface ApiResponse<T> {
  data: T;
  message?: string;
}
