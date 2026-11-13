import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent } from "react";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
  Check,
  X,
  CalendarCheck,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

import { toast } from "sonner";

import { HR_API_BASE_URL } from "@/lib/api/config";
import { getHrAuthToken } from "@/services/hr/apiClient";

import {
  useHRAttendance,
  useHREmployees,
  useCreateAttendance,
} from "@/hooks/use-hr-data";

import {
  type AttendanceInput,
  type AttendanceRecord,
  type AttendanceStatus,
} from "@/services/hr/types";

import {
  previewAttendanceImport,
  updateAttendanceImportRows,
  approveAttendanceImport,
  cancelAttendanceImport,
} from "@/services/hr/attendanceImportApi";

import type {
  AttendanceImportSourceRow,
  AttendanceImportRow,
  AttendanceImportRowsUpdate,
  AttendanceImportAttendanceStatus,
} from "@/services/hr/attendanceImportApi";

/* -------------------------------------------------------------------------- */
/* SELECTED-DAY API                                                           */
/* -------------------------------------------------------------------------- */

async function fetchAttendanceForDay(
  date: string,
): Promise<AttendanceRecord[]> {
  const baseUrl = HR_API_BASE_URL.replace(/\/+$/, "");
  const token = getHrAuthToken();

  const response = await fetch(
    `${baseUrl}/api/attendance/day/${encodeURIComponent(date)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      result?.messages?.error ||
        result?.message ||
        `Unable to load attendance for ${date} (HTTP ${response.status}).`,
    );
  }

  const rows = Array.isArray(result?.data)
    ? result.data
    : Array.isArray(result?.data?.data)
      ? result.data.data
      : null;

  if (!rows) {
    throw new Error("The daily attendance API returned an invalid data format.");
  }

  return rows.map((row: any) => ({
    ...row,
    employee_id: String(row.employee_id ?? row.employee?.id ?? row.id ?? ""),
    attendance_date: String(row.attendance_date ?? date).slice(0, 10),
    attendance_id: row.attendance_id ?? null,
    overtime_hours: Number(row.overtime_hours ?? 0),
    overtime_minutes: Number(row.overtime_minutes ?? 0),
    work_minutes: Number(row.work_minutes ?? 0),
  })) as AttendanceRecord[];
}

async function updateAttendanceForDay(
  attendanceId: string,
  payload: AttendanceInput,
): Promise<void> {
  const baseUrl = HR_API_BASE_URL.replace(/\/+$/, "");
  const token = getHrAuthToken();

  const response = await fetch(
    `${baseUrl}/api/attendance/${encodeURIComponent(attendanceId)}`,
    {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        ...payload,
        correction_reason: "Manual attendance correction from HR attendance page",
      }),
    },
  );

  const responseText = await response.text();
  let responseBody: any = null;

  if (responseText.trim()) {
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      throw new Error("The attendance update endpoint returned invalid JSON.");
    }
  }

  if (!response.ok) {
    throw new Error(
      responseBody?.messages?.error ||
        responseBody?.message ||
        responseText ||
        `Unable to update attendance (${response.status}).`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* ADMIN SETTINGS                                                             */
/* -------------------------------------------------------------------------- */

async function fetchStandardWorkingHours(): Promise<number> {
  const baseUrl = HR_API_BASE_URL.replace(/\/+$/, "");
  const token = getHrAuthToken();

  try {
    const response = await fetch(
      `${baseUrl}/api/operational-settings/standard_working_hours`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );

    if (!response.ok) return 9;

    const body = await response.json().catch(() => null);

    const raw =
      body?.data?.setting_value ??
      body?.setting_value ??
      body?.data?.value ??
      body?.value ??
      null;

    const parsed = Number(raw);

    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 24) {
      return parsed;
    }
  } catch {
    // fall through
  }

  return 9;
}

/* -------------------------------------------------------------------------- */
/* CONSTANTS                                                                  */
/* -------------------------------------------------------------------------- */

type AttendanceChoice = "PRESENT" | "ABSENT";

const STATUS_ORDER: AttendanceChoice[] = ["PRESENT", "ABSENT"];

const STATUS_STYLE: Record<AttendanceChoice, string> = {
  PRESENT:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  ABSENT:
    "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
};

const STATUS_ACTIVE_STYLE: Record<AttendanceChoice, string> = {
  PRESENT:
    "border-emerald-500 bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-400",
  ABSENT:
    "border-red-500 bg-red-500/10 text-red-700 ring-1 ring-red-500/30 dark:text-red-400",
};

const inputClass =
  "h-9 border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* -------------------------------------------------------------------------- */
/* TYPES                                                                      */
/* -------------------------------------------------------------------------- */

interface EthiopianDateParts {
  year: number;
  month: number;
  day: number;
}

interface CalendarDay {
  date: string;
  day: number;
  isToday: boolean;
  isSelected: boolean;
  completion: "complete" | "partial" | "empty" | "future";
}

/* -------------------------------------------------------------------------- */
/* DATE HELPERS                                                               */
/* -------------------------------------------------------------------------- */

function getTodayISO(): string {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseISODate(value: string): Date | null {
  const match = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return null;

  const [, year, month, day] = match;

  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), 12),
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function toISODate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function getEthiopianParts(date: Date): EthiopianDateParts {
  const parts = new Intl.DateTimeFormat("en-u-ca-ethiopic-nu-latn", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).formatToParts(date);

  const getValue = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: getValue("year"),
    month: getValue("month"),
    day: getValue("day"),
  };
}

function formatEthiopianDate(value: string | null | undefined): string {
  if (!value) return "—";

  const date = parseISODate(value);

  if (!date) return String(value);

  const parts = new Intl.DateTimeFormat("en-u-ca-ethiopic-nu-latn", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(date);

  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const year = parts.find((part) => part.type === "year")?.value;

  if (!day || !month || !year) return value;

  return `${month} ${day}, ${year} E.C.`;
}

function getEthiopianMonth(currentDate: string, monthOffset: number) {
  const anchor = parseISODate(currentDate);

  if (!anchor) {
    return { title: "", dates: [] as string[], firstDate: "", lastDate: "" };
  }

  const currentParts = getEthiopianParts(anchor);

  const monthIndex =
    currentParts.year * 13 + (currentParts.month - 1) + monthOffset;

  const targetYear = Math.floor(monthIndex / 13);
  const targetMonth = (monthIndex % 13) + 1;

  const center = new Date(anchor.getTime());

  center.setUTCDate(
    center.getUTCDate() + Math.round(monthOffset * 30.436875),
  );

  const dates: string[] = [];

  for (let offset = -65; offset <= 65; offset++) {
    const candidate = new Date(center.getTime());

    candidate.setUTCDate(candidate.getUTCDate() + offset);

    const parts = getEthiopianParts(candidate);

    if (parts.year === targetYear && parts.month === targetMonth) {
      dates.push(toISODate(candidate));
    }
  }

  dates.sort();

  const firstDate = dates[0] ?? "";
  const lastDate = dates[dates.length - 1] ?? "";

  let title = "";

  if (firstDate) {
    const first = parseISODate(firstDate);

    if (first) {
      const parts = new Intl.DateTimeFormat("en-u-ca-ethiopic-nu-latn", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).formatToParts(first);

      const month = parts.find((part) => part.type === "month")?.value;
      const year = parts.find((part) => part.type === "year")?.value;

      title = `${month ?? ""} ${year ?? ""} E.C.`;
    }
  }

  return { title, dates, firstDate, lastDate };
}

/* -------------------------------------------------------------------------- */
/* EXCEL PARSING                                                              */
/* -------------------------------------------------------------------------- */

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

function findColumn(headers: string[], aliases: string[]): number {
  const normalizedAliases = aliases.map(normalizeHeader);

  return headers.findIndex((header) =>
    normalizedAliases.includes(normalizeHeader(header)),
  );
}

function getCell(
  row: unknown[],
  headers: string[],
  aliases: string[],
): unknown {
  const index = findColumn(headers, aliases);

  return index >= 0 ? row[index] : undefined;
}

function textValue(value: unknown): string {
  if (value === undefined || value === null) return "";

  return String(value).trim();
}

function parseExcelDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (parsed) {
      return [
        String(parsed.y).padStart(4, "0"),
        String(parsed.m).padStart(2, "0"),
        String(parsed.d).padStart(2, "0"),
      ].join("-");
    }
  }

  const raw = String(value).trim();

  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);

  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);

  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }

  const parsedDate = new Date(raw);

  if (!Number.isNaN(parsedDate.getTime())) {
    return [
      parsedDate.getFullYear(),
      String(parsedDate.getMonth() + 1).padStart(2, "0"),
      String(parsedDate.getDate()).padStart(2, "0"),
    ].join("-");
  }

  return null;
}

function parseExcelTime(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(
      value.getMinutes(),
    ).padStart(2, "0")}:${String(value.getSeconds()).padStart(2, "0")}`;
  }

  if (typeof value === "number") {
    const totalMinutes = Math.round(value * 24 * 60);
    const normalized = ((totalMinutes % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
  }

  const raw = String(value).trim();

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);

  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseDuration(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return Math.max(0, Math.round(value * 24 * 60));
  }

  const raw = String(value).trim();

  const timeMatch = raw.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);

  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const seconds = Number(timeMatch[3] ?? 0);

    return Math.max(
      0,
      hours * 60 + minutes + (seconds >= 30 ? 1 : 0),
    );
  }

  const unitMatch = raw.match(
    /(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?/i,
  );

  if (unitMatch && (unitMatch[1] || unitMatch[2])) {
    return Math.max(
      0,
      Math.round(
        Number(unitMatch[1] ?? 0) * 60 +
          Number(unitMatch[2] ?? 0),
      ),
    );
  }

  const numeric = Number(raw);

  return Number.isFinite(numeric)
    ? Math.max(0, Math.round(numeric))
    : 0;
}

