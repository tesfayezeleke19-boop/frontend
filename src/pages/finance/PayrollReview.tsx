
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Users,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";

import { financeApi } from "@/services/finance/api";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface PayrollLineItem {
  name?: string;
  amount?: number | string;
}

interface PayrollEmployeeRecord {
  id: string;
  employee_id?: string;
  employee_code?: string;
  machine_employee_no?: string;
  full_name?: string;
  employee_name?: string;
  name?: string;
  position?: string;
  basic_salary?: number | string;
  overtime_hours?: number | string;
  overtime_pay?: number | string;
  gross_salary?: number | string;
  income_tax?: number | string;
  pension?: number | string;
  total_deductions?: number | string;
  net_salary?: number | string;
  allowance_total?: number | string;
  other_deduction?: number | string;
  allowances?: PayrollLineItem[] | string | null;
  deductions?: PayrollLineItem[] | string | null;
  present_days?: number | string;
  [key: string]: unknown;
}

interface PayrollTotals {
  basic_salary?: number | string;
  overtime_pay?: number | string;
  gross_salary?: number | string;
  income_tax?: number | string;
  pension?: number | string;
  other_deduction?: number | string;
  total_deductions?: number | string;
  deductions?: number | string;
  net_salary?: number | string;
  total_amount?: number | string;
  employee_count?: number | string;
  [key: string]: unknown;
}

interface PayrollRun {
  id: string;
  payroll_id?: string;
  payroll_number?: string;
  period_year?: number | string;
  period_month?: number | string;
  month?: number | string;
  year?: number | string;
  status?: string;
  created_at?: string;
  submitted_at?: string;
  approved_at?: string;
  paid_at?: string;
  updated_at?: string;
  rejection_reason?: string;
  notes?: string;
  employee_count?: number | string;
  employees?: PayrollEmployeeRecord[];
  employee_records?: PayrollEmployeeRecord[];
  totals?: PayrollTotals;
  [key: string]: unknown;
}

type StatusFilter =
  | "ALL"
  | "PENDING_FINANCE_REVIEW"
  | "FINANCE_APPROVED"
  | "REJECTED"
  | "PAID";

type PayrollAction = "approve" | "reject" | "paid";

interface EmployeePayrollCalculation {
  allowance: number;
  otherDeduction: number;
  basicSalary: number;
  overtimeHours: number;
  overtimePay: number;
  grossSalary: number;
  incomeTax: number;
  pension: number;
  totalDeduction: number;
  netPay: number;
}

interface EthiopianPeriod {
  year: number;
  month: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const PENSION_RATE = 0.07;

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

const toNumber = (value: unknown): number => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const formatCurrency = (value: unknown): string =>
  new Intl.NumberFormat("en-ET", {
    style: "currency",
    currency: "ETB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));

const formatNumber = (value: unknown): string =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));

/**
 * Parse dates without allowing date-only values to shift because of UTC.
 */
const parseDate = (value?: string): Date | null => {
  if (!value) return null;

  let date: Date;

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;

    date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      12,
      0,
      0
    );
  } else {
    date = new Date(value);
  }

  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Format actual dates using the Ethiopian calendar.
 */
const formatDate = (value?: string): string => {
  const date = parseDate(value);

  if (!date) return "—";

  return new Intl.DateTimeFormat("en-ET-u-ca-ethiopic-nu-latn", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
};

/**
 * Convert a real Gregorian date to Ethiopian calendar parts.
 *
 * This is used only as a fallback when a payroll run does not have
 * its Ethiopian period_year and period_month.
 */
const toEthiopianPeriod = (date: Date): EthiopianPeriod | null => {
  const parts = new Intl.DateTimeFormat(
    "en-ET-u-ca-ethiopic-nu-latn",
    {
      year: "numeric",
      month: "numeric",
    }
  ).formatToParts(date);

  const yearPart = parts.find((part) => part.type === "year");
  const monthPart = parts.find((part) => part.type === "month");

  const year = Number(yearPart?.value);
  const month = Number(monthPart?.value);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    year <= 0 ||
    month < 1 ||
    month > 13
  ) {
    return null;
  }

  return { year, month };
};

/**
 * IMPORTANT:
 *
 * HR already creates payroll runs using the Ethiopian calendar.
 *
 * Therefore:
 * - period_year is the Ethiopian year.
 * - period_month is the Ethiopian month number.
 * - Months 1-12 represent the regular Ethiopian months.
 * - Month 13 represents Pagume.
 *
 * Do NOT convert these values from Gregorian dates.
 */
const getRunEthiopianPeriod = (
  run: PayrollRun
): EthiopianPeriod | null => {
  const yearValue = run.period_year ?? run.year;
  const monthValue = run.period_month ?? run.month;

  const year = toNumber(yearValue);
  const month = toNumber(monthValue);

  // Use HR's saved Ethiopian payroll period directly.
  if (
    year > 0 &&
    Number.isInteger(year) &&
    month >= 1 &&
    month <= 13 &&
    Number.isInteger(month)
  ) {
    return { year, month };
  }

  // Fallback only if the Ethiopian period is missing or invalid.
  const fallbackDate =
    parseDate(run.created_at) ||
    parseDate(run.submitted_at) ||
    parseDate(run.updated_at);

  if (!fallbackDate) return null;

  return toEthiopianPeriod(fallbackDate);
};

