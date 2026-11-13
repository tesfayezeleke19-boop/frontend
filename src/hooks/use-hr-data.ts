
/**
 * React hooks for the HR data layer.
 *
 * Dashboard, employees, attendance, and leave use the centralized HR API
 * client. Payroll uses the API-backed payroll repository.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getHRApiClient,
  type HRApiClient,
} from "@/services/hr/apiClient";

import type {
  AttendanceInput,
  AttendanceQueryParams,
  AttendanceRecord,
  Employee,
  EmployeeInput,
  EmployeeQueryParams,
  HRDashboard,
  LeaveRequest,
  LeaveType,
  PayrollRun,
  PayrollRunInput,
} from "@/services/hr/types";

import { payrollRepository } from "@/services/hr/payrollRepository";

type PayrollConfig = {
  overtime: { rate: number };
};
type PayrollEmployeeUpdate = Parameters<
  typeof payrollRepository.updateEmployee
>[2];

const payrollConfigRepository = payrollRepository as typeof payrollRepository &
  Partial<{
    getConfig: () => Promise<PayrollConfig>;
    updateConfig: (config: PayrollConfig) => Promise<PayrollConfig>;
  }>;

/* ------------------------------------------------------------------ */
/* Generic fetcher                                                     */
/* ------------------------------------------------------------------ */

export interface HRDataState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

function useHRData<T>(
  loader: (client: HRApiClient) => Promise<T>,
  deps: unknown[] = [],
): HRDataState<T> {
  const [state, setState] = useState<HRDataState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const client = await getHRApiClient();
        const data = await loader(client);

        if (active) {
          setState({
            data,
            loading: false,
            error: null,
          });
        }
      } catch (error: unknown) {
        if (active) {
          setState({
            data: null,
            loading: false,
            error:
              error instanceof Error
                ? error
                : new Error(String(error)),
          });
        }
      }
    };

    void load();

    return () => {
      active = false;
    };

    // The caller supplies the dependencies for its loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/* ------------------------------------------------------------------ */
/* Read hooks                                                          */
/* ------------------------------------------------------------------ */

export function useHRDashboard(): HRDataState<HRDashboard> {
  const loader = useCallback(
    (client: HRApiClient) => client.getDashboard(),
    [],
  );

  return useHRData(loader, []);
}

export function useHREmployees(
  params?: EmployeeQueryParams,
): HRDataState<Employee[]> {
  const loader = useCallback(
    (client: HRApiClient) => client.getEmployees(params),
    [params?.search, params?.status, params?.position],
  );

  return useHRData(loader, [
    params?.search,
    params?.status,
    params?.position,
  ]);
}

export function useHREmployee(
  id: string | undefined,
): HRDataState<Employee | null> {
  const loader = useCallback(
    (client: HRApiClient) =>
      id ? client.getEmployeeById(id) : Promise.resolve(null),
    [id],
  );

  return useHRData(loader, [id]);
}

export function useHRAttendance(
  params?: AttendanceQueryParams,
): HRDataState<AttendanceRecord[]> & {
  refresh: () => void;
} {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const key = JSON.stringify(params);

  const loader = useCallback(
    (client: HRApiClient) => client.getAttendance(params),
    [key],
  );

  const state = useHRData(loader, [key, refreshVersion]);

  const refresh = useCallback(() => {
    setRefreshVersion((previous) => previous + 1);
  }, []);

  return {
    ...state,
    refresh,
  };
}

/* ------------------------------------------------------------------ */
/* Leave requests                                                      */
/* ------------------------------------------------------------------ */

export function useHRLeaveRequests(): HRDataState<LeaveRequest[]> & {
  refresh: () => void;
} {
  const [refreshVersion, setRefreshVersion] = useState(0);

  const loader = useCallback(
    (client: HRApiClient) => client.getLeaveRequests(),
    [],
  );

  const state = useHRData(loader, [refreshVersion]);

  const refresh = useCallback(() => {
    setRefreshVersion((previous) => previous + 1);
  }, []);

  return {
    ...state,
    refresh,
  };
}

/* ------------------------------------------------------------------ */
/* Payroll helpers                                                     */
/* ------------------------------------------------------------------ */

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function usePayrollRefresh() {
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const refreshOnChange = () => {
      setRefreshVersion((previous) => previous + 1);
    };

    window.addEventListener("payroll-changed", refreshOnChange);

    return () => {
      window.removeEventListener("payroll-changed", refreshOnChange);
    };
  }, []);

  const refresh = useCallback(() => {
    setRefreshVersion((previous) => previous + 1);
  }, []);

  return {
    refreshVersion,
    refresh,
  };
}

/* ------------------------------------------------------------------ */
/* Payroll reads (API-backed)                                          */
/* ------------------------------------------------------------------ */

