import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  RefreshCw,
  Calculator,
  Send,
  Lock,
  Clock3,
  Users,
  Wallet,
  CircleDollarSign,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";

import { HR_API_BASE_URL } from "@/lib/api/config";
import { getHrAuthToken } from "@/services/hr/apiClient";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type PayrollStatus =
  | "DRAFT"
  | "CALCULATED"
  | "PENDING_FINANCE_REVIEW"
  | "FINANCE_APPROVED"
  | "PAID"
  | "REJECTED";

interface PayrollEmployee {
  id: string;
  employeeId: string;
  machineEmployeeNo: string;
  fullName: string;
  presentDays: number;
  overtimeHours: number;
  basicSalary: number;
  overtimePay: number;
  grossSalary: number;
  netSalary: number;
}

interface PayrollRun {
  id: string;
  payrollId: string;
  periodMonth: number;
  periodYear: number;
  periodLabel: string;
  status: PayrollStatus;
  overtimeRate: number;
  employees: PayrollEmployee[];
}

interface ApiEnvelope<T> {
  success?: boolean;
  message?: string;
  data?: T;
  errors?: Record<string, string>;
}

const API_ROOT = `${HR_API_BASE_URL.replace(/\/+$/, "")}/api/hr/payroll`;

const MONTHS = [
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

function getCurrentEthiopianPeriod() {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-ethiopic-nu-latn", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());

  const getPart = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    month: getPart("month"),
    year: getPart("year"),
  };
}

const money = (value: number) =>
  new Intl.NumberFormat("en-ET", {
    style: "currency",
    currency: "ETB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const number = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function getToken(): string | null {
  const token = getHrAuthToken();
  if (token) return token;

  if (typeof window === "undefined") return null;

  for (const storage of [window.sessionStorage, window.localStorage]) {
    for (const key of [
      "access_token",
      "accessToken",
      "auth_token",
      "token",
      "nexerp.auth.token",
    ]) {
      const value = storage.getItem(key);
      if (value?.trim()) return value.trim();
    }

    for (const key of [
      "nexerp.auth.session.v1",
      "auth_session",
      "authSession",
    ]) {
      const raw = storage.getItem(key);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        const value =
          parsed.accessToken ?? parsed.access_token ?? parsed.token;

        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      } catch {
        // Ignore unrelated session values.
      }
    }
  }

  return null;
}

async function payrollRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();

  if (!token) {
    throw new Error(
      "Your authentication token was not found. Please sign in again.",
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
    response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      "Unable to connect to the payroll API. Check your backend connection.",
    );
  }

  const raw = await response.text();
  let body: any = null;

  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { message: raw };
    }
  }

  if (!response.ok || body?.success === false) {
    const errors =
      body?.errors && typeof body.errors === "object"
        ? Object.values(body.errors).join(" ")
        : "";

    throw new Error(
      body?.messages?.error ||
        body?.message ||
        errors ||
        `Payroll request failed (${response.status}).`,
    );
  }

  return body as T;
}

function unwrap<T>(response: any): T {
  return response?.data !== undefined ? response.data : response;
}

function normalizeEmployee(raw: any): PayrollEmployee {
  return {
    id: String(raw.employee_id ?? raw.id ?? ""),
    employeeId: String(
      raw.employee_code ?? raw.employeeId ?? raw.employee_id_number ?? "",
    ),
    machineEmployeeNo: String(
      raw.machine_employee_no ?? raw.machineEmployeeNo ?? raw.machine_id ?? "",
    ),
    fullName: String(raw.full_name ?? raw.fullName ?? ""),
    presentDays: number(
      raw.present_days ?? raw.presentDays ?? raw.status,
    ),
    overtimeHours: number(
      raw.overtime_hours ?? raw.overtimeHours,
    ),
    basicSalary: number(
      raw.basic_salary ?? raw.basicSalary,
    ),
    overtimePay: number(
      raw.overtime_pay ?? raw.overtimePay,
    ),
    grossSalary: number(
      raw.gross_salary ?? raw.grossSalary,
    ),
    netSalary: number(
      raw.net_salary ?? raw.netSalary ?? raw.gross_salary ?? raw.grossSalary,
    ),
  };
}

