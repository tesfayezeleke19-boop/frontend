
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useHREmployee, useUpdateEmployee } from "@/hooks/use-hr-data";
import EmployeeForm from "@/components/hr/EmployeeForm";
import type { EmployeeInput } from "@/services/hr/types";

export default function EditEmployee() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: employee, loading, error } = useHREmployee(id);
  const { update, loading: updating, error: updateError } = useUpdateEmployee();

  const handleSubmit = async (input: EmployeeInput) => {
    if (!id) return;

    try {
      await update(id, input);
      toast.success("Employee updated successfully");
      navigate(`/hr/employees/${id}`);
    } catch {
      // error is set in the hook
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

        <button
          onClick={() => navigate("/hr/employees")}
          className="mt-4 text-xs text-muted-foreground/70 hover:text-muted-foreground"
        >
          Back to Employees
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => navigate(`/hr/employees/${id}`)}
          className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground/70 transition-colors hover:text-muted-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Employee
        </button>

        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Edit Employee
        </h1>

        <p className="mt-1 text-sm text-muted-foreground">
          Update {employee.full_name}&apos;s information.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <EmployeeForm
          initial={employee}
          onSubmit={handleSubmit}
          submitLabel="Save Changes"
          loading={updating}
          error={updateError}
        />
      </div>
    </div>
  );
}
