
import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminHRReport } from "@/hooks/use-admin-data";
import { financeApi } from "@/services/finance/api";
import {
  Users,
  UserCheck,
  UserX,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  Wallet,
  Banknote,
  TrendingUp,
  Receipt,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Ethiopian calendar                                                         */
/* -------------------------------------------------------------------------- */

const ETHIOPIAN_MONTHS = [
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

interface EthiopianPeriod {
  year: number;
  month: number;
}

function getCurrentEthiopianPeriod(): EthiopianPeriod {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-ethiopic-nu-latn", {
    year: "numeric",
    month: "numeric",
    timeZone: "Africa/Addis_Ababa",
  }).formatToParts(new Date());

  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? 2018),
    month: Number(parts.find((part) => part.type === "month")?.value ?? 1),
  };
}

function getRunPeriod(run: PayrollRun): EthiopianPeriod | null {
  const year = Number(run.period_year ?? run.year);
  const month = Number(run.period_month ?? run.month);

  // Payroll period fields are already Ethiopian calendar values.
  if (
    Number.isInteger(year) &&
    year > 0 &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 13
  ) {
    return { year, month };
  }

  // Only use actual dates as a fallback when period fields are unavailable.
  const dateValue = run.created_at || run.submitted_at || run.updated_at;

  if (!dateValue) return null;

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US-u-ca-ethiopic-nu-latn", {
    year: "numeric",
    month: "numeric",
    timeZone: "Africa/Addis_Ababa",
  }).formatToParts(date);

  const fallbackYear = Number(
    parts.find((part) => part.type === "year")?.value,
  );
  const fallbackMonth = Number(
    parts.find((part) => part.type === "month")?.value,
  );

  if (
    !Number.isInteger(fallbackYear) ||
    !Number.isInteger(fallbackMonth) ||
    fallbackMonth < 1 ||
    fallbackMonth > 13
  ) {
    return null;
  }

  return {
    year: fallbackYear,
    month: fallbackMonth,
  };
}

/* -------------------------------------------------------------------------- */
/* Payroll types                                                              */
/* -------------------------------------------------------------------------- */

interface PayrollEmployee {
  gross_salary?: number | string;
  net_salary?: number | string;
  income_tax?: number | string;
  tax?: number | string;
  pension?: number | string;
  pension_amount?: number | string;
  total_deductions?: number | string;
  total_deduction?: number | string;
  other_deduction?: number | string;
  deductions?: Array<{
    name?: string;
    label?: string;
    type?: string;
    amount?: number | string;
  }>;
  [key: string]: unknown;
}

interface PayrollRun {
  id?: string;
  payroll_id?: string;
  period_year?: number | string;
  period_month?: number | string;
  year?: number | string;
  month?: number | string;
  status?: string;
  created_at?: string;
  submitted_at?: string;
  updated_at?: string;
  employees?: PayrollEmployee[];
  employee_records?: PayrollEmployee[];
  payroll_run_employees?: PayrollEmployee[];
  totals?: Record<string, number | string>;
  [key: string]: unknown;
}

interface PayrollSummary {
  runs: number;
  employees: number;
  gross: number;
  tax: number;
  pension: number;
  otherDeductions: number;
  deductions: number;
  net: number;
  statuses: Record<string, number>;
}

/* -------------------------------------------------------------------------- */
/* Formatting and calculation helpers                                        */
/* -------------------------------------------------------------------------- */

function toNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function fmt(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "0.00";

  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtInt(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US");
}

function getPayrollEmployees(run: PayrollRun): PayrollEmployee[] {
  if (Array.isArray(run.employee_records)) {
    return run.employee_records;
  }

  if (Array.isArray(run.employees)) {
    return run.employees;
  }

  if (Array.isArray(run.payroll_run_employees)) {
    return run.payroll_run_employees;
  }

  return [];
}

function getDeductionByName(
  employee: PayrollEmployee,
  keywords: string[],
): number {
  if (!Array.isArray(employee.deductions)) return 0;

  return employee.deductions.reduce((sum, deduction) => {
    const name = String(
      deduction.name ?? deduction.label ?? deduction.type ?? "",
    ).toLowerCase();

    if (keywords.some((keyword) => name.includes(keyword))) {
      return sum + toNumber(deduction.amount);
    }

    return sum;
  }, 0);
}

function getEmployeeTax(employee: PayrollEmployee): number {
  const directTax = employee.income_tax ?? employee.tax;

  if (directTax != null) {
    return toNumber(directTax);
  }

  return getDeductionByName(employee, ["tax"]);
}

function getEmployeePension(employee: PayrollEmployee): number {
  const directPension =
    employee.pension ?? employee.pension_amount;

  if (directPension != null) {
    return toNumber(directPension);
  }

  return getDeductionByName(employee, ["pension"]);
}

function getEmployeeOtherDeductions(
  employee: PayrollEmployee,
): number {
  if (employee.other_deduction != null) {
    return toNumber(employee.other_deduction);
  }

  if (!Array.isArray(employee.deductions)) return 0;

  return employee.deductions.reduce((sum, deduction) => {
    const name = String(
      deduction.name ?? deduction.label ?? deduction.type ?? "",
    ).toLowerCase();

    if (name.includes("tax") || name.includes("pension")) {
      return sum;
    }

    return sum + toNumber(deduction.amount);
  }, 0);
}

function getRunTotal(
  run: PayrollRun,
  employees: PayrollEmployee[],
  employeeField: keyof PayrollEmployee,
  totalFields: string[],
): number {
  if (employees.length > 0) {
    return employees.reduce(
      (sum, employee) => sum + toNumber(employee[employeeField]),
      0,
    );
  }

  const totals = run.totals ?? {};

  for (const field of totalFields) {
    if (totals[field] != null) {
      return toNumber(totals[field]);
    }

    if (run[field] != null) {
      return toNumber(run[field]);
    }
  }

  return 0;
}

function calculatePayrollSummary(
  runs: PayrollRun[],
): PayrollSummary {
  const summary: PayrollSummary = {
    runs: runs.length,
    employees: 0,
    gross: 0,
    tax: 0,
    pension: 0,
    otherDeductions: 0,
    deductions: 0,
    net: 0,
    statuses: {},
  };

  for (const run of runs) {
    const employees = getPayrollEmployees(run);

    summary.employees += employees.length;

    summary.statuses[run.status || "UNKNOWN"] =
      (summary.statuses[run.status || "UNKNOWN"] || 0) + 1;

    summary.gross += getRunTotal(
      run,
      employees,
      "gross_salary",
      ["totalGross", "total_gross", "gross_salary", "gross"],
    );

    summary.net += getRunTotal(
      run,
      employees,
      "net_salary",
      ["totalNet", "total_net", "net_salary", "net"],
    );

    if (employees.length > 0) {
      for (const employee of employees) {
        const tax = getEmployeeTax(employee);
        const pension = getEmployeePension(employee);
        const other = getEmployeeOtherDeductions(employee);

        summary.tax += tax;
        summary.pension += pension;
        summary.otherDeductions += other;

        summary.deductions +=
          employee.total_deductions != null
            ? toNumber(employee.total_deductions)
            : employee.total_deduction != null
              ? toNumber(employee.total_deduction)
              : tax + pension + other;
      }
    } else {
      const totals = run.totals ?? {};

      summary.tax += toNumber(
        totals.totalTax ??
        totals.total_tax ??
        totals.income_tax ??
        run.total_tax,
      );

      summary.pension += toNumber(
        totals.totalPension ??
        totals.total_pension ??
        totals.pension ??
        run.total_pension,
      );

      summary.otherDeductions += toNumber(
        totals.otherDeductions ??
        totals.other_deductions ??
        run.other_deductions,
      );

      summary.deductions += toNumber(
        totals.totalDeductions ??
        totals.total_deductions ??
        run.total_deductions,
      );
    }
  }

  return summary;
}

function getPayrollRunList(response: unknown): PayrollRun[] {
  const result = response as {
    data?: unknown;
  };

  if (Array.isArray(response)) {
    return response as PayrollRun[];
  }

  if (Array.isArray(result?.data)) {
    return result.data as PayrollRun[];
  }

  const nested = result?.data as { data?: unknown } | undefined;

  if (Array.isArray(nested?.data)) {
    return nested.data as PayrollRun[];
  }

  return [];
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function AdminHRReports() {
  const [statusFilter, setStatusFilter] = useState<
    "active" | "inactive" | ""
  >("");

  const [positionFilter, setPositionFilter] = useState("");

  const currentPeriod = useMemo(
    () => getCurrentEthiopianPeriod(),
    [],
  );

  const [selectedYear, setSelectedYear] = useState(
    currentPeriod.year,
  );

  const [selectedMonth, setSelectedMonth] = useState<
    number | "ALL"
  >(currentPeriod.month);

  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [payrollLoading, setPayrollLoading] = useState(true);
  const [payrollError, setPayrollError] = useState("");

  const filters = {
    ...(statusFilter
      ? { status: statusFilter as "active" | "inactive" }
      : {}),
    ...(positionFilter ? { position: positionFilter } : {}),
  };

  const report = useAdminHRReport(
    statusFilter || positionFilter ? filters : undefined,
  );

  const data = report.data;

  /* ---------------------------------------------------------------------- */
  /* Load payroll runs                                                       */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    let mounted = true;

    async function loadPayrollRuns() {
      setPayrollLoading(true);
      setPayrollError("");

      try {
        const response = await financeApi.payrollRuns();

        if (mounted) {
          setPayrollRuns(getPayrollRunList(response));
        }
      } catch (error) {
        console.error("Unable to load payroll reports:", error);

        if (mounted) {
          setPayrollError(
            error instanceof Error
              ? error.message
              : "Unable to load payroll report data.",
          );
        }
      } finally {
        if (mounted) {
          setPayrollLoading(false);
        }
      }
    }

    loadPayrollRuns();

    return () => {
      mounted = false;
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Payroll period filters                                                  */
  /* ---------------------------------------------------------------------- */

  const availableYears = useMemo(() => {
    const years = new Set<number>([currentPeriod.year]);

    payrollRuns.forEach((run) => {
      const period = getRunPeriod(run);

      if (period) {
        years.add(period.year);
      }
    });

    return Array.from(years).sort((a, b) => b - a);
  }, [payrollRuns, currentPeriod.year]);

  const filteredPayrollRuns = useMemo(() => {
    return payrollRuns.filter((run) => {
      const period = getRunPeriod(run);

      if (!period) return false;

      const matchesYear = period.year === selectedYear;
      const matchesMonth =
        selectedMonth === "ALL" ||
        period.month === selectedMonth;

      return matchesYear && matchesMonth;
    });
  }, [payrollRuns, selectedYear, selectedMonth]);

  const payrollSummary = useMemo(
    () => calculatePayrollSummary(filteredPayrollRuns),
    [filteredPayrollRuns],
  );

  /* ---------------------------------------------------------------------- */
  /* Known positions                                                         */
  /* ---------------------------------------------------------------------- */

  const positions = [
    "Site Manager",
    "Safety Officer",
    "Driver",
    "Office Manager",
    "Loader Operator",
    "Supervisor",
  ];

  const clearEmployeeFilters = () => {
    setStatusFilter("");
    setPositionFilter("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          HR Reports
        </h1>

      </div>

      {/* Employee Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(
              e.target.value as "active" | "inactive" | "",
            )
          }
          className="h-9 rounded-lg border border-input bg-popover px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet/50"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <select
          value={positionFilter}
          onChange={(e) => setPositionFilter(e.target.value)}
          className="h-9 rounded-lg border border-input bg-popover px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet/50"
        >
          <option value="">All Positions</option>

          {positions.map((position) => (
            <option key={position} value={position}>
              {position}
            </option>
          ))}
        </select>

        {(statusFilter || positionFilter) && (
          <button
            onClick={clearEmployeeFilters}
            className="h-9 rounded-lg border border-input bg-popover px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Employee KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KPICard
          label="Total Employees"
          value={fmtInt(data?.employees.total ?? 0)}
          icon={Users}
          color="text-foreground"
          bg="bg-accent"
        />

        <KPICard
          label="Active"
          value={fmtInt(data?.employees.active ?? 0)}
          icon={UserCheck}
          color="text-success"
          bg="bg-success-soft"
        />

        <KPICard
          label="Inactive"
          value={fmtInt(data?.employees.inactive ?? 0)}
          icon={UserX}
          color="text-destructive"
          bg="bg-destructive-soft"
        />
      </div>

      {/* Employee by Position */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Employees by Position
          </CardTitle>
        </CardHeader>

        <CardContent>
          {data && data.employees.byPosition.length > 0 ? (
            <div className="space-y-2">
              {data.employees.byPosition.map((position) => {
                const maxVal = Math.max(
                  ...data.employees.byPosition.map((item) => item.value),
                  1,
                );

                const width = Math.max(
                  (position.value / maxVal) * 100,
                  5,
                );

                return (
                  <div
                    key={position.name}
                    className="flex items-center gap-3"
                  >
                    <span className="w-32 text-right text-xs text-muted-foreground">
                      {position.name}
                    </span>

                    <div className="flex-1">
                      <div className="h-5 rounded bg-accent">
                        <div
                          className="h-full rounded bg-info/60 transition-all"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>

                    <span className="w-10 text-right font-mono text-xs text-foreground">
                      {fmtInt(position.value)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground/70">
              No data
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attendance Summary */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Today's Attendance Summary
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatusStat
              label="Present"
              value={data?.attendance.present ?? 0}
              color="text-success"
              icon={
                <CheckCircle2 className="size-3.5 text-success" />
              }
            />

            <StatusStat
              label="Absent"
              value={data?.attendance.absent ?? 0}
              color="text-destructive"
              icon={<XCircle className="size-3.5 text-destructive" />}
            />

            <StatusStat
              label="Late"
              value={data?.attendance.late ?? 0}
              color="text-warning"
              icon={<Clock className="size-3.5 text-warning" />}
            />

            <StatusStat
              label="On Leave"
              value={data?.attendance.leave ?? 0}
              color="text-info"
              icon={<Calendar className="size-3.5 text-info" />}
            />
          </div>
        </CardContent>
      </Card>

      {/* Payroll Reports */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="space-y-4 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-medium text-foreground">
                Payroll Reports
              </CardTitle>

              <p className="mt-1 text-xs text-muted-foreground">
                Financial summary by Ethiopian payroll period.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="rounded-md border border-input bg-popover px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                E.C.
              </span>

              <button
                type="button"
                onClick={() => {
                  setSelectedYear(currentPeriod.year);
                  setSelectedMonth(currentPeriod.month);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-popover px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="size-3" />
                Current Period
              </button>
            </div>
          </div>

          {/* Payroll Year and Month Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-muted-foreground" />

              <span className="text-xs text-muted-foreground">
                Year
              </span>

              <select
                value={selectedYear}
                onChange={(e) =>
                  setSelectedYear(Number(e.target.value))
                }
                className="h-9 min-w-24 rounded-lg border border-input bg-popover px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet/50"
              >
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year} E.C.
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Month
              </span>

              <select
                value={selectedMonth}
                onChange={(e) =>
                  setSelectedMonth(
                    e.target.value === "ALL"
                      ? "ALL"
                      : Number(e.target.value),
                  )
                }
                className="h-9 min-w-36 rounded-lg border border-input bg-popover px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet/50"
              >
                <option value="ALL">All Months</option>

                {ETHIOPIAN_MONTHS.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Showing payroll for{" "}
            <span className="font-medium text-foreground">
              {selectedMonth === "ALL"
                ? `All months of ${selectedYear} E.C.`
                : `${ETHIOPIAN_MONTHS[selectedMonth - 1]} ${selectedYear} E.C.`}
            </span>
          </div>
        </CardHeader>

        <CardContent>
          {payrollError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span>{payrollError}</span>
            </div>
          )}

          {payrollLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" />
              Loading payroll report...
            </div>
          ) : (
            <>
              {/* Payroll KPI Cards */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <PayrollStat
                  label="Payroll Runs"
                  value={fmtInt(payrollSummary.runs)}
                  description="Runs in selected period"
                  icon={Wallet}
                  color="text-foreground"
                  bg="bg-accent"
                />

                <PayrollStat
                  label="Employees Paid / Included"
                  value={fmtInt(payrollSummary.employees)}
                  description="Employee payroll records"
                  icon={Users}
                  color="text-info"
                  bg="bg-info/10"
                />

                <PayrollStat
                  label="Gross Salary"
                  value={`ETB ${fmt(payrollSummary.gross)}`}
                  description="Total gross payroll"
                  icon={TrendingUp}
                  color="text-foreground"
                  bg="bg-accent"
                />

                <PayrollStat
                  label="Total Income Tax"
                  value={`ETB ${fmt(payrollSummary.tax)}`}
                  description="Employee income tax"
                  icon={Receipt}
                  color="text-warning"
                  bg="bg-warning/10"
                />

                <PayrollStat
                  label="Total Pension"
                  value={`ETB ${fmt(payrollSummary.pension)}`}
                  description="Employee pension contribution"
                  icon={ShieldCheck}
                  color="text-info"
                  bg="bg-info/10"
                />

                <PayrollStat
                  label="Other Deductions"
                  value={`ETB ${fmt(payrollSummary.otherDeductions)}`}
                  description="Additional employee deductions"
                  icon={Banknote}
                  color="text-muted-foreground"
                  bg="bg-accent"
                />

                <PayrollStat
                  label="Total Deductions"
                  value={`ETB ${fmt(payrollSummary.deductions)}`}
                  description="Tax, pension, and other deductions"
                  icon={Receipt}
                  color="text-destructive"
                  bg="bg-destructive-soft"
                />

                <PayrollStat
                  label="Net Salary"
                  value={`ETB ${fmt(payrollSummary.net)}`}
                  description="Total net payroll"
                  icon={Wallet}
                  color="text-success"
                  bg="bg-success-soft"
                />
              </div>

              {/* Payroll Status Summary */}
              {payrollSummary.runs > 0 && (
                <div className="mt-5 border-t border-border pt-4">
                  <h4 className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
                    Payroll Status
                  </h4>

                  <div className="flex flex-wrap gap-2">
                    {Object.entries(payrollSummary.statuses).map(
                      ([status, count]) => (
                        <span
                          key={status}
                          className="inline-flex items-center gap-1.5 rounded-full border border-input bg-popover px-2.5 py-1 text-[10px] font-medium text-foreground"
                        >
                          {status.replace(/_/g, " ")}:{" "}
                          {fmtInt(count)}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              )}

              {/* Empty State */}
              {payrollSummary.runs === 0 && (
                <div className="py-10 text-center">
                  <Wallet className="mx-auto mb-3 size-8 text-muted-foreground/40" />

                  <p className="text-sm font-medium text-foreground">
                    No payroll records found
                  </p>

                  <p className="mt-1 text-xs text-muted-foreground">
                    There are no payroll runs for the selected Ethiopian
                    calendar period.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Pending Leave */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Leave Requests
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">
                Pending Leave Requests
              </div>

              <div className="mt-1 text-xs text-muted-foreground/70">
                Requests awaiting review
              </div>
            </div>

            <span className="font-heading text-lg font-semibold text-warning">
              {fmtInt(data?.pendingLeave ?? 0)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Reusable components                                                        */
/* -------------------------------------------------------------------------- */

function KPICard({
  label,
  value,
  icon: Icon,
  color,
  bg,
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  bg: string;
}) {
  return (
    <Card className="border-border bg-card shadow-none">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {label}
          </span>

          <div
            className={`flex size-7 items-center justify-center rounded-lg ${bg}`}
          >
            <Icon className={`size-3.5 ${color}`} />
          </div>
        </div>

        <div className="mt-2 font-heading text-xl font-semibold text-foreground">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function PayrollStat({
  label,
  value,
  description,
  icon: Icon,
  color,
  bg,
}: {
  label: string;
  value: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  bg: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-sidebar p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {label}
          </p>

          <p className="mt-2 break-words font-heading text-lg font-semibold text-foreground">
            {value}
          </p>
        </div>

        <div className={`rounded-lg p-2 ${bg}`}>
          <Icon className={`size-4 ${color}`} />
        </div>
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function StatusStat({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-sidebar p-3">
      <div className="flex items-center gap-2">
        {icon}

        <span className="text-xs text-muted-foreground">
          {label}
        </span>
      </div>

      <div
        className={`mt-2 font-heading text-xl font-semibold ${color}`}
      >
        {fmtInt(value)}
      </div>
    </div>
  );
}