/**
 * All payroll period helpers use Ethiopian calendar values.
 */
const getRunYear = (run: PayrollRun): number =>
  getRunEthiopianPeriod(run)?.year || 0;

const getRunMonth = (run: PayrollRun): number =>
  getRunEthiopianPeriod(run)?.month || 0;

/**
 * Display the exact Ethiopian payroll month and year.
 */
const getRunPeriodLabel = (run: PayrollRun): string => {
  const period = getRunEthiopianPeriod(run);

  if (!period) return "—";

  const monthName = ETHIOPIAN_MONTHS[period.month - 1];

  if (!monthName) return "—";

  return `${monthName} ${period.year}`;
};

const getRunIdentifier = (run: PayrollRun): string =>
  String(run.payroll_id || run.id || "");

const getEmployees = (run?: PayrollRun | null): PayrollEmployeeRecord[] => {
  if (!run) return [];

  if (Array.isArray(run.employees)) return run.employees;
  if (Array.isArray(run.employee_records)) return run.employee_records;

  return [];
};

const getEmployeeName = (employee: PayrollEmployeeRecord): string =>
  String(
    employee.full_name ||
      employee.employee_name ||
      employee.name ||
      employee.employee_code ||
      employee.employee_id ||
      "Unknown employee"
  );

const getEmployeeCount = (run: PayrollRun): number => {
  const count = toNumber(run.employee_count);
  return count || getEmployees(run).length;
};

const parseLineItems = (
  value:
    | PayrollEmployeeRecord["allowances"]
    | PayrollEmployeeRecord["deductions"]
): PayrollLineItem[] => {
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};

const getLineItemTotal = (
  value:
    | PayrollEmployeeRecord["allowances"]
    | PayrollEmployeeRecord["deductions"]
): number =>
  parseLineItems(value).reduce(
    (total, item) => total + toNumber(item.amount),
    0
  );

const getAllowanceTotal = (employee: PayrollEmployeeRecord): number => {
  if (employee.allowance_total !== undefined) {
    return toNumber(employee.allowance_total);
  }

  return getLineItemTotal(employee.allowances);
};

const getOtherDeduction = (employee: PayrollEmployeeRecord): number => {
  if (employee.other_deduction !== undefined) {
    return toNumber(employee.other_deduction);
  }

  return getLineItemTotal(employee.deductions);
};

/**
 * Ethiopian progressive income-tax calculation.
 *
 * Confirm the applicable tax bands with the current official tax rules
 * before using this calculation for actual payroll payments.
 */
const calculateIncomeTax = (grossSalary: number): number => {
  const income = Math.max(0, grossSalary);

  if (income <= 2000) return 0;
  if (income <= 4000) return income * 0.15 - 300;
  if (income <= 7000) return income * 0.2 - 500;
  if (income <= 10000) return income * 0.25 - 850;
  if (income <= 14000) return income * 0.3 - 1350;

  return income * 0.35 - 2050;
};

const calculateEmployeePayroll = (
  employee: PayrollEmployeeRecord,
  override?: { allowance?: number; otherDeduction?: number }
): EmployeePayrollCalculation => {
  const basicSalary = toNumber(employee.basic_salary);
  const overtimeHours = toNumber(employee.overtime_hours);
  const overtimePay = toNumber(employee.overtime_pay);

  const allowance =
    override?.allowance !== undefined
      ? Math.max(0, override.allowance)
      : getAllowanceTotal(employee);

  const otherDeduction =
    override?.otherDeduction !== undefined
      ? Math.max(0, override.otherDeduction)
      : getOtherDeduction(employee);

  const grossSalary = basicSalary + allowance + overtimePay;
  const incomeTax = Math.max(0, calculateIncomeTax(grossSalary));
  const pension = grossSalary * PENSION_RATE;
  const totalDeduction = incomeTax + pension + otherDeduction;
  const netPay = grossSalary - totalDeduction;

  return {
    allowance,
    otherDeduction,
    basicSalary,
    overtimeHours,
    overtimePay,
    grossSalary,
    incomeTax,
    pension,
    totalDeduction,
    netPay,
  };
};

const calculateRunTotals = (run: PayrollRun): PayrollTotals => {
  const employees = getEmployees(run);

  const totals = employees.reduce(
    (result, employee) => {
      const calculation = calculateEmployeePayroll(employee);

      result.basic_salary += calculation.basicSalary;
      result.overtime_pay += calculation.overtimePay;
      result.gross_salary += calculation.grossSalary;
      result.income_tax += calculation.incomeTax;
      result.pension += calculation.pension;
      result.other_deduction += calculation.otherDeduction;
      result.total_deductions += calculation.totalDeduction;
      result.net_salary += calculation.netPay;

      return result;
    },
    {
      basic_salary: 0,
      overtime_pay: 0,
      gross_salary: 0,
      income_tax: 0,
      pension: 0,
      other_deduction: 0,
      total_deductions: 0,
      net_salary: 0,
    }
  );

  return {
    ...totals,
    employee_count: employees.length,
    deductions: totals.total_deductions,
    total_amount: totals.net_salary,
  };
};