function normalizeRun(raw: any): PayrollRun {
  const source = raw?.payroll_run ?? raw?.run ?? raw;

  const employeeRows =
    source?.employees ??
    source?.payroll_employees ??
    source?.payroll_run_employees ??
    [];

  return {
    id: String(source?.id ?? source?.payroll_run_id ?? ""),
    payrollId: String(source?.payroll_id ?? source?.payrollId ?? ""),
    periodMonth: number(source?.period_month ?? source?.periodMonth),
    periodYear: number(source?.period_year ?? source?.periodYear),
    periodLabel: String(source?.period_label ?? source?.periodLabel ?? ""),
    status: String(source?.status ?? "DRAFT").toUpperCase() as PayrollStatus,
    overtimeRate: number(source?.overtime_rate ?? source?.overtimeRate),
    employees: Array.isArray(employeeRows)
      ? employeeRows.map(normalizeEmployee)
      : [],
  };
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function Payroll() {
  const currentEthiopianPeriod = getCurrentEthiopianPeriod();

  const [selectedMonth, setSelectedMonth] = useState(currentEthiopianPeriod.month);
  const [selectedYear, setSelectedYear] = useState(currentEthiopianPeriod.year);

  const [payroll, setPayroll] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingEmployee, setSavingEmployee] = useState<string | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isLocked =
    payroll?.status === "PENDING_FINANCE_REVIEW" ||
    payroll?.status === "FINANCE_APPROVED" ||
    payroll?.status === "PAID";

  const canEdit = Boolean(payroll && !isLocked);

  const totals = useMemo(() => {
    const employees = payroll?.employees ?? [];

    return employees.reduce(
      (result, employee) => {
        result.basicSalary += employee.basicSalary;
        result.overtimePay += employee.overtimePay;
        result.total += employee.grossSalary;
        result.overtimeHours += employee.overtimeHours;
        result.presentDays += employee.presentDays;
        return result;
      },
      {
        basicSalary: 0,
        overtimePay: 0,
        total: 0,
        overtimeHours: 0,
        presentDays: 0,
      },
    );
  }, [payroll]);

  const clearMessages = () => {
    setError("");
    setSuccess("");
  };

  const loadPayroll = useCallback(async () => {
    setLoading(true);
    clearMessages();

    try {
      const response = await payrollRequest<any>(
        `?period_month=${selectedMonth}&period_year=${selectedYear}`,
      );

      const result = unwrap<any>(response);
      const rows = Array.isArray(result)
        ? result
        : result?.payrolls ?? result?.runs ?? [];

      const existing = rows.find(
        (row: any) =>
          number(row.period_month) === selectedMonth &&
          number(row.period_year) === selectedYear,
      );

      if (existing) {
        const run = normalizeRun(existing);

        if (run.id) {
          const detailResponse = await payrollRequest<any>(`/${run.id}`);
          setPayroll(normalizeRun(unwrap(detailResponse)));
        } else {
          setPayroll(run);
        }
      } else {
        setPayroll(null);
      }
    } catch (err) {
      setPayroll(null);
      setError(
        err instanceof Error ? err.message : "Unable to load payroll.",
      );
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedYear]);

  useEffect(() => {
    void loadPayroll();
  }, [loadPayroll]);

  const generatePayroll = async () => {
    setGenerating(true);
    clearMessages();

    try {
      const response = await payrollRequest<any>("", {
        method: "POST",
        body: JSON.stringify({
          period_month: selectedMonth,
          period_year: selectedYear,
        }),
      });

      const created = normalizeRun(unwrap(response));

      if (!created.id) {
        throw new Error(
          "The backend did not return a payroll run ID.",
        );
      }

      await payrollRequest(`/${created.id}/calculate`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      const detailResponse = await payrollRequest<any>(`/${created.id}`);
      setPayroll(normalizeRun(unwrap(detailResponse)));
      setSuccess("Monthly payroll generated successfully.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to generate payroll.",
      );
    } finally {
      setGenerating(false);
    }
  };

  const updateEmployee = async (
    employee: PayrollEmployee,
    field: "basicSalary" | "overtimeHours",
    value: number,
  ) => {
    if (!payroll || !canEdit) return;

    if (!Number.isFinite(value) || value < 0) return;

    const updated = {
      ...employee,
      [field]: value,
    };

    const hourlyRate = updated.basicSalary / 208;
    const overtimePay =
      hourlyRate *
      updated.overtimeHours *
      (payroll.overtimeRate / 100);

    updated.overtimePay = Number(overtimePay.toFixed(2));
    updated.grossSalary = Number(
      (updated.basicSalary + updated.overtimePay).toFixed(2),
    );
    updated.netSalary = updated.grossSalary;

    setPayroll((current) =>
      current
        ? {
            ...current,
            employees: current.employees.map((row) =>
              row.id === employee.id ? updated : row,
            ),
          }
        : current,
    );
  };

  const saveEmployee = async (employee: PayrollEmployee) => {
    if (!payroll || !canEdit) return;

    setSavingEmployee(employee.id);
    clearMessages();

    try {
      await payrollRequest(
        `/${payroll.id}/employees/${employee.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            basic_salary: employee.basicSalary,
            overtime_hours: employee.overtimeHours,
          }),
        },
      );

      const response = await payrollRequest<any>(`/${payroll.id}`);
      setPayroll(normalizeRun(unwrap(response)));
      setSuccess(`Payroll details saved for ${employee.fullName}.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save employee payroll.",
      );
      await loadPayroll();
    } finally {
      setSavingEmployee(null);
    }
  };

  const submitPayroll = async () => {
    if (!payroll || !canEdit) return;

    const confirmed = window.confirm(
      `Submit payroll for ${MONTHS[payroll.periodMonth - 1]} ${payroll.periodYear} to Finance? Once submitted, HR cannot edit it.`,
    );

    if (!confirmed) return;

    setSubmitting(true);
    clearMessages();

    try {
      await payrollRequest(`/${payroll.id}/submit`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await payrollRequest<any>(`/${payroll.id}`);
      setPayroll(normalizeRun(unwrap(response)));
      setSuccess("Payroll submitted successfully to Finance.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to submit payroll.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const statusClass = (status?: PayrollStatus) => {
    switch (status) {
      case "PAID":
        return "bg-success-soft text-success border border-success-border";

      case "FINANCE_APPROVED":
        return "bg-info/10 text-info border border-info/20";

      case "PENDING_FINANCE_REVIEW":
        return "bg-warning-soft text-warning border border-warning-border";

      case "REJECTED":
        return "bg-destructive/10 text-destructive border border-destructive/20";

      case "CALCULATED":
        return "bg-violet/10 text-violet border border-violet/20";

      default:
        return "bg-muted text-muted-foreground border border-border";
    }
  };

  const years = Array.from(
    { length: 8 },
    (_, index) => currentEthiopianPeriod.year - 5 + index,
  );

  /* ------------------------------------------------------------------------ */
  /* Render                                                                   */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="space-y-6 p-4 text-foreground md:p-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Payroll
          </h1>
          
        </div>

        <button
          type="button"
          onClick={() => void loadPayroll()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw
            size={16}
            className={loading ? "animate-spin" : ""}
          />
          Refresh
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 rounded-lg border border-success-border bg-success-soft p-3 text-sm text-success">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Period selection */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <CalendarDays size={19} className="text-muted-foreground" />
          <h2 className="font-semibold text-foreground">
            Payroll period
          </h2>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:max-w-xs">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Month
            </label>
            <select
              value={selectedMonth}
              onChange={(event) =>
                setSelectedMonth(Number(event.target.value))
              }
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:max-w-xs">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Year
            </label>
            <select
              value={selectedYear}
              onChange={(event) =>
                setSelectedYear(Number(event.target.value))
              }
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={generatePayroll}
            disabled={generating || loading || Boolean(payroll)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? (
              <Loader2 size={17} className="animate-spin" />
            ) : (
              <Calculator size={17} />
            )}
            {generating ? "Generating..." : "Generate payroll"}
          </button>
        </div>

        {payroll && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">
              Payroll period:
            </span>
            <span className="text-sm font-semibold text-foreground">
              {MONTHS[payroll.periodMonth - 1]} {payroll.periodYear}
            </span>

            <span
              className={`ml-1 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(
                payroll.status,
              )}`}
            >
              {payroll.status}
            </span>

            {isLocked && (
              <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Lock size={13} />
                Editing locked
              </span>
            )}
          </div>
        )}
      </section>

      {/* Summary cards */}
      {payroll && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Employees"
              value={String(payroll.employees.length)}
              icon={<Users size={20} />}
              description="Included in this payroll"
            />
            <SummaryCard
              title="Basic salary"
              value={money(totals.basicSalary)}
              icon={<Wallet size={20} />}
              description="Total monthly basic salary"
            />
            <SummaryCard
              title="Overtime payment"
              value={money(totals.overtimePay)}
              icon={<Clock3 size={20} />}
              description={`${totals.overtimeHours.toFixed(2)} overtime hours`}
            />
            <SummaryCard
              title="Total payroll"
              value={money(totals.total)}
              icon={<CircleDollarSign size={20} />}
              description="Basic salary + overtime"
            />
          </div>
          

          {/* Employee payroll table */}
          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-col justify-between gap-2 border-b border-border p-5 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-semibold text-foreground">
                  Monthly payroll report
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Review employee attendance, overtime, and salary details.
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {payroll.employees.length} employees
              </span>
            </div>

            {payroll.employees.length === 0 ? (
              <div className="p-10 text-center">
                <Users
                  size={32}
                  className="mx-auto mb-3 text-muted-foreground/50"
                />
                <p className="font-medium text-foreground">
                  No employee payroll records
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The backend did not return any payroll employees.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1150px] text-left text-sm">
                  <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">Full name</th>
                      <th className="px-4 py-3 text-center">
                        Present days
                      </th>
                      <th className="px-4 py-3 text-right">
                        Overtime hours
                      </th>
                      <th className="px-4 py-3 text-right">
                        Basic salary
                      </th>
                      <th className="px-4 py-3 text-right">
                        Overtime payment
                      </th>
                      <th className="px-4 py-3 text-right">
                        Total
                      </th>
                      {canEdit && (
                        <th className="px-4 py-3 text-center">
                          Action
                        </th>
                      )}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-border">
                    {payroll.employees.map((employee) => (
                      <PayrollEmployeeRow
                        key={employee.id}
                        employee={employee}
                        editable={canEdit}
                        saving={savingEmployee === employee.id}
                        onChange={updateEmployee}
                        onSave={saveEmployee}
                      />
                    ))}
                  </tbody>

                  <tfoot className="border-t-2 border-border bg-muted font-semibold text-foreground">
                    <tr>
                      <td
                        colSpan={2}
                        className="px-4 py-4 text-right"
                      >
                        TOTAL
                      </td>
                      <td className="px-4 py-4 text-center">
                        {totals.presentDays}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {totals.overtimeHours.toFixed(2)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {money(totals.basicSalary)}
                      </td>
                      <td className="px-4 py-4 text-right text-info">
                        {money(totals.overtimePay)}
                      </td>
                      <td className="px-4 py-4 text-right text-success">
                        {money(totals.total)}
                      </td>
                      {canEdit && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="flex flex-col justify-between gap-3 border-t border-border p-4 sm:flex-row sm:items-center">
              <p className="text-xs text-muted-foreground">
                {canEdit
                  ? "Save employee changes before submitting payroll."
                  : "This payroll is locked and can no longer be edited by HR."}
              </p>

              {canEdit && payroll.employees.length > 0 && (
                <button
                  type="button"
                  onClick={submitPayroll}
                  disabled={submitting || Boolean(savingEmployee)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-success px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Send size={17} />
                  )}
                  {submitting
                    ? "Submitting..."
                    : "Submit payroll to Finance"}
                </button>
              )}
            </div>
          </section>
        </>
      )}

      {/* Empty state */}
      {!payroll && !loading && (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <CalendarDays size={26} className="text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-foreground">
            No payroll generated for this period
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Select a month and year, then generate payroll to calculate
            employee salaries using saved attendance and overtime records.
          </p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-12 text-sm text-muted-foreground">
          <Loader2 size={18} className="animate-spin" />
          Loading payroll...
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary card                                                               */
/* -------------------------------------------------------------------------- */

function SummaryCard({
  title,
  value,
  icon,
  description,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div className="rounded-lg bg-info/10 p-2 text-info">
          {icon}
        </div>
      </div>
      <p className="mt-3 break-words text-xl font-bold text-foreground">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Employee row                                                               */
/* -------------------------------------------------------------------------- */

function PayrollEmployeeRow({
  employee,
  editable,
  saving,
  onChange,
  onSave,
}: {
  employee: PayrollEmployee;
  editable: boolean;
  saving: boolean;
  onChange: (
    employee: PayrollEmployee,
    field: "basicSalary" | "overtimeHours",
    value: number,
  ) => void;
  onSave: (employee: PayrollEmployee) => void;
}) {
  const [basicSalary, setBasicSalary] = useState(
    String(employee.basicSalary),
  );
  const [overtimeHours, setOvertimeHours] = useState(
    String(employee.overtimeHours),
  );

  useEffect(() => {
    setBasicSalary(String(employee.basicSalary));
    setOvertimeHours(String(employee.overtimeHours));
  }, [employee.basicSalary, employee.overtimeHours]);

  const handleSave = () => {
    const salary = Number(basicSalary);
    const overtime = Number(overtimeHours);

    if (
      !Number.isFinite(salary) ||
      !Number.isFinite(overtime) ||
      salary < 0 ||
      overtime < 0
    ) {
      return;
    }

    const updated = {
      ...employee,
      basicSalary: salary,
      overtimeHours: overtime,
    };

    onChange(employee, "basicSalary", salary);
    onChange(
      { ...employee, basicSalary: salary },
      "overtimeHours",
      overtime,
    );

    onSave(updated);
  };

  return (
    <tr className="transition-colors hover:bg-muted/50">
      <td className="px-4 py-3 font-medium text-muted-foreground">
        {employee.machineEmployeeNo ||
          employee.employeeId ||
          "—"}
      </td>

      <td className="px-4 py-3">
        <span className="font-medium text-foreground">
          {employee.fullName || "Unnamed employee"}
        </span>
      </td>

      <td className="px-4 py-3 text-center">
        <span className="inline-flex min-w-9 justify-center rounded-full border border-success-border bg-success-soft px-2.5 py-1 font-semibold text-success">
          {employee.presentDays}
        </span>
      </td>

      <td className="px-4 py-3 text-right">
        {editable ? (
          <input
            type="number"
            min="0"
            step="0.25"
            value={overtimeHours}
            onChange={(event) => {
              const value = event.target.value;
              setOvertimeHours(value);
              onChange(
                employee,
                "overtimeHours",
                Number(value),
              );
            }}
            className="w-24 rounded-md border border-input bg-background px-2 py-1.5 text-right text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        ) : (
          <span className="text-foreground">
            {employee.overtimeHours.toFixed(2)}
          </span>
        )}
      </td>

      <td className="px-4 py-3 text-right">
        {editable ? (
          <input
            type="number"
            min="0"
            step="0.01"
            value={basicSalary}
            onChange={(event) => {
              const value = event.target.value;
              setBasicSalary(value);
              onChange(
                employee,
                "basicSalary",
                Number(value),
              );
            }}
            className="w-32 rounded-md border border-input bg-background px-2 py-1.5 text-right text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        ) : (
          <span className="text-foreground">
            {money(employee.basicSalary)}
          </span>
        )}
      </td>

      <td className="px-4 py-3 text-right font-medium text-info">
        {money(employee.overtimePay)}
      </td>

      <td className="px-4 py-3 text-right font-semibold text-foreground">
        {money(employee.grossSalary)}
      </td>

      {editable && (
        <td className="px-4 py-3 text-center">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center justify-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              "Save"
            )}
          </button>
        </td>
      )}
    </tr>
  );
}