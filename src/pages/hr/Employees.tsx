
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  Search,
  Plus,
  Eye,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Loader2,
  AlertTriangle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  useHREmployees,
  useSetEmployeeStatus,
} from "@/hooks/use-hr-data";
import { formatCurrency } from "@/services/sales/format";

const inputClass =
  "h-9 border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30";

const selectTriggerClass =
  "h-9 w-full border-input bg-popover text-sm text-foreground";

function formatEthiopianDate(value: string | null | undefined): string {
  if (!value) return "—";

  // Extract the date portion to prevent timezone shifting.
  const datePart = value.slice(0, 10);
  const date = new Date(`${datePart}T12:00:00Z`);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-ET-u-ca-ethiopic-nu-latn", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

type EmployeeStatusFilter = "all" | "active" | "inactive";

export default function Employees() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<EmployeeStatusFilter>("all");
  const [positionFilter, setPositionFilter] = useState("all");

  const [toggleId, setToggleId] = useState<string | null>(null);
  const [toggleName, setToggleName] = useState("");
  const [toggleActive, setToggleActive] = useState(true);

  const {
    data: employees,
    loading,
    error,
  } = useHREmployees();

  const { setStatus, loading: statusLoading } = useSetEmployeeStatus();

  // Normalize PostgreSQL and API boolean representations.
  const isEmployeeActive = (value: unknown): boolean => {
    return (
      value === true ||
      value === 1 ||
      value === "1" ||
      value === "true" ||
      value === "t"
    );
  };

  // Build position options from the complete employee list,
  // not from the filtered results.
  const positions = useMemo(() => {
    const allEmployees = employees ?? [];

    return Array.from(
      new Set(
        allEmployees
          .map((employee) => employee.position?.trim())
          .filter((position): position is string => Boolean(position)),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  // Apply all filters together on the client.
  const filteredEmployees = useMemo(() => {
    const allEmployees = employees ?? [];
    const query = search.trim().toLocaleLowerCase();

    return allEmployees.filter((employee) => {
      const matchesSearch =
        !query ||
        [
          employee.employee_id,
          employee.full_name,
          employee.phone,
          employee.position,
        ].some((value) =>
          String(value ?? "").toLocaleLowerCase().includes(query),
        );

      const active = isEmployeeActive(employee.is_active);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && active) ||
        (statusFilter === "inactive" && !active);

      const matchesPosition =
        positionFilter === "all" ||
        employee.position?.trim() === positionFilter;

      return matchesSearch && matchesStatus && matchesPosition;
    });
  }, [employees, search, statusFilter, positionFilter]);

  const hasFilters =
    search.trim() !== "" ||
    statusFilter !== "all" ||
    positionFilter !== "all";

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setPositionFilter("all");
  };

  const handleToggleStatus = async () => {
    if (!toggleId) return;

    try {
      await setStatus(toggleId, !toggleActive);
      toast.success(
        toggleActive ? "Employee deactivated" : "Employee activated",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update employee status",
      );
    } finally {
      setToggleId(null);
    }
  };

  if (loading && !employees) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <AlertTriangle className="mx-auto mb-3 size-8 text-destructive" />
        <p className="text-sm font-medium text-foreground">
          Unable to load employees.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Employees
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
          </p>
        </div>

        <Button
          onClick={() => navigate("/hr/employees/new")}
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          New Employee
        </Button>
      </div>

      {/* Search and filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, phone, ID, position..."
            aria-label="Search employees"
            className={`${inputClass} pl-9`}
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(value) =>
            setStatusFilter(value as EmployeeStatusFilter)
          }
        >
          <SelectTrigger
            className={`${selectTriggerClass} w-36`}
            aria-label="Filter by status"
          >
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent className="border-input bg-popover">
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={positionFilter}
          onValueChange={setPositionFilter}
        >
          <SelectTrigger
            className={`${selectTriggerClass} w-48`}
            aria-label="Filter by position"
          >
            <SelectValue placeholder="All Positions" />
          </SelectTrigger>
          <SelectContent className="border-input bg-popover">
            <SelectItem value="all">All Positions</SelectItem>
            {positions.map((position) => (
              <SelectItem key={position} value={position}>
                {position}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            className="h-9 gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Employee table */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Employee Directory ({filteredEmployees.length}
            {hasFilters ? ` of ${employees?.length ?? 0}` : ""})
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          {filteredEmployees.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">Employee ID</th>
                    <th className="px-4 py-2.5 font-medium">Full Name</th>
                    <th className="px-4 py-2.5 font-medium">Phone</th>
                    <th className="px-4 py-2.5 font-medium">Position</th>
                    <th className="px-4 py-2.5 font-medium">Hire Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Salary
                    </th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredEmployees.map((employee) => {
                    const active = isEmployeeActive(employee.is_active);
                    const identifier = employee.id || employee.employee_id;

                    return (
                      <tr
                        key={identifier}
                        className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs font-medium text-foreground">
                          {employee.employee_id}
                        </td>

                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {employee.full_name}
                        </td>

                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {employee.phone}
                        </td>

                        <td className="px-4 py-2.5 text-muted-foreground">
                          {employee.position}
                        </td>

                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
  {formatEthiopianDate(employee.hired_date)}
</td>

                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatCurrency(employee.salary)}
                        </td>

                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`border text-[10px] font-medium ${
                              active
                                ? "border-success-border bg-success-soft text-success"
                                : "border-destructive-border bg-destructive-soft text-muted-foreground"
                            }`}
                          >
                            {active ? "Active" : "Inactive"}
                          </Badge>
                        </td>

                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                              onClick={() =>
                                navigate(`/hr/employees/${identifier}`)
                              }
                            >
                              <Eye className="size-3" />
                              View
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-info"
                              onClick={() =>
                                navigate(
                                  `/hr/employees/${identifier}/edit`,
                                )
                              }
                            >
                              <Pencil className="size-3" />
                              Edit
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-7 gap-1 text-xs ${
                                active
                                  ? "text-muted-foreground hover:text-destructive"
                                  : "text-muted-foreground hover:text-success"
                              }`}
                              onClick={() => {
                                setToggleId(identifier);
                                setToggleName(employee.full_name);
                                setToggleActive(active);
                              }}
                            >
                              {active ? (
                                <ToggleRight className="size-3" />
                              ) : (
                                <ToggleLeft className="size-3" />
                              )}
                              {active ? "Deactivate" : "Activate"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                {hasFilters
                  ? "No employees match your filters"
                  : "No employees found"}
              </p>
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="mt-2 text-xs text-success"
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activate/deactivate confirmation */}
      <Dialog
        open={!!toggleId}
        onOpenChange={(open) => !open && setToggleId(null)}
      >
        <DialogContent className="border-input bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">
              {toggleActive ? "Deactivate" : "Activate"} Employee
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Are you sure you want to{" "}
              {toggleActive ? "deactivate" : "activate"}{" "}
              <span className="font-medium text-foreground">
                {toggleName}
              </span>
              ?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setToggleId(null)}
              disabled={statusLoading}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>

            <Button
              onClick={handleToggleStatus}
              disabled={statusLoading}
              className={`gap-2 text-primary-foreground ${
                toggleActive
                  ? "bg-destructive hover:bg-destructive"
                  : "bg-success hover:bg-success"
              }`}
            >
              {statusLoading && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {toggleActive ? "Deactivate" : "Activate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
