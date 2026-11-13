
import { useNavigate } from "react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useCreateEmployee } from "@/hooks/use-hr-data";
import EmployeeForm from "@/components/hr/EmployeeForm";
import type { EmployeeInput } from "@/services/hr/types";

export default function NewEmployee() {
  const navigate = useNavigate();
  const { create, loading, error } = useCreateEmployee();

  const handleSubmit = async (input: EmployeeInput) => {
    try {
      await create(input);
      toast.success("Employee created successfully");
      navigate("/hr/employees");
    } catch {
      // error is set in the hook
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => navigate("/hr/employees")}
          className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground/70 transition-colors hover:text-muted-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Employees
        </button>

        <h1 className="font-heading text-2xl font-semibold text-foreground">
          New Employee
        </h1>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <EmployeeForm
          onSubmit={handleSubmit}
          submitLabel="Create Employee"
          loading={loading}
          error={error}
        />
      </div>
    </div>
  );
}
