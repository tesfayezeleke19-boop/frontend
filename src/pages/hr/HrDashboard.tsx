import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Users,
  UserCheck,
  UserX,
  Clock,
  AlertTriangle,
  Timer,
  CalendarOff,
  ClipboardList,
  Banknote,
  Loader2,
} from "lucide-react";
import { useHRDashboard, useHRAttendance, useHREmployees } from "@/hooks/use-hr-data";

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <Card className="border-border bg-card shadow-none">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs font-medium text-muted-foreground">
              {label}
            </span>
            <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {value}
            </div>
          </div>
          <div className="flex size-9 items-center justify-center rounded-lg border border-input bg-popover">
            <Icon className={`size-4 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HrDashboard() {
  const { data: employees, loading: empLoading } = useHREmployees();
  const { data: attendance, loading: attLoading } = useHRAttendance();

  const loading = empLoading || attLoading;

  // Derive employee counts from employee data
  const empStats = useMemo(() => {
    if (!employees) return { total: 0, active: 0, inactive: 0 };
    return {
      total: employees.length,
      active: employees.filter((e) => e.is_active).length,
      inactive: employees.filter((e) => !e.is_active).length,
    };
  }, [employees]);

  // Derive attendance metrics from today's attendance data
  const today = new Date().toISOString().split("T")[0];
  const attStats = useMemo(() => {
    if (!attendance)
      return { present: 0, absent: 0, late: 0, leave: 0, totalOvertime: 0 };
    const todayRecords = attendance.filter((a) => a.attendance_date === today);
    return {
      present: todayRecords.filter((a) => a.status === "PRESENT").length,
      absent: todayRecords.filter((a) => a.status === "ABSENT").length,
      late: todayRecords.filter((a) => a.status === "LATE").length,
      leave: todayRecords.filter((a) => a.status === "LEAVE").length,
      totalOvertime: todayRecords.reduce(
        (sum, a) => sum + a.overtime_hours,
        0,
      ),
    };
  }, [attendance, today]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          HR Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
        </p>
      </div>

      {/* Employee KPIs */}
      <div>
        <div className="mb-2 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Employees
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Total Employees"
            value={empStats.total}
            icon={Users}
            color="text-info"
          />
          <StatCard
            label="Active Employees"
            value={empStats.active}
            icon={UserCheck}
            color="text-success"
          />
          <StatCard
            label="Inactive Employees"
            value={empStats.inactive}
            icon={UserX}
            color="text-muted-foreground"
          />
        </div>
      </div>

      {/* Attendance KPIs — derived from live attendance data */}
      <div>
        <div className="mb-2 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Today&apos;s Attendance
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <StatCard
            label="Present Today"
            value={attStats.present}
            icon={Clock}
            color="text-success"
          />
          <StatCard
            label="Absent Today"
            value={attStats.absent}
            icon={AlertTriangle}
            color="text-destructive"
          />
          <StatCard
            label="Late Today"
            value={attStats.late}
            icon={Timer}
            color="text-warning"
          />
          <StatCard
            label="On Leave"
            value={attStats.leave}
            icon={CalendarOff}
            color="text-violet"
          />
          <StatCard
            label="Total OT (hours)"
            value={`${attStats.totalOvertime}h`}
            icon={Timer}
            color="text-info"
          />
        </div>
      </div>

      {/* Payroll */}
      <div>
        <div className="mb-2 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Payroll
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card className="border-border bg-card shadow-none">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-medium text-muted-foreground">
                    Current Payroll Status
                  </span>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    Processing August 2026
                  </div>
                </div>
                <div className="flex size-9 items-center justify-center rounded-lg border border-input bg-popover">
                  <Banknote className="size-4 text-info" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card shadow-none">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-medium text-muted-foreground">
                    Attendance Records (all time)
                  </span>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {attendance?.length ?? 0}
                  </div>
                </div>
                <div className="flex size-9 items-center justify-center rounded-lg border border-input bg-popover">
                  <ClipboardList className="size-4 text-violet" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