export function usePayrollRuns(): HRDataState<PayrollRun[]> & {
  refresh: () => void;
  refetch: () => Promise<void>;
} {
  const { refreshVersion, refresh } = usePayrollRefresh();

  const [state, setState] = useState<HRDataState<PayrollRun[]>>({
    data: null,
    loading: true,
    error: null,
  });

  const reload = useCallback(async () => {
    setState((previous) => ({
      ...previous,
      loading: true,
      error: null,
    }));

    try {
      const runs = await payrollRepository.getRuns();

      setState({
        data: runs,
        loading: false,
        error: null,
      });
    } catch (error: unknown) {
      setState((previous) => ({
        ...previous,
        loading: false,
        error: toError(error, "Unable to load payroll runs."),
      }));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, refreshVersion]);

  return {
    ...state,
    refresh,
    refetch: reload,
  };
}

export function usePayrollRun(
  id: string | undefined,
): HRDataState<PayrollRun | null> & {
  refresh: () => void;
  refetch: () => Promise<void>;
} {
  const { refreshVersion, refresh } = usePayrollRefresh();

  const [state, setState] = useState<HRDataState<PayrollRun | null>>({
    data: null,
    loading: Boolean(id),
    error: null,
  });

  const reload = useCallback(async () => {
    if (!id) {
      setState({
        data: null,
        loading: false,
        error: null,
      });
      return;
    }

    setState((previous) => ({
      ...previous,
      loading: true,
      error: null,
    }));

    try {
      const run = await payrollRepository.getRunById(id);

      setState({
        data: run,
        loading: false,
        error: null,
      });
    } catch (error: unknown) {
      setState((previous) => ({
        ...previous,
        loading: false,
        error: toError(error, "Unable to load payroll run."),
      }));
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload, refreshVersion]);

  return {
    ...state,
    refresh,
    refetch: reload,
  };
}

/* ------------------------------------------------------------------ */
/* Employee name resolution helper                                     */
/* ------------------------------------------------------------------ */

/**
 * Build a map from employee_id -> full_name.
 * Used by attendance pages to resolve employee names from IDs.
 */
export function useEmployeeNameMap(): {
  getName: (id: string) => string;
  loading: boolean;
} {
  const { data: employees, loading } = useHREmployees();

  const map = useMemo(() => {
    if (!employees) {
      return new Map<string, string>();
    }

    return new Map(
      employees.map((employee) => [
        employee.employee_id,
        employee.full_name,
      ]),
    );
  }, [employees]);

  const getName = useCallback(
    (id: string) => map.get(id) ?? id,
    [map],
  );

  return {
    getName,
    loading,
  };
}

/* ------------------------------------------------------------------ */
/* Employee mutations                                                  */
/* ------------------------------------------------------------------ */

export function useCreateEmployee() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (input: EmployeeInput) => {
    setLoading(true);
    setError(null);

    try {
      const client = await getHRApiClient();
      return await client.createEmployee(input);
    } catch (err: unknown) {
      const message = toError(err, "Unable to create employee.").message;
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { create, loading, error };
}

export function useUpdateEmployee() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (id: string, input: EmployeeInput) => {
      setLoading(true);
      setError(null);

      try {
        const client = await getHRApiClient();
        return await client.updateEmployee(id, input);
      } catch (err: unknown) {
        const message = toError(err, "Unable to update employee.").message;
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { update, loading, error };
}

export function useSetEmployeeStatus() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStatus = useCallback(
    async (id: string, isActive: boolean) => {
      setLoading(true);
      setError(null);

      try {
        const client = await getHRApiClient();
        return await client.setEmployeeStatus(id, isActive);
      } catch (err: unknown) {
        const message = toError(
          err,
          "Unable to update employee status.",
        ).message;

        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { setStatus, loading, error };
}

/* ------------------------------------------------------------------ */
/* Attendance mutations                                                */
/* ------------------------------------------------------------------ */

export function useCreateAttendance() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (input: AttendanceInput) => {
    setLoading(true);
    setError(null);

    try {
      const client = await getHRApiClient();
      return await client.createAttendance(input);
    } catch (err: unknown) {
      const message = toError(
        err,
        "Unable to create attendance record.",
      ).message;

      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { create, loading, error };
}

export function useUpdateAttendance() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (id: string, input: AttendanceInput) => {
      setLoading(true);
      setError(null);

      try {
        const client = await getHRApiClient();
        return await client.updateAttendance(id, input);
      } catch (err: unknown) {
        const message = toError(
          err,
          "Unable to update attendance record.",
        ).message;

        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { update, loading, error };
}

export function useDeleteAttendance() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);

    try {
      const client = await getHRApiClient();
      await client.deleteAttendance(id);
    } catch (err: unknown) {
      const message = toError(
        err,
        "Unable to delete attendance record.",
      ).message;

      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { remove, loading, error };
}

/* ------------------------------------------------------------------ */
/* Leave mutations                                                     */
/* ------------------------------------------------------------------ */

export function useCreateLeaveRequest() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (input: {
      employee_id: string;
      type: LeaveType;
      start_date: string;
      end_date: string;
      reason: string;
    }) => {
      setLoading(true);
      setError(null);

      try {
        const client = await getHRApiClient();
        return await client.createLeaveRequest(input);
      } catch (err: unknown) {
        const message = toError(
          err,
          "Unable to create leave request.",
        ).message;

        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { create, loading, error };
}

export function useApproveLeaveRequest() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = useCallback(
    async (id: string, reviewedBy: string) => {
      setLoading(true);
      setError(null);

      try {
        // Kept for compatibility with existing page calls.
        // The API client currently accepts only the request ID.
        void reviewedBy;

        const client = await getHRApiClient();
        return await client.approveLeaveRequest(id);
      } catch (err: unknown) {
        const message = toError(
          err,
          "Unable to approve leave request.",
        ).message;

        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { approve, loading, error };
}

export function useRejectLeaveRequest() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reject = useCallback(
    async (
      id: string,
      reviewedBy: string,
      rejectionReason: string,
    ) => {
      setLoading(true);
      setError(null);

      try {
        // Kept for compatibility with existing page calls.
        void reviewedBy;

        const client = await getHRApiClient();
        return await client.rejectLeaveRequest(
          id,
          rejectionReason,
        );
      } catch (err: unknown) {
        const message = toError(
          err,
          "Unable to reject leave request.",
        ).message;

        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { reject, loading, error };
}

export function useDeleteLeaveRequest() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useCallback(async (_id: string) => {
    setLoading(true);
    setError(null);

    try {
      throw new Error(
        "Deleting leave requests is not supported by the current backend API.",
      );
    } catch (err: unknown) {
      const message = toError(
        err,
        "Unable to delete leave request.",
      ).message;

      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { remove, loading, error };
}

/* ------------------------------------------------------------------ */
/* Payroll mutations (API-backed)                                      */
/* ------------------------------------------------------------------ */

export function useCreatePayrollRun() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (input: PayrollRunInput, _employees?: Employee[]) => {
      setLoading(true);
      setError(null);

      try {
        return await payrollRepository.createRun(input);
      } catch (err: unknown) {
        const message = toError(
          err,
          "Unable to create payroll run.",
        ).message;

        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { create, loading, error };
}

export function useCalculatePayroll() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculate = useCallback(async (runId: string) => {
    setLoading(true);
    setError(null);

    try {
      return await payrollRepository.calculateRun(runId);
    } catch (err: unknown) {
      const message = toError(
        err,
        "Unable to calculate payroll.",
      ).message;

      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { calculate, loading, error };
}

export function useSubmitPayroll() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (runId: string, _actor?: string) => {
      setLoading(true);
      setError(null);

      try {
        return await payrollRepository.submitForReview(runId);
      } catch (err: unknown) {
        const message = toError(
          err,
          "Unable to submit payroll.",
        ).message;

        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { submit, loading, error };
}

export function useUpdatePayrollEmployee() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (
      runId: string,
      employeeId: string,
      input: PayrollEmployeeUpdate,
    ) => {
      setLoading(true);
      setError(null);

      try {
        return await payrollRepository.updateEmployee(
          runId,
          employeeId,
          input,
        );
      } catch (err: unknown) {
        const message = toError(
          err,
          "Unable to update employee payroll.",
        ).message;

        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { update, loading, error };
}

export function useResubmitPayroll() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resubmit = useCallback(async (runId: string) => {
    setLoading(true);
    setError(null);

    try {
      return await payrollRepository.submitForReview(runId);
    } catch (err: unknown) {
      const message = toError(
        err,
        "Unable to resubmit payroll.",
      ).message;

      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { resubmit, loading, error };
}

export function usePayrollConfig() {
  const [config, setConfig] = useState<PayrollConfig>({
    overtime: { rate: 150 },
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await payrollConfigRepository.getConfig?.();
      if (result) {
        setConfig(result);
      }
    } catch (err: unknown) {
      setError(
        toError(err, "Unable to load payroll configuration.").message,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const updateConfig = useCallback(
    async (overtimeRate: number | PayrollConfig) => {
      setSaving(true);
      setError(null);

      try {
        const nextConfig: PayrollConfig =
          typeof overtimeRate === "number"
            ? { overtime: { rate: overtimeRate } }
            : overtimeRate;

        const result = await payrollConfigRepository.updateConfig?.(nextConfig);
        const savedConfig = result ?? nextConfig;
        setConfig(savedConfig);

        return savedConfig;
      } catch (err: unknown) {
        const message = toError(
          err,
          "Unable to update payroll configuration.",
        ).message;

        setError(message);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  return {
    config,
    data: config,
    loading,
    saving,
    error,
    updateConfig,
    refresh: reload,
    refetch: reload,
  };
}