const normalizeStatus = (status?: string): string =>
  String(status || "").trim().toUpperCase();

const getStatusLabel = (status?: string): string => {
  switch (normalizeStatus(status)) {
    case "PENDING_FINANCE_REVIEW":
      return "Pending Review";
    case "FINANCE_APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    case "PAID":
      return "Paid";
    case "DRAFT":
      return "Draft";
    case "CALCULATED":
      return "Calculated";
    default:
      return status || "Unknown";
  }
};

const getStatusVariant = (
  status?: string
): "default" | "secondary" | "destructive" | "outline" => {
  switch (normalizeStatus(status)) {
    case "PENDING_FINANCE_REVIEW":
      return "default";
    case "FINANCE_APPROVED":
      return "secondary";
    case "REJECTED":
      return "destructive";
    case "PAID":
      return "outline";
    default:
      return "secondary";
  }
};

const extractPayrollRuns = (response: unknown): PayrollRun[] => {
  if (Array.isArray(response)) return response as PayrollRun[];

  const data = response as {
    data?: unknown;
    payroll_runs?: unknown;
    payrollRuns?: unknown;
    runs?: unknown;
  };

  if (Array.isArray(data?.data)) return data.data as PayrollRun[];
  if (Array.isArray(data?.payroll_runs))
    return data.payroll_runs as PayrollRun[];
  if (Array.isArray(data?.payrollRuns))
    return data.payrollRuns as PayrollRun[];
  if (Array.isArray(data?.runs)) return data.runs as PayrollRun[];

  if (data?.data && typeof data.data === "object") {
    const nested = data.data as {
      payroll_runs?: unknown;
      runs?: unknown;
      items?: unknown;
    };

    if (Array.isArray(nested.payroll_runs))
      return nested.payroll_runs as PayrollRun[];
    if (Array.isArray(nested.runs)) return nested.runs as PayrollRun[];
    if (Array.isArray(nested.items)) return nested.items as PayrollRun[];
  }

  return [];
};

/* -------------------------------------------------------------------------- */
/* Excel export                                                               */
/* -------------------------------------------------------------------------- */

const createPayrollWorksheet = (run: PayrollRun): XLSX.WorkSheet => {
  const employees = getEmployees(run);

  const headers = [
    "Employee Name",
    "Basic Salary",
    "Allowance",
    "Overtime in Hr",
    "Overtime Payment",
    "Gross Salary",
    "Income Tax",
    "Pension",
    "Other Deduction",
    "Total Deduction",
    "Net Pay",
  ];

  const rows: (string | number)[][] = [
    [`Payroll: ${getRunIdentifier(run)}`],
    [`Period: ${getRunPeriodLabel(run)}`],
    [`Status: ${getStatusLabel(run.status)}`],
    [],
    headers,
  ];

  employees.forEach((employee) => {
    const calculation = calculateEmployeePayroll(employee);

    rows.push([
      getEmployeeName(employee),
      calculation.basicSalary,
      calculation.allowance,
      calculation.overtimeHours,
      calculation.overtimePay,
      0,
      0,
      0,
      calculation.otherDeduction,
      0,
      0,
    ]);
  });

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const firstEmployeeRow = 6;
  const lastEmployeeRow = firstEmployeeRow + employees.length - 1;

  employees.forEach((_, index) => {
    const row = firstEmployeeRow + index;

    worksheet[`F${row}`] = {
      t: "n",
      f: `B${row}+C${row}+E${row}`,
    };

    worksheet[`G${row}`] = {
      t: "n",
      f: `IF(F${row}<=2000,0,IF(F${row}<=4000,F${row}*15%-300,IF(F${row}<=7000,F${row}*20%-500,IF(F${row}<=10000,F${row}*25%-850,IF(F${row}<=14000,F${row}*30%-1350,F${row}*35%-2050)))))`,
    };

    worksheet[`H${row}`] = {
      t: "n",
      f: `F${row}*7%`,
    };

    worksheet[`J${row}`] = {
      t: "n",
      f: `G${row}+H${row}+I${row}`,
    };

    worksheet[`K${row}`] = {
      t: "n",
      f: `F${row}-J${row}`,
    };
  });

  if (employees.length > 0) {
    const totalRow = lastEmployeeRow + 1;

    worksheet[`A${totalRow}`] = { t: "s", v: "TOTAL" };

    ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"].forEach(
      (column) => {
        worksheet[`${column}${totalRow}`] = {
          t: "n",
          f: `SUM(${column}${firstEmployeeRow}:${column}${lastEmployeeRow})`,
        };
      }
    );
  }

  worksheet["!cols"] = [
    { wch: 28 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 19 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
    { wch: 19 },
    { wch: 19 },
    { wch: 18 },
  ];

  worksheet["!freeze"] = { xSplit: 0, ySplit: 5 };

  return worksheet;
};

