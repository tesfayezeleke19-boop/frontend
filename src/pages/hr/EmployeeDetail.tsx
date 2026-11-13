
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  ArrowLeft,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";

import { toast } from "sonner";

import {
  useHREmployee,
  useSetEmployeeStatus,
} from "@/hooks/use-hr-data";

import { formatCurrency } from "@/services/sales/format";

function formatEthiopianDate(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }

  const datePart = value.slice(0, 10);
  const date = new Date(`${datePart}T12:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "en-ET-u-ca-ethiopic-nu-latn",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    },
  ).format(date);
}

export default function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    data: employee,
    loading,
    error,
  } = useHREmployee(id);

  const {
    setStatus,
    loading: statusLoading,
  } = useSetEmployeeStatus();

  const [toggleOpen, setToggleOpen] = useState(false);

  const handleToggleStatus = async () => {
    if (!employee) return;

    try {
      await setStatus(
        employee.employee_id,
        !employee.is_active,
      );

      toast.success(
        employee.is_active
          ? "Employee deactivated"
          : "Employee activated",
      );

      setToggleOpen(false);
    } catch {
      toast.error("Failed to update employee status");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="py-20 text-center">
        <AlertTriangle className="mx-auto mb-3 size-8 text-destructive" />

        <p className="text-sm font-medium text-foreground">
          Unable to load employee.
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          {error?.message || "Employee not found"}
        </p>

        <Button
          onClick={() => navigate("/hr/employees")}
          className="mt-4 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <ArrowLeft className="size-4" />
          Back to Employees
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate("/hr/employees")}
          className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground/70 transition-colors hover:text-muted-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Employees
        </button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-full border border-input bg-popover text-lg font-medium text-foreground">
              {employee.full_name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)}
            </div>

            <div>
              <h1 className="font-heading text-2xl font-semibold text-foreground">
                {employee.full_name}
              </h1>

              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground/70">
                  {employee.employee_id}
                </span>

                <Badge
                  variant="outline"
                  className={`border text-[10px] font-medium ${
                    employee.is_active
                      ? "border-success-border bg-success-soft text-success"
                      : "border-destructive-border bg-destructive-soft text-muted-foreground"
                  }`}
                >
                  {employee.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">

            <Button
              onClick={() => setToggleOpen(true)}
              variant="outline"
              className={`gap-2 border-input ${
                employee.is_active
                  ? "text-destructive hover:bg-destructive-soft"
                  : "text-success hover:bg-success-soft"
              }`}
            >
              {employee.is_active ? (
                <ToggleRight className="size-4" />
              ) : (
                <ToggleLeft className="size-4" />
              )}

              {employee.is_active
                ? "Deactivate"
                : "Activate"}
            </Button>
          </div>
        </div>
      </div>

      {/* Employee information */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Personal Information */}
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Personal Information
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            <DetailRow
              label="Full Name"
              value={employee.full_name}
            />

            <DetailRow
              label="Phone"
              value={employee.phone}
              mono
            />

            <DetailRow
              label="Employee ID"
              value={employee.employee_id}
              mono
            />
          </CardContent>
        </Card>

        {/* Employment Information */}
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Employment Information
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            <DetailRow
              label="Machine ID"
              value={employee.machine_employee_no || "—"}
              mono
            />

            <DetailRow
              label="Position"
              value={employee.position}
            />

            <DetailRow
              label="Hired Date"
              value={formatEthiopianDate(
                employee.hired_date,
              )}
            />

            <DetailRow
              label="Salary"
              value={formatCurrency(employee.salary)}
            />

            <DetailRow
              label="Status"
              value={
                employee.is_active ? "Active" : "Inactive"
              }
              highlight={employee.is_active}
            />
          </CardContent>
        </Card>

        {/* Emergency Contact */}
        <Card className="border-border bg-card shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Emergency Contact
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            <DetailRow
              label="Contact Name"
              value={
                employee.emergency_contact_name || "—"
              }
            />

            <DetailRow
              label="Contact Phone"
              value={employee.emergency_phone || "—"}
              mono
            />
          </CardContent>
        </Card>
      </div>

      {/* Toggle Status Dialog */}
      <Dialog
        open={toggleOpen}
        onOpenChange={setToggleOpen}
      >
        <DialogContent className="border-input bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">
              {employee.is_active
                ? "Deactivate"
                : "Activate"}{" "}
              Employee
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              Are you sure you want to{" "}
              {employee.is_active
                ? "deactivate"
                : "activate"}{" "}
              <span className="font-medium text-foreground">
                {employee.full_name}
              </span>
              ?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setToggleOpen(false)}
              disabled={statusLoading}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>

            <Button
              onClick={handleToggleStatus}
              disabled={statusLoading}
              className={`gap-2 text-primary-foreground ${
                employee.is_active
                  ? "bg-destructive hover:bg-destructive"
                  : "bg-success hover:bg-success"
              }`}
            >
              {statusLoading && (
                <Loader2 className="size-4 animate-spin" />
              )}

              {employee.is_active
                ? "Deactivate"
                : "Activate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="text-xs text-muted-foreground/70">
        {label}
      </span>

      <span
        className={`text-sm ${
          mono
            ? "font-mono text-xs text-muted-foreground"
            : ""
        } ${
          highlight
            ? "font-medium text-success"
            : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