function parseOvertimeInput(value: string): number | null {
  const raw = value.trim();

  if (raw === "") return 0;

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return Math.round(Number(raw) * 60);
  }

  const clock = raw.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);

  if (clock) {
    const minutes = Number(clock[2]);
    const seconds = Number(clock[3] ?? 0);

    if (minutes > 59 || seconds > 59) return null;

    return (
      Number(clock[1]) * 60 +
      minutes +
      (seconds >= 30 ? 1 : 0)
    );
  }

  const units = raw.match(
    /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?$/i,
  );

  if (units && (units[1] || units[2])) {
    return Math.round(
      Number(units[1] ?? 0) * 60 + Number(units[2] ?? 0),
    );
  }

  return null;
}

function formatOvertimeInput(minutes: number): string {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

async function parseAttendanceFile(
  file: File,
): Promise<AttendanceImportSourceRow[]> {
  const buffer = await file.arrayBuffer();

  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
  });

  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error("The Excel file does not contain a worksheet.");
  }

  const worksheet = workbook.Sheets[sheetName];

  const data = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    defval: "",
  });

  if (data.length < 2) {
    throw new Error("The Excel file does not contain attendance rows.");
  }

  const possibleHeaderNames = [
    "Emp No.",
    "Employee No",
    "Employee ID",
    "User ID",
    "Date",
    "Attendance Date",
  ];

  const headerIndex = data.findIndex((row) => {
    const values = row.map(normalizeHeader);

    return values.some((value) =>
      possibleHeaderNames.some(
        (header) => normalizeHeader(header) === value,
      ),
    );
  });

  if (headerIndex < 0) {
    throw new Error(
      "Unable to identify the Excel header row. Expected columns such as Emp No. and Date.",
    );
  }

  const headers = (data[headerIndex] ?? []).map((value) =>
    String(value ?? "").trim(),
  );

  const parsedRows: AttendanceImportSourceRow[] = [];

  for (let index = headerIndex + 1; index < data.length; index++) {
    const row = data[index] ?? [];

    if (row.every((cell) => cell === "" || cell === null)) {
      continue;
    }

    const machineNo = textValue(
      getCell(row, headers, [
        "Emp No.",
        "Employee No",
        "Employee ID",
        "User ID",
        "Enroll No",
        "PIN",
      ]),
    );

    const employeeName = textValue(
      getCell(row, headers, ["Name", "Employee Name", "User Name"]),
    );

    const attendanceDate = parseExcelDate(
      getCell(row, headers, ["Date", "Attendance Date", "Check Date"]),
    );

    // Punch columns only. NEVER fall back to On duty / Off duty — those
    // are scheduled shift times, not actual punches.
    const clockIn = parseExcelTime(
      getCell(row, headers, [
        "Clock In",
        "First Check In",
        "Check In",
        "Punch In",
      ]),
    );

    const clockOut = parseExcelTime(
      getCell(row, headers, [
        "Clock Out",
        "Last Check Out",
        "Check Out",
        "Punch Out",
      ]),
    );

    const workMinutes = parseDuration(
      getCell(row, headers, [
        "Work Time",
        "Worked Time",
        "Total Work",
        "Working Hours",
      ]),
    );

    const overtimeMinutes = 0;

    const warnings: string[] = [];

    if (!machineNo) {
      warnings.push("Employee machine number is missing.");
    }

    if (!attendanceDate) {
      warnings.push("Attendance date is missing or invalid.");
    }

    if (clockIn && !clockOut) {
      warnings.push("Clock Out is missing.");
    }

    if (!clockIn && clockOut) {
      warnings.push("Clock In is missing.");
    }

    if (!machineNo || !attendanceDate) {
      continue;
    }

    const rawData: Record<string, unknown> = {};

    headers.forEach((header, columnIndex) => {
      if (header) {
        rawData[header] = row[columnIndex] ?? null;
      }
    });

    parsedRows.push({
      row_number: index + 1,
      machine_employee_no: machineNo,
      employee_name: employeeName || undefined,
      attendance_date: attendanceDate,
      clock_in: clockIn,
      clock_out: clockOut,
      work_minutes: workMinutes,
      overtime_minutes: overtimeMinutes,
      raw_data: rawData,
      warnings,
    });
  }

  if (parsedRows.length === 0) {
    throw new Error(
      "No valid attendance rows were found. Check the employee number and date columns.",
    );
  }

  return parsedRows;
}