const exportPayrollRun = (run: PayrollRun): void => {
  const workbook = XLSX.utils.book_new();
  const worksheet = createPayrollWorksheet(run);

  XLSX.utils.book_append_sheet(workbook, worksheet, "Payroll");

  const fileName = `Payroll_${getRunIdentifier(run)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
};

const exportAllPayrollRuns = (runs: PayrollRun[]): void => {
  const workbook = XLSX.utils.book_new();

  runs.forEach((run, index) => {
    const identifier = getRunIdentifier(run) || `Payroll_${index + 1}`;
    const sheetName = identifier.substring(0, 31) || `Payroll_${index + 1}`;

    XLSX.utils.book_append_sheet(
      workbook,
      createPayrollWorksheet(run),
      sheetName
    );
  });

  XLSX.writeFile(workbook, "Payroll_Review_Export.xlsx");
};

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function PayrollReview() {
  const navigate = useNavigate();

  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<PayrollAction | null>(
    null
  );
  const [rejectReason, setRejectReason] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showExpensePrompt, setShowExpensePrompt] = useState(false);

  const [dashboardYear, setDashboardYear] = useState("ALL");
  const [dashboardMonth, setDashboardMonth] = useState("ALL");

  const [employeeDrafts, setEmployeeDrafts] = useState<
    Record<string, { allowance: string; otherDeduction: string }>
  >({});
  const [savingEmployee, setSavingEmployee] = useState<string | null>(null);

  /* ---------------------------------------------------------------------- */
  /* Load payroll runs                                                      */
  /* ---------------------------------------------------------------------- */

  const loadPayrollRuns = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await financeApi.payrollRuns();
      const runs = extractPayrollRuns(response);

      setPayrollRuns(runs);

      setSelectedRun((current) => {
        if (!current) return null;

        const currentId = getRunIdentifier(current);

        return (
          runs.find((run) => getRunIdentifier(run) === currentId) || current
        );
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to load payroll records.";

      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPayrollRuns();
  }, [loadPayrollRuns]);

  /* ---------------------------------------------------------------------- */
  /* Ethiopian calendar filters and dashboard                              */
  /* ---------------------------------------------------------------------- */

  const availableYears = useMemo(() => {
    const years = payrollRuns
      .map(getRunYear)
      .filter((year) => year > 0);

    return Array.from(new Set(years)).sort((a, b) => b - a);
  }, [payrollRuns]);

  const periodRuns = useMemo(
    () =>
      payrollRuns.filter((run) => {
        const period = getRunEthiopianPeriod(run);

        if (!period) return false;

        const yearMatches =
          dashboardYear === "ALL" ||
          String(period.year) === dashboardYear;

        const monthMatches =
          dashboardMonth === "ALL" ||
          String(period.month) === dashboardMonth;

        return yearMatches && monthMatches;
      }),
    [payrollRuns, dashboardYear, dashboardMonth]
  );

  const dashboardTotals = useMemo(() => {
    return periodRuns.reduce(
      (total, run) => {
        const runTotals = calculateRunTotals(run);

        total.grossSalary += toNumber(runTotals.gross_salary);
        total.incomeTax += toNumber(runTotals.income_tax);
        total.pension += toNumber(runTotals.pension);
        total.netPay += toNumber(runTotals.net_salary);

        return total;
      },
      {
        grossSalary: 0,
        incomeTax: 0,
        pension: 0,
        netPay: 0,
      }
    );
  }, [periodRuns]);

  const filteredRuns = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return payrollRuns.filter((run) => {
      const statusMatches =
        statusFilter === "ALL" ||
        normalizeStatus(run.status) === statusFilter;

      const period = getRunEthiopianPeriod(run);

      const searchMatches =
        !normalizedSearch ||
        getRunIdentifier(run).toLowerCase().includes(normalizedSearch) ||
        String(period?.year || "").includes(normalizedSearch) ||
        String(period?.month || "").includes(normalizedSearch) ||
        getRunPeriodLabel(run).toLowerCase().includes(normalizedSearch) ||
        getEmployees(run).some((employee) =>
          getEmployeeName(employee).toLowerCase().includes(normalizedSearch)
        );

      return statusMatches && searchMatches;
    });
  }, [payrollRuns, search, statusFilter]);

  const statusCounts = useMemo(
    () => ({
      pending: payrollRuns.filter(
        (run) => normalizeStatus(run.status) === "PENDING_FINANCE_REVIEW"
      ).length,
      approved: payrollRuns.filter(
        (run) => normalizeStatus(run.status) === "FINANCE_APPROVED"
      ).length,
      rejected: payrollRuns.filter(
        (run) => normalizeStatus(run.status) === "REJECTED"
      ).length,
      paid: payrollRuns.filter(
        (run) => normalizeStatus(run.status) === "PAID"
      ).length,
    }),
    [payrollRuns]
  );

  const totalPendingAmount = useMemo(
    () =>
      payrollRuns
        .filter(
          (run) =>
            normalizeStatus(run.status) === "PENDING_FINANCE_REVIEW"
        )
        .reduce(
          (total, run) =>
            total + toNumber(calculateRunTotals(run).net_salary),
          0
        ),
    [payrollRuns]
  );

  /* ---------------------------------------------------------------------- */
  /* Employee editing                                                       */
  /* ---------------------------------------------------------------------- */

  const getEmployeeDraft = (employee: PayrollEmployeeRecord) => {
    const draft = employeeDrafts[employee.id];

    if (draft) return draft;

    return {
      allowance: String(getAllowanceTotal(employee)),
      otherDeduction: String(getOtherDeduction(employee)),
    };
  };

  const updateEmployeeDraft = (
    employee: PayrollEmployeeRecord,
    field: "allowance" | "otherDeduction",
    value: string
  ) => {
    const current = getEmployeeDraft(employee);

    setEmployeeDrafts((previous) => ({
      ...previous,
      [employee.id]: {
        ...current,
        [field]: value,
      },
    }));
  };

  const getEmployeeDraftCalculation = (
    employee: PayrollEmployeeRecord
  ): EmployeePayrollCalculation => {
    const draft = getEmployeeDraft(employee);

    const allowance = Math.max(0, toNumber(draft.allowance));
    const otherDeduction = Math.max(0, toNumber(draft.otherDeduction));

    return calculateEmployeePayroll(employee, {
      allowance,
      otherDeduction,
    });
  };

  const saveEmployeeChanges = async (
    employee: PayrollEmployeeRecord
  ) => {
    if (!selectedRun) return;

    if (normalizeStatus(selectedRun.status) === "PAID") {
      setError("Paid payroll records cannot be edited.");
      return;
    }

    const draft = getEmployeeDraft(employee);
    const allowance = Number(draft.allowance);
    const otherDeduction = Number(draft.otherDeduction);

    if (
      !Number.isFinite(allowance) ||
      !Number.isFinite(otherDeduction) ||
      allowance < 0 ||
      otherDeduction < 0
    ) {
      setError(
        "Allowance and other deduction must be valid non-negative numbers."
      );
      return;
    }

    const runId = getRunIdentifier(selectedRun);

    if (!employee.id) {
      setError("The employee payroll record ID is missing.");
      return;
    }

    setSavingEmployee(employee.id);
    setError("");
    setSuccess("");

    try {
      await financeApi.updatePayrollEmployee(runId, employee.id, {
        allowance,
        other_deduction: otherDeduction,
      });

      const refreshedResponse = await financeApi.payrollRun(runId);
      const refreshedData = refreshedResponse as {
        data?: PayrollRun;
        payroll_run?: PayrollRun;
      };

      const refreshedRun =
        (refreshedData?.data as PayrollRun) ||
        (refreshedData?.payroll_run as PayrollRun) ||
        (refreshedResponse as PayrollRun);

      if (refreshedRun && getRunIdentifier(refreshedRun)) {
        setSelectedRun(refreshedRun);

        setPayrollRuns((previous) =>
          previous.map((run) =>
            getRunIdentifier(run) === runId ? refreshedRun : run
          )
        );
      } else {
        await loadPayrollRuns();
      }

      setEmployeeDrafts((previous) => {
        const next = { ...previous };
        delete next[employee.id];
        return next;
      });

      setSuccess(`${getEmployeeName(employee)} payroll updated successfully.`);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to save employee payroll changes.";

      setError(message);
    } finally {
      setSavingEmployee(null);
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Payroll actions                                                        */
  /* ---------------------------------------------------------------------- */

  const openActionDialog = (action: PayrollAction, run: PayrollRun) => {
    setSelectedRun(run);
    setPendingAction(action);
    setRejectReason("");
    setError("");
    setShowConfirmDialog(true);
  };

  const handlePayrollAction = async () => {
    if (!selectedRun || !pendingAction) return;

    const runId = getRunIdentifier(selectedRun);

    if (!runId) {
      setError("Payroll run identifier is missing.");
      return;
    }

    if (pendingAction === "reject" && !rejectReason.trim()) {
      setError("Please enter a reason for rejecting this payroll.");
      return;
    }

    setProcessing(true);
    setError("");
    setSuccess("");

    try {
      if (pendingAction === "approve") {
        await financeApi.approvePayroll(runId);
        setSuccess("Payroll approved successfully.");
      } else if (pendingAction === "reject") {
        await financeApi.rejectPayroll(runId, rejectReason.trim());
        setSuccess("Payroll rejected successfully.");
      } else if (pendingAction === "paid") {
        await financeApi.markPayrollPaid(runId);
        setSuccess("Payroll marked as paid successfully.");
        setShowExpensePrompt(true);
      }

      setShowConfirmDialog(false);
      setPendingAction(null);

      await loadPayrollRuns();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "The requested payroll action failed.";

      setError(message);
    } finally {
      setProcessing(false);
    }
  };

  const openRunDetails = (run: PayrollRun) => {
    setSelectedRun(run);
    setEmployeeDrafts({});
    setShowDetails(true);
    setError("");
    setSuccess("");
  };

  const closeRunDetails = () => {
    setShowDetails(false);
    setEmployeeDrafts({});
    setError("");
    setSuccess("");
  };

  const goToExpenses = () => {
    setShowExpensePrompt(false);
    navigate("/finance/expenses", {
      state: { openExpenseForm: true },
    });
  };

  /* ---------------------------------------------------------------------- */
  /* Shared feedback                                                        */
  /* ---------------------------------------------------------------------- */

  const renderFeedback = () => (
    <>
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}
    </>
  );

  /* ---------------------------------------------------------------------- */
  /* Full-page payroll details                                              */
  /* ---------------------------------------------------------------------- */

  const renderPayrollDetails = () => {
    if (!selectedRun) return null;

    const totals = calculateRunTotals(selectedRun);
    const employees = getEmployees(selectedRun);
    const isPaid = normalizeStatus(selectedRun.status) === "PAID";

    return (
      <div className="w-full space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={closeRunDetails}
              title="Back to Payroll Records"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>

            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Payroll Review
              </h1>
              <p className="text-sm text-muted-foreground">
                Payroll ID: {getRunIdentifier(selectedRun)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getStatusVariant(selectedRun.status)}>
              {getStatusLabel(selectedRun.status)}
            </Badge>

            <Button
              variant="outline"
              onClick={() => exportPayrollRun(selectedRun)}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
          </div>
        </div>

        {renderFeedback()}

        <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Period</p>
            <p className="font-medium">{getRunPeriodLabel(selectedRun)}</p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Employees</p>
            <p className="font-medium">{getEmployeeCount(selectedRun)}</p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Submitted</p>
            <p className="font-medium">
              {formatDate(selectedRun.submitted_at)}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="font-medium">
              {getStatusLabel(selectedRun.status)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Gross Salary</p>
            <p className="mt-1 text-lg font-semibold">
              {formatCurrency(totals.gross_salary)}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Income Tax</p>
            <p className="mt-1 text-lg font-semibold">
              {formatCurrency(totals.income_tax)}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Pension (7%)</p>
            <p className="mt-1 text-lg font-semibold">
              {formatCurrency(totals.pension)}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Total Deduction</p>
            <p className="mt-1 text-lg font-semibold">
              {formatCurrency(totals.total_deductions)}
            </p>
          </div>

          <div className="col-span-2 rounded-lg border border-primary/30 bg-primary/5 p-4 lg:col-span-1">
            <p className="text-xs text-muted-foreground">Net Pay</p>
            <p className="mt-1 text-lg font-bold">
              {formatCurrency(totals.net_salary)}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Employee Payroll Details</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Change allowance or other deduction to recalculate the
                employee's payroll immediately. Select Save to persist
                the changes.
              </p>
            </div>
          </CardHeader>

          <CardContent>
            <div className="w-full overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="min-w-[190px]">
                      Employee
                    </TableHead>
                    <TableHead className="min-w-[125px] text-right">
                      Basic Salary
                    </TableHead>
                    <TableHead className="min-w-[135px]">
                      Allowance
                    </TableHead>
                    <TableHead className="min-w-[100px] text-right">
                      Overtime Hr
                    </TableHead>
                    <TableHead className="min-w-[135px] text-right">
                      Overtime Payment
                    </TableHead>
                    <TableHead className="min-w-[135px] text-right">
                      Gross Salary
                    </TableHead>
                    <TableHead className="min-w-[125px] text-right">
                      Income Tax
                    </TableHead>
                    <TableHead className="min-w-[115px] text-right">
                      Pension
                    </TableHead>
                    <TableHead className="min-w-[145px]">
                      Other Deduction
                    </TableHead>
                    <TableHead className="min-w-[140px] text-right">
                      Total Deduction
                    </TableHead>
                    <TableHead className="min-w-[135px] text-right">
                      Net Pay
                    </TableHead>
                    <TableHead className="min-w-[100px] text-right">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {employees.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={12}
                        className="py-10 text-center text-muted-foreground"
                      >
                        No employee records found for this payroll.
                      </TableCell>
                    </TableRow>
                  ) : (
                    employees.map((employee) => {
                      const draft = getEmployeeDraft(employee);
                      const calculation =
                        getEmployeeDraftCalculation(employee);

                      const isSaving = savingEmployee === employee.id;

                      const hasChanges =
                        Number(draft.allowance) !==
                          getAllowanceTotal(employee) ||
                        Number(draft.otherDeduction) !==
                          getOtherDeduction(employee);

                      return (
                        <TableRow key={employee.id}>
                          <TableCell>
                            <div className="font-medium">
                              {getEmployeeName(employee)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {employee.employee_code ||
                                employee.employee_id ||
                                employee.machine_employee_no ||
                                ""}
                            </div>
                          </TableCell>

                          <TableCell className="text-right tabular-nums">
                            {formatNumber(calculation.basicSalary)}
                          </TableCell>

                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={draft.allowance}
                              disabled={isPaid || isSaving}
                              className="h-9 min-w-[110px] text-right"
                              onChange={(event) =>
                                updateEmployeeDraft(
                                  employee,
                                  "allowance",
                                  event.target.value
                                )
                              }
                            />
                          </TableCell>

                          <TableCell className="text-right tabular-nums">
                            {formatNumber(calculation.overtimeHours)}
                          </TableCell>

                          <TableCell className="text-right tabular-nums">
                            {formatNumber(calculation.overtimePay)}
                          </TableCell>

                          <TableCell className="text-right font-medium tabular-nums">
                            {formatNumber(calculation.grossSalary)}
                          </TableCell>

                          <TableCell className="text-right tabular-nums">
                            {formatNumber(calculation.incomeTax)}
                          </TableCell>

                          <TableCell className="text-right tabular-nums">
                            {formatNumber(calculation.pension)}
                          </TableCell>

                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={draft.otherDeduction}
                              disabled={isPaid || isSaving}
                              className="h-9 min-w-[115px] text-right"
                              onChange={(event) =>
                                updateEmployeeDraft(
                                  employee,
                                  "otherDeduction",
                                  event.target.value
                                )
                              }
                            />
                          </TableCell>

                          <TableCell className="text-right tabular-nums">
                            {formatNumber(calculation.totalDeduction)}
                          </TableCell>

                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatNumber(calculation.netPay)}
                          </TableCell>

                          <TableCell className="text-right">
                            {!isPaid && (
                              <Button
                                size="sm"
                                variant={hasChanges ? "default" : "outline"}
                                disabled={!hasChanges || isSaving}
                                onClick={() =>
                                  void saveEmployeeChanges(employee)
                                }
                              >
                                {isSaving ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Save"
                                )}
                              </Button>
                            )}

                            {isPaid && (
                              <Badge variant="outline">Paid</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              Gross Salary = Basic Salary + Allowance + Overtime Payment.
              Total Deduction = Income Tax + Pension + Other Deduction.
              Net Pay = Gross Salary − Total Deduction.
            </p>
          </CardContent>
        </Card>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {normalizeStatus(selectedRun.status) ===
              "PENDING_FINANCE_REVIEW" && (
              <>
                <Button
                  variant="destructive"
                  onClick={() => openActionDialog("reject", selectedRun)}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </Button>

                <Button
                  onClick={() => openActionDialog("approve", selectedRun)}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Approve Payroll
                </Button>
              </>
            )}

            {normalizeStatus(selectedRun.status) === "FINANCE_APPROVED" && (
              <Button onClick={() => openActionDialog("paid", selectedRun)}>
                <Banknote className="mr-2 h-4 w-4" />
                Mark as Paid
              </Button>
            )}
          </div>

          <Button variant="outline" onClick={closeRunDetails}>
            Back to Payroll Records
          </Button>
        </div>
      </div>
    );
  };

  /* ---------------------------------------------------------------------- */
  /* Payroll records page                                                   */
  /* ---------------------------------------------------------------------- */

  const renderPayrollRecords = () => (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Payroll Review
          </h1>
        
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void loadPayrollRuns()}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>

          
        </div>
      </div>

      {renderFeedback()}

      {/* Status overview */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">
                Pending Review
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {statusCounts.pending}
              </p>
            </div>
            <div className="rounded-full bg-amber-100 p-3 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <Clock className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">Approved</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {statusCounts.approved}
              </p>
            </div>
            <div className="rounded-full bg-blue-100 p-3 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">Rejected</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {statusCounts.rejected}
              </p>
            </div>
            <div className="rounded-full bg-red-100 p-3 text-red-700 dark:bg-red-900/30 dark:text-red-300">
              <XCircle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">Paid Payrolls</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {statusCounts.paid}
              </p>
            </div>
            <div className="rounded-full bg-green-100 p-3 text-green-700 dark:bg-green-900/30 dark:text-green-300">
              <Banknote className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ethiopian period dashboard */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Payroll Financial Summary</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Financial totals for the selected Ethiopian payroll period,
              including all payroll statuses.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Select
              value={dashboardYear}
              onValueChange={setDashboardYear}
            >
              <SelectTrigger className="w-[145px]">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All years</SelectItem>
                {availableYears.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year} E.C.
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={dashboardMonth}
              onValueChange={setDashboardMonth}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Select Ethiopian month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All months</SelectItem>
                {ETHIOPIAN_MONTHS.map((month, index) => (
                  <SelectItem key={month} value={String(index + 1)}>
                    {month}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          <div className="mb-4 text-sm text-muted-foreground">
            Showing {periodRuns.length} payroll run
            {periodRuns.length === 1 ? "" : "s"}
            {dashboardYear !== "ALL"
              ? ` for Ethiopian year ${dashboardYear}`
              : ""}
            {dashboardMonth !== "ALL"
              ? ` — ${ETHIOPIAN_MONTHS[Number(dashboardMonth) - 1]}`
              : ""}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Gross Salary</p>
              <p className="mt-2 text-xl font-bold tabular-nums">
                {formatCurrency(dashboardTotals.grossSalary)}
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Income Tax</p>
              <p className="mt-2 text-xl font-bold tabular-nums">
                {formatCurrency(dashboardTotals.incomeTax)}
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Pension (7%)</p>
              <p className="mt-2 text-xl font-bold tabular-nums">
                {formatCurrency(dashboardTotals.pension)}
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Net Pay</p>
              <p className="mt-2 text-xl font-bold tabular-nums">
                {formatCurrency(dashboardTotals.netPay)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending amount */}
      <Card>
        <CardContent className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              Total Net Pay Awaiting Finance Review
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {formatCurrency(totalPendingAmount)}
            </p>
          </div>
          <Badge variant="default" className="w-fit">
            {statusCounts.pending} pending payroll
            {statusCounts.pending === 1 ? "" : "s"}
          </Badge>
        </CardContent>
      </Card>

      {/* Payroll history */}
      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>Payroll Records</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Select a payroll run to review employee salary details and
              financial calculations.
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search payroll ID or employee..."
                className="pl-9"
              />
            </div>

            <Select
              value={statusFilter}
              onValueChange={(value) =>
                setStatusFilter(value as StatusFilter)
              }
            >
              <SelectTrigger className="w-full md:w-[220px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="PENDING_FINANCE_REVIEW">
                  Pending Review
                </SelectItem>
                <SelectItem value="FINANCE_APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading payroll records...
            </div>
          ) : filteredRuns.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="font-medium">No payroll records found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try changing your search or status filter.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payroll ID</TableHead>
                    <TableHead>Period (E.C.)</TableHead>
                    <TableHead>Employees</TableHead>
                    <TableHead>Gross Salary</TableHead>
                    <TableHead>Income Tax</TableHead>
                    <TableHead>Pension</TableHead>
                    <TableHead>Net Pay</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filteredRuns.map((run) => {
                    const totals = calculateRunTotals(run);

                    return (
                      <TableRow key={getRunIdentifier(run)}>
                        <TableCell className="font-medium">
                          {getRunIdentifier(run)}
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          {getRunPeriodLabel(run)}
                        </TableCell>

                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            {getEmployeeCount(run)}
                          </span>
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          {formatCurrency(totals.gross_salary)}
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          {formatCurrency(totals.income_tax)}
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          {formatCurrency(totals.pension)}
                        </TableCell>

                        <TableCell className="whitespace-nowrap font-semibold">
                          {formatCurrency(totals.net_salary)}
                        </TableCell>

                        <TableCell>
                          <Badge variant={getStatusVariant(run.status)}>
                            {getStatusLabel(run.status)}
                          </Badge>
                        </TableCell>

                        <TableCell className="whitespace-nowrap">
                          {formatDate(
                            run.submitted_at ||
                              run.created_at ||
                              run.updated_at
                          )}
                        </TableCell>

                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="View payroll"
                              onClick={() => openRunDetails(run)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              title="Export payroll"
                              onClick={() => exportPayrollRun(run)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  /* ---------------------------------------------------------------------- */
  /* Render                                                                 */
  /* ---------------------------------------------------------------------- */

  return (
    <>
      {showDetails && selectedRun
        ? renderPayrollDetails()
        : renderPayrollRecords()}

      {/* Approve / Reject / Mark Paid confirmation */}
      <Dialog
        open={showConfirmDialog}
        onOpenChange={(open) => {
          setShowConfirmDialog(open);

          if (!open) {
            setPendingAction(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingAction === "approve"
                ? "Approve Payroll"
                : pendingAction === "reject"
                  ? "Reject Payroll"
                  : "Mark Payroll as Paid"}
            </DialogTitle>

            <DialogDescription>
              {pendingAction === "approve"
                ? "Are you sure you want to approve this payroll?"
                : pendingAction === "reject"
                  ? "Please provide a reason for rejecting this payroll."
                  : "Confirm that this payroll has been paid."}
            </DialogDescription>
          </DialogHeader>

          {pendingAction === "reject" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Rejection Reason
              </label>

              <Textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Enter the reason for rejection..."
                rows={4}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={processing}
              onClick={() => setShowConfirmDialog(false)}
            >
              Cancel
            </Button>

            <Button
              variant={pendingAction === "reject" ? "destructive" : "default"}
              disabled={processing}
              onClick={() => void handlePayrollAction()}
            >
              {processing && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}

              {pendingAction === "approve"
                ? "Confirm Approval"
                : pendingAction === "reject"
                  ? "Confirm Rejection"
                  : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Expense prompt after marking payroll paid */}
      <Dialog
        open={showExpensePrompt}
        onOpenChange={setShowExpensePrompt}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payroll Marked as Paid</DialogTitle>
            <DialogDescription>
              The payroll has been marked as paid successfully. Would you
              like to record the payroll payment in the Finance Expenses
              module?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowExpensePrompt(false)}
            >
              Later
            </Button>

            <Button onClick={goToExpenses}>
              Go to Expenses
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