/* -------------------------------------------------------------------------- */
/* OTHER HELPERS                                                              */
/* -------------------------------------------------------------------------- */

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

function getAttendanceCompletion(
  date: string,
  records: AttendanceRecord[],
  employeeCount: number,
  today: string,
): CalendarDay["completion"] {
  if (date >= today) return "future";

  if (employeeCount === 0) return "empty";

  const employeeIds = new Set(
    records
      .filter((record) => record.attendance_date === date)
      .map((record) => record.employee_id),
  );

  if (employeeIds.size === 0) return "empty";

  if (employeeIds.size >= employeeCount) return "complete";

  return "partial";
}

/** Natural sort for employee IDs like "1", "2", "10", "A-3". */
function compareEmployeeIds(a: string, b: string): number {
  const re = /^(\D*)(\d+)(\D*)$/;
  const aMatch = a.match(re);
  const bMatch = b.match(re);

  if (aMatch && bMatch && aMatch[1] === bMatch[1] && aMatch[3] === bMatch[3]) {
    return Number(aMatch[2]) - Number(bMatch[2]);
  }

  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/* -------------------------------------------------------------------------- */
/* ATTENDANCE PAGE                                                            */
/* -------------------------------------------------------------------------- */

export default function Attendance() {
  const today = useMemo(() => getTodayISO(), []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(today);
  const [searchTerm, setSearchTerm] = useState("");

  const [selectedDayRecords, setSelectedDayRecords] = useState<
    AttendanceRecord[]
  >([]);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);
  const [dayReloadKey, setDayReloadKey] = useState(0);

  const [draftStatuses, setDraftStatuses] = useState<
    Record<string, AttendanceChoice>
  >({});

  const [draftOvertimeHours, setDraftOvertimeHours] = useState<
    Record<string, string>
  >({});

  const [saving, setSaving] = useState(false);

  /* Admin settings (display only) */

  const [standardWorkingHours, setStandardWorkingHours] = useState<number>(9);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const value = await fetchStandardWorkingHours();

      if (!cancelled) setStandardWorkingHours(value);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* Import state */

  const [importFileName, setImportFileName] = useState("");
  const [importInfo, setImportInfo] = useState<any>(null);

  const [importRows, setImportRows] = useState<AttendanceImportRow[]>([]);
  const [importOvertimeDrafts, setImportOvertimeDrafts] = useState<
    Record<string, string>
  >({});

  const [selectedImportDate, setSelectedImportDate] = useState("");

  const [loadingFile, setLoadingFile] = useState(false);
  const [approvingImport, setApprovingImport] = useState(false);
  const [cancellingImport, setCancellingImport] = useState(false);

  const month = useMemo(
    () => getEthiopianMonth(today, monthOffset),
    [today, monthOffset],
  );

  const queryParams = useMemo(
    () => ({
      start_date: month.firstDate || undefined,
      end_date: month.lastDate || undefined,
    }),
    [month.firstDate, month.lastDate],
  );

  const {
    data: records,
    loading,
    error,
    refresh,
  } = useHRAttendance(queryParams);

  const { data: employees } = useHREmployees();

  const { create } = useCreateAttendance();

  const employeeList = useMemo(
    () => employees?.filter((employee) => employee.is_active) ?? [],
    [employees],
  );

  const attendanceRecords = records ?? [];

  /* ---------------------------------------------------------------------- */
  /* SELECTED DAY LOADER                                                    */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    const loadSelectedDay = async () => {
      setDayLoading(true);
      setDayError(null);

      try {
        const rows = await fetchAttendanceForDay(selectedDate);
        if (!cancelled) setSelectedDayRecords(rows);
      } catch (error) {
        if (!cancelled) {
          setSelectedDayRecords([]);
          setDayError(getErrorMessage(error));
        }
      } finally {
        if (!cancelled) setDayLoading(false);
      }
    };

    void loadSelectedDay();

    return () => {
      cancelled = true;
    };
  }, [selectedDate, dayReloadKey]);

  const refreshSelectedDay = () => {
    setDayReloadKey((value) => value + 1);
  };

  /* ---------------------------------------------------------------------- */
  /* RECORD LOOKUPS                                                         */
  /* ---------------------------------------------------------------------- */

  const recordsByEmployee = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();

    selectedDayRecords.forEach((record) => {
      const identifiers = [
        record.employee_id,
        (record as AttendanceRecord & { erp_employee_id?: string | number })
          .erp_employee_id,
        (record as AttendanceRecord & { machine_employee_no?: string | number })
          .machine_employee_no,
      ];

      identifiers.forEach((identifier) => {
        if (
          identifier !== null &&
          identifier !== undefined &&
          String(identifier).trim() !== ""
        ) {
          map.set(String(identifier), record);
        }
      });
    });

    return map;
  }, [selectedDayRecords]);

  /**
   * Visible employees sorted by employee_id (natural order) so the list
   * always starts at ID 1, then 2, then 3, etc.
   */
  const visibleEmployees = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    const filtered = !search
      ? [...employeeList]
      : employeeList.filter(
          (employee) =>
            employee.full_name.toLowerCase().includes(search) ||
            employee.employee_id.toLowerCase().includes(search) ||
            String(employee.machine_employee_no ?? "")
              .toLowerCase()
              .includes(search),
        );

    filtered.sort((a, b) =>
      compareEmployeeIds(a.employee_id, b.employee_id),
    );

    return filtered;
  }, [employeeList, searchTerm]);

  /* ---------------------------------------------------------------------- */
  /* CALENDAR                                                               */
  /* ---------------------------------------------------------------------- */

  const calendarDays = useMemo(() => {
    const dates = month.dates;

    if (dates.length === 0) return [];

    const firstDate = parseISODate(dates[0]);

    if (!firstDate) return [];

    const leadingEmptyDays = firstDate.getUTCDay();

    const days: (CalendarDay | null)[] = Array.from(
      { length: leadingEmptyDays },
      () => null,
    );

    dates.forEach((date) => {
      const parsed = parseISODate(date);

      if (!parsed) return;

      days.push({
        date,
        day: getEthiopianParts(parsed).day,
        isToday: date === today,
        isSelected: date === selectedDate,
        completion: getAttendanceCompletion(
          date,
          attendanceRecords,
          employeeList.length,
          today,
        ),
      });
    });

    return days;
  }, [
    month.dates,
    attendanceRecords,
    employeeList.length,
    today,
    selectedDate,
  ]);

  useEffect(() => {
    setDraftStatuses({});
    setDraftOvertimeHours({});
  }, [selectedDate]);

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    setDraftStatuses({});
    setDraftOvertimeHours({});
  };

  const handleMonthChange = (direction: -1 | 1) => {
    const nextOffset = monthOffset + direction;

    setMonthOffset(nextOffset);

    const nextMonth = getEthiopianMonth(today, nextOffset);

    if (!nextMonth.dates.includes(selectedDate) && nextMonth.firstDate) {
      setSelectedDate(nextMonth.firstDate);
      setDraftStatuses({});
      setDraftOvertimeHours({});
    }
  };

  const getEmployeeStatus = (
    employeeId: string,
  ): AttendanceStatus | null => {
    if (draftStatuses[employeeId]) {
      return draftStatuses[employeeId];
    }

    const record = recordsByEmployee.get(employeeId);

    return record?.attendance_id ? record.status : null;
  };

  const setEmployeeStatus = (
    employeeId: string,
    status: AttendanceChoice,
  ) => {
    setDraftStatuses((previous) => ({
      ...previous,
      [employeeId]: status,
    }));
  };

  const getEmployeeOvertimeHours = (employeeId: string): string => {
    if (draftOvertimeHours[employeeId] !== undefined) {
      return draftOvertimeHours[employeeId];
    }

    const existing = recordsByEmployee.get(employeeId);

    if (!existing?.attendance_id) return "0.00";

    const overtimeHours =
      Number(existing.overtime_hours ?? 0) ||
      Number(existing.overtime_minutes ?? 0) / 60;

    return overtimeHours.toFixed(2);
  };

  const setEmployeeOvertimeHours = (employeeId: string, value: string) => {
    setDraftOvertimeHours((previous) => ({
      ...previous,
      [employeeId]: value,
    }));
  };

  const pendingChanges =
    Object.keys(draftStatuses).length +
    Object.keys(draftOvertimeHours).length;

  /* ---------------------------------------------------------------------- */
  /* MANUAL ATTENDANCE SUBMISSION                                           */
  /* ---------------------------------------------------------------------- */

  const handleSubmit = async () => {
    if (pendingChanges === 0) {
      toast.info("There are no attendance changes to submit.");
      return;
    }

    setSaving(true);

    let successful = 0;

    try {
      const employeeIds = new Set([
        ...Object.keys(draftStatuses),
        ...Object.keys(draftOvertimeHours),
      ]);

      for (const employeeId of employeeIds) {
        const existingRecord = recordsByEmployee.get(employeeId);

        const hasSavedRecord = Boolean(existingRecord?.attendance_id);
        const storedStatus =
          draftStatuses[employeeId] ??
          (hasSavedRecord ? existingRecord?.status : undefined);
        const status: AttendanceStatus =
          storedStatus === "PRESENT" ? "PRESENT" : "ABSENT";

        const overtimeHoursValue =
          draftOvertimeHours[employeeId] ??
          String(
            Number(existingRecord?.overtime_hours ?? 0) ||
              Number(existingRecord?.overtime_minutes ?? 0) / 60,
          );

        const overtimeHours = Number(overtimeHoursValue);

        if (!Number.isFinite(overtimeHours) || overtimeHours < 0) {
          throw new Error(
            `Invalid overtime hours entered for employee ${employeeId}.`,
          );
        }

        const payload: AttendanceInput = {
          employee_id: employeeId,
          attendance_date: selectedDate,
          status,
          overtime_hours: Number(overtimeHours.toFixed(2)),
          work_minutes: existingRecord?.work_minutes ?? 0,
          note: existingRecord?.note ?? "",
        };

        if (existingRecord?.attendance_id) {
          await updateAttendanceForDay(existingRecord.attendance_id, payload);
        } else {
          await create(payload);
        }

        successful++;
      }

      setDraftStatuses({});
      setDraftOvertimeHours({});

      await refresh();
      refreshSelectedDay();

      toast.success(
        `${successful} attendance records submitted successfully.`,
      );
    } catch (err) {
      toast.error(
        `Unable to submit all attendance changes. ${successful} saved. ${getErrorMessage(err)}`,
      );

      await refresh();
      refreshSelectedDay();
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------------------------------------------------- */
  /* IMPORT: OPEN NATIVE FILE PICKER                                        */
  /* ---------------------------------------------------------------------- */

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) return;

    const extension = file.name.split(".").pop()?.toLowerCase();

    if (!extension || !["xls", "xlsx"].includes(extension)) {
      toast.error("Please select an Excel file (.xls or .xlsx).");
      return;
    }

    setLoadingFile(true);

    setImportInfo(null);
    setImportRows([]);
    setImportOvertimeDrafts({});
    setSelectedImportDate("");
    setImportFileName(file.name);

    try {
      const parsedRows = await parseAttendanceFile(file);

      const dates = parsedRows.map((row) => row.attendance_date).sort();

      if (dates.length === 0) {
        throw new Error("No attendance dates were found in the file.");
      }

      const uniqueDates = [...new Set(dates)];

      const startDate = uniqueDates[0];
      const endDate = uniqueDates[uniqueDates.length - 1];

      const importType = uniqueDates.length === 1 ? "DAILY" : "MONTHLY";

      const response = await previewAttendanceImport({
        import_type: importType,
        start_date: startDate,
        end_date: endDate,
        original_filename: file.name,
        rows: parsedRows,
      });

      if (!response.data?.import || !Array.isArray(response.data.rows)) {
        throw new Error("The server returned an invalid attendance preview.");
      }

      const returnedRows: AttendanceImportRow[] = (
        response.data.rows as AttendanceImportRow[]
      ).map((row) => ({
        ...row,
        proposed_status:
          row.proposed_status === "PRESENT" ? "PRESENT" : "ABSENT",
        final_status: row.final_status === "PRESENT" ? "PRESENT" : "ABSENT",
      }));

      setImportInfo(response.data.import);
      setImportRows(returnedRows);
      setImportOvertimeDrafts(
        Object.fromEntries(
          returnedRows.map((row) => [
            row.id,
            formatOvertimeInput(Number(row.overtime_minutes || 0)),
          ]),
        ),
      );

      const returnedDates = [
        ...new Set(returnedRows.map((row) => row.attendance_date)),
      ].sort();

      setSelectedImportDate(returnedDates[0] ?? startDate);

      toast.success(
        `Attendance preview generated. ${returnedRows.length} rows found across ${returnedDates.length} dates.`,
      );
    } catch (error) {
      setImportInfo(null);
      setImportRows([]);
      setImportOvertimeDrafts({});
      setSelectedImportDate("");

      toast.error(
        `Unable to import attendance file: ${getErrorMessage(error)}`,
      );
    } finally {
      setLoadingFile(false);
    }
  };

  /* ---------------------------------------------------------------------- */
  /* IMPORT DATE NAVIGATION                                                 */
  /* ---------------------------------------------------------------------- */

  const importDates = useMemo(
    () => [...new Set(importRows.map((row) => row.attendance_date))].sort(),
    [importRows],
  );

  /**
   * Rows for the selected date, sorted by employee ID (natural order) so
   * the preview also starts at employee 1, then 2, 3, ...
   */
  const selectedImportRows = useMemo(() => {
    const rows = importRows.filter(
      (row) => row.attendance_date === selectedImportDate,
    );

    rows.sort((a, b) => {
      const aKey = a.employee_id ?? a.machine_employee_no ?? "";
      const bKey = b.employee_id ?? b.machine_employee_no ?? "";
      return compareEmployeeIds(String(aKey), String(bKey));
    });

    return rows;
  }, [importRows, selectedImportDate]);

  const importSummary = useMemo(
    () => ({
      unmatched: selectedImportRows.filter((row) => !row.employee_id).length,
    }),
    [selectedImportRows],
  );

  const updateImportStatus = (rowId: string, status: AttendanceChoice) => {
    setImportRows((previous) =>
      previous.map((row) =>
        row.id === rowId
          ? {
              ...row,
              final_status: status as AttendanceImportAttendanceStatus,
            }
          : row,
      ),
    );
  };

  const setImportOvertime = (rowId: string, value: string) => {
    setImportOvertimeDrafts((previous) => ({ ...previous, [rowId]: value }));
  };

  const getImportRowsPayload = (): AttendanceImportRowsUpdate => ({
    rows: importRows.map((row) => {
      const overtimeMinutes = parseOvertimeInput(
        importOvertimeDrafts[row.id] ??
          formatOvertimeInput(Number(row.overtime_minutes || 0)),
      );

      return {
        id: row.id,
        final_status: row.final_status === "PRESENT" ? "PRESENT" : "ABSENT",
        clock_in: row.clock_in || null,
        clock_out: row.clock_out || null,
        work_minutes: Math.max(0, Number(row.work_minutes) || 0),
        overtime_minutes: Math.max(0, overtimeMinutes ?? 0),
        correction_reason: "Edited by HR in attendance import preview",
      };
    }),
  });

  const validateImportRows = (): boolean => {
    if (importRows.some((row) => !row.employee_id)) {
      toast.error(
        "Some employee IDs are unmatched. Resolve them before approval.",
      );
      return false;
    }

    const invalidOvertime = importRows.find((row) => {
      const value =
        importOvertimeDrafts[row.id] ??
        formatOvertimeInput(Number(row.overtime_minutes || 0));
      const minutes = parseOvertimeInput(value);
      return minutes === null || minutes < 0;
    });

    if (invalidOvertime) {
      toast.error(
        `Enter valid overtime for ${
          invalidOvertime.employee_name ||
          invalidOvertime.machine_employee_no
        }. Use 1.5 or 1:30.`,
      );
      return false;
    }

    return true;
  };

  /* ---------------------------------------------------------------------- */
  /* SAVE IMPORT PREVIEW EDITS                                              */
  /* ---------------------------------------------------------------------- */

  const handleSaveImportChanges = async () => {
    if (!importInfo || importInfo.status !== "PREVIEW") return;

    if (!validateImportRows()) return;

    setSaving(true);

    try {
      await updateAttendanceImportRows(importInfo.id, getImportRowsPayload());

      toast.success("Import preview changes saved.");
    } catch (error) {
      toast.error(
        `Unable to save preview changes: ${getErrorMessage(error)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------------------------------------------------- */
  /* APPROVE IMPORT                                                         */
  /* ---------------------------------------------------------------------- */

  const handleApproveImport = async () => {
    if (!importInfo || importInfo.status !== "PREVIEW") return;

    if (!validateImportRows()) return;

    if (importRows.length === 0) {
      toast.error("There are no attendance rows to approve.");
      return;
    }

    const confirmed = window.confirm(
      `Approve this attendance import containing ${importRows.length} rows across ${importDates.length} dates? This will save the attendance records to the database.`,
    );

    if (!confirmed) return;

    setApprovingImport(true);

    try {
      await updateAttendanceImportRows(importInfo.id, getImportRowsPayload());
      await approveAttendanceImport(importInfo.id);

      toast.success("Attendance import approved successfully.");

      setImportInfo(null);
      setImportRows([]);
      setImportOvertimeDrafts({});
      setImportFileName("");
      setSelectedImportDate("");

      await refresh();
      refreshSelectedDay();
    } catch (error) {
      toast.error(
        `Unable to approve attendance import: ${getErrorMessage(error)}`,
      );
    } finally {
      setApprovingImport(false);
    }
  };

  /* ---------------------------------------------------------------------- */
  /* CANCEL IMPORT                                                          */
  /* ---------------------------------------------------------------------- */

  const handleCancelImport = async () => {
    if (!importInfo || importInfo.status !== "PREVIEW") return;

    const confirmed = window.confirm(
      "Cancel this import preview? Attendance records will not be updated.",
    );

    if (!confirmed) return;

    setCancellingImport(true);

    try {
      await cancelAttendanceImport(importInfo.id);

      setImportInfo(null);
      setImportRows([]);
      setImportOvertimeDrafts({});
      setImportFileName("");
      setSelectedImportDate("");

      toast.success("Attendance import cancelled.");
    } catch (error) {
      toast.error(`Unable to cancel import: ${getErrorMessage(error)}`);
    } finally {
      setCancellingImport(false);
    }
  };

  /* ---------------------------------------------------------------------- */
  /* RENDER                                                                 */
  /* ---------------------------------------------------------------------- */

  const selectedDateLabel = formatEthiopianDate(selectedDate);

  if (loading && !records) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !records) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm font-medium text-foreground">
          Unable to load attendance records.
        </p>

        <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>

        <Button
          onClick={refresh}
          variant="outline"
          className="mt-4 border-border text-foreground"
        >
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Attendance
        </h1>

        <p className="mt-1 text-sm text-muted-foreground">
          Select a date to review or update employee attendance.
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.5fr)]">
        {/* LEFT: ETHIOPIAN CALENDAR */}

        <Card className="border-border bg-card shadow-none">
          <CardHeader className="space-y-4 pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-emerald-600 dark:text-emerald-400" />

                <CardTitle className="text-sm font-semibold text-foreground">
                  Ethiopian Calendar
                </CardTitle>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setMonthOffset(0);
                  setSelectedDate(today);
                  setDraftStatuses({});
                  setDraftOvertimeHours({});
                }}
                title="Go to current month"
              >
                <CalendarCheck className="size-4" />
              </Button>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-muted p-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:bg-accent hover:text-white"
                onClick={() => handleMonthChange(-1)}
              >
                <ChevronLeft className="size-4" />
              </Button>

              <div className="text-center">
                <div className="text-sm font-semibold text-foreground">
                  {month.title || "Ethiopian month"}
                </div>

                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {month.firstDate && month.lastDate
                    ? `${formatEthiopianDate(month.firstDate)} — ${formatEthiopianDate(month.lastDate)}`
                    : ""}
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:bg-accent hover:text-white"
                onClick={() => handleMonthChange(1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((weekday) => (
                <div
                  key={weekday}
                  className="py-2 text-center font-mono text-[10px] font-medium uppercase text-muted-foreground"
                >
                  {weekday}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {calendarDays.map((day, index) => {
                if (!day) {
                  return (
                    <div key={`empty-${index}`} className="aspect-square" />
                  );
                }

                const completionClass =
                  day.completion === "complete"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15"
                    : day.completion === "partial"
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15"
                      : day.completion === "empty"
                        ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/15"
                        : "border-border bg-muted text-muted-foreground hover:bg-accent";

                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => handleSelectDate(day.date)}
                    className={[
                      "relative flex aspect-square min-w-0 flex-col items-center justify-center rounded-lg border transition-all",
                      completionClass,
                      day.isSelected
                        ? "ring-2 ring-ring ring-offset-2 ring-offset-card"
                        : "",
                      day.isToday
                        ? "after:absolute after:right-1 after:top-1 after:size-1.5 after:rounded-full after:bg-blue-500"
                        : "",
                    ].join(" ")}
                    title={formatEthiopianDate(day.date)}
                  >
                    <span className="text-sm font-semibold tabular-nums">
                      {day.day}
                    </span>
                  </button>
                );
              })}
            </div>

            
          </CardContent>
        </Card>

        {/* RIGHT: ATTENDANCE AND IMPORT REVIEW */}

        <Card className="min-w-0 border-border bg-card shadow-none">
          <CardHeader className="space-y-4 pb-3">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-emerald-600 dark:text-emerald-400" />

                    <CardTitle className="text-sm font-semibold text-foreground">
                      {importInfo
                        ? "Imported Attendance Review"
                        : "Daily Attendance"}
                    </CardTitle>
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {importInfo
                      ? `${importFileName} — ${importDates.length} attendance dates`
                      : selectedDateLabel}
                  </p>

                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    Standard working hours: {standardWorkingHours} hr
                    {standardWorkingHours > 0
                      ? ` (${standardWorkingHours * 60} min)`
                      : ""}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={openFilePicker}
                    variant="outline"
                    disabled={loadingFile || approvingImport}
                    className="gap-2 border-border bg-background text-foreground hover:bg-accent"
                  >
                    {loadingFile ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="size-4 text-emerald-600 dark:text-emerald-400" />
                    )}

                    {loadingFile ? "Reading file..." : "Import Attendance"}
                  </Button>

                  {!importInfo && (
                    <>
                      <Button
                        onClick={handleSubmit}
                        disabled={saving || pendingChanges === 0}
                        className="gap-2 bg-emerald-600 dark:bg-emerald-500 text-white hover:bg-emerald-500/80 disabled:bg-muted disabled:text-muted-foreground"
                      >
                        {saving ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Check className="size-4" />
                        )}

                        Submit

                        {pendingChanges > 0 && (
                          <span className="rounded-full bg-black/15 px-1.5 py-0.5 text-xs">
                            {pendingChanges}
                          </span>
                        )}
                      </Button>

                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          void refresh();
                          refreshSelectedDay();
                        }}
                        disabled={loading || dayLoading}
                        className="border-border text-muted-foreground"
                        title="Refresh attendance"
                      >
                        <RefreshCw
                          className={`size-4 ${loading || dayLoading ? "animate-spin" : ""}`}
                        />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {importInfo && (
                <div className="rounded-lg border border-border bg-muted p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">
                      Attendance dates in imported file
                    </p>

                    <Badge
                      variant="outline"
                      className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    >
                      {importDates.length} dates
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {importDates.map((date) => {
                      const active = selectedImportDate === date;

                      return (
                        <Button
                          key={date}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedImportDate(date)}
                          className={[
                            "h-auto min-h-9 flex-col items-start gap-0.5 px-3 py-2",
                            active
                              ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "border-border bg-background text-muted-foreground",
                          ].join(" ")}
                        >
                          <span className="text-xs font-semibold">
                            {formatEthiopianDate(date)}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {!importInfo && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by ID or employee name..."
                  className={`${inputClass} pl-9`}
                />
              </div>
            )}
          </CardHeader>

          <CardContent className="p-0">
            {importInfo ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border bg-muted px-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      {formatEthiopianDate(selectedImportDate)}
                    </p>

                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Review the imported records for this date before
                      approving the file.
                    </p>
                  </div>

                  <Badge
                    variant="outline"
                    className="border-border text-muted-foreground"
                  >
                    {selectedImportRows.length} rows
                  </Badge>
                </div>

                {selectedImportRows.length > 0 ? (
                  <div className="max-h-[560px] overflow-y-auto">
                    <table className="w-full table-fixed border-collapse text-left">
                      <colgroup>
                        <col className="w-16" />
                        <col />
                        <col className="w-[120px]" />
                        <col className="w-[110px]" />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-muted">
                        <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-3 py-2 text-left font-medium">
                            ID
                          </th>
                          <th className="px-3 py-2 text-left font-medium">
                            Employee
                          </th>
                          <th className="px-3 py-2 text-left font-medium">
                            Status
                          </th>
                          <th className="px-3 py-2 text-left font-medium">
                            Overtime
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selectedImportRows.map((row) => {
                          const employee = employeeList.find(
                            (item) =>
                              item.employee_id === row.employee_id ||
                              item.machine_employee_no ===
                                row.machine_employee_no,
                          );
                          const overtimeValue =
                            importOvertimeDrafts[row.id] ??
                            formatOvertimeInput(
                              Number(row.overtime_minutes || 0),
                            );

                          return (
                            <tr
                              key={row.id}
                              className="hover:bg-accent/50"
                            >
                              <td className="truncate px-3 py-2 font-mono text-xs text-foreground">
                                {row.machine_employee_no || "—"}
                              </td>
                              <td className="truncate px-3 py-2 text-sm font-medium text-foreground">
                                {employee?.full_name ||
                                  row.employee_name ||
                                  "Unmatched employee"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-nowrap gap-1">
                                  {STATUS_ORDER.map((status) => {
                                    const selected =
                                      row.final_status === status;
                                    return (
                                      <Button
                                        key={status}
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                          updateImportStatus(row.id, status)
                                        }
                                        className={[
                                          "h-7 px-2 text-[10px]",
                                          selected
                                            ? STATUS_ACTIVE_STYLE[status]
                                            : STATUS_STYLE[status],
                                          !selected
                                            ? "opacity-60 hover:opacity-100"
                                            : "",
                                        ].join(" ")}
                                      >
                                        {selected && (
                                          <Check className="mr-1 size-2.5" />
                                        )}
                                        {status === "PRESENT"
                                          ? "Present"
                                          : "Absent"}
                                      </Button>
                                    );
                                  })}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  value={overtimeValue}
                                  onChange={(event) =>
                                    setImportOvertime(
                                      row.id,
                                      event.target.value,
                                    )
                                  }
                                  placeholder="1.5 or 1:30"
                                  className={`${inputClass} h-8 px-2 font-mono text-xs`}
                                  aria-label={`Overtime for ${
                                    row.employee_name ||
                                    row.machine_employee_no
                                  }`}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="py-16 text-center">
                    <FileSpreadsheet className="mx-auto mb-3 size-8 text-muted-foreground" />
                    <p className="text-sm text-foreground">
                      No records for this date.
                    </p>
                  </div>
                )}

                <div className="sticky bottom-0 flex flex-col gap-3 border-t border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      {importRows.length} records awaiting approval
                    </p>

                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Review all imported dates before approving the file.
                    </p>

                    {importSummary.unmatched > 0 && (
                      <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                        {importSummary.unmatched} unmatched employee(s) on this
                        date.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={handleCancelImport}
                      disabled={cancellingImport || approvingImport || saving}
                      className="gap-2 border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    >
                      {cancellingImport ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <X className="size-4" />
                      )}

                      Cancel Import
                    </Button>

                    <Button
                      variant="outline"
                      onClick={handleSaveImportChanges}
                      disabled={saving || approvingImport || cancellingImport}
                      className="gap-2 border-border text-foreground"
                    >
                      {saving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}

                      Save Changes
                    </Button>

                    <Button
                      onClick={handleApproveImport}
                      disabled={
                        approvingImport ||
                        saving ||
                        cancellingImport ||
                        importRows.length === 0
                      }
                      className="gap-2 bg-emerald-600 dark:bg-emerald-500 text-white hover:bg-emerald-500/80"
                    >
                      {approvingImport ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}

                      Approve Import
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {dayLoading ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin text-emerald-600 dark:text-emerald-400" />
                    Loading attendance for {selectedDateLabel}...
                  </div>
                ) : dayError ? (
                  <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
                    <AlertTriangle className="size-7 text-red-600 dark:text-red-400" />
                    <p className="text-sm font-medium text-foreground">
                      Unable to load attendance for this date.
                    </p>
                    <p className="max-w-xl text-xs text-muted-foreground">
                      {dayError}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={refreshSelectedDay}
                      className="border-border text-foreground"
                    >
                      <RefreshCw className="mr-2 size-4" />
                      Try Again
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="w-full">
                      <table className="w-full table-fixed border-collapse text-left">
                        <colgroup>
                          <col className="w-12" />
                          <col />
                          <col className="w-[92px]" />
                          <col className="w-[92px]" />
                          <col className="w-[104px]" />
                        </colgroup>
                        <thead className="border-y border-border bg-muted">
                          <tr>
                            <th className="px-2 py-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                              ID
                            </th>
                            <th className="px-2 py-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                              Name
                            </th>
                            <th className="px-1 py-2 text-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                              Present
                            </th>
                            <th className="px-1 py-2 text-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                              Absent
                            </th>
                            <th className="px-2 py-2 text-right font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                              OT (hr)
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {visibleEmployees.map((employee) => {
                            const existingRecord = recordsByEmployee.get(
                              employee.employee_id,
                            );
                            const storedStatus = getEmployeeStatus(
                              employee.employee_id,
                            );
                            const currentStatus = storedStatus;
                            const isPresent = currentStatus === "PRESENT";
                            const isAbsent = currentStatus === "ABSENT";
                            const isChanged =
                              draftStatuses[employee.employee_id] !==
                                undefined ||
                              draftOvertimeHours[employee.employee_id] !==
                                undefined;

                            return (
                              <tr
                                key={employee.employee_id}
                                className="transition-colors hover:bg-accent/50"
                              >
                                <td className="truncate px-2 py-2 font-mono text-[11px] text-muted-foreground">
                                  {employee.employee_id}
                                </td>
                                <td className="px-2 py-2">
                                  <div className="truncate text-[12px] font-medium text-foreground">
                                    {employee.full_name}
                                  </div>
                                  {existingRecord?.note && (
                                    <div className="mt-0.5 truncate text-[9px] text-muted-foreground">
                                      {existingRecord.note}
                                    </div>
                                  )}
                                </td>
                                <td className="px-1 py-2 text-center">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setEmployeeStatus(
                                        employee.employee_id,
                                        "PRESENT",
                                      )
                                    }
                                    className={[
                                      "h-7 px-2 text-[10px]",
                                      isPresent
                                        ? STATUS_ACTIVE_STYLE.PRESENT
                                        : STATUS_STYLE.PRESENT +
                                            " opacity-60 hover:opacity-100",
                                    ].join(" ")}
                                  >
                                    {isPresent && (
                                      <Check className="mr-0.5 size-2.5" />
                                    )}
                                    Present
                                  </Button>
                                </td>
                                <td className="px-1 py-2 text-center">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setEmployeeStatus(
                                        employee.employee_id,
                                        "ABSENT",
                                      )
                                    }
                                    className={[
                                      "h-7 px-2 text-[10px]",
                                      isAbsent
                                        ? STATUS_ACTIVE_STYLE.ABSENT
                                        : STATUS_STYLE.ABSENT +
                                            " opacity-60 hover:opacity-100",
                                    ].join(" ")}
                                  >
                                    {isAbsent && (
                                      <Check className="mr-0.5 size-2.5" />
                                    )}
                                    Absent
                                  </Button>
                                </td>
                                <td className="px-2 py-2 text-right">
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={getEmployeeOvertimeHours(
                                      employee.employee_id,
                                    )}
                                    onChange={(event) =>
                                      setEmployeeOvertimeHours(
                                        employee.employee_id,
                                        event.target.value,
                                      )
                                    }
                                    className={`${inputClass} h-7 px-2 text-right text-[11px]`}
                                    title="Overtime hours"
                                  />
                                  {isChanged && (
                                    <div className="mt-0.5 text-[8px] text-amber-600 dark:text-amber-400">
                                      Unsaved
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {visibleEmployees.length === 0 && (
                      <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
                        <Search className="mb-3 size-8 text-muted-foreground" />
                        <p className="text-sm font-medium text-foreground">
                          No employees found
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Try another search term.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}