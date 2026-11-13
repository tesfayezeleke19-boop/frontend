
import { useState } from "react";
import type { FormEvent } from "react";

import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Loader2,
  Save,
} from "lucide-react";

import type {
  Employee,
  EmployeeInput,
} from "@/services/hr/types";

const inputClass =
  "h-9 border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30";

interface EmployeeFormProps {
  initial?: Employee;
  onSubmit: (input: EmployeeInput) => Promise<void>;
  submitLabel: string;
  loading: boolean;
  error: string | null;
}

export default function EmployeeForm({
  initial,
  onSubmit,
  submitLabel,
  loading,
  error,
}: EmployeeFormProps) {
  const [form, setForm] = useState<EmployeeInput>({
    machine_employee_no: initial?.machine_employee_no ?? "",
    full_name: initial?.full_name ?? "",
    phone: initial?.phone ?? "",
    position: initial?.position ?? "",
    hired_date:
      initial?.hired_date ??
      new Date().toISOString().split("T")[0],
    emergency_contact_name:
      initial?.emergency_contact_name ?? "",
    emergency_phone: initial?.emergency_phone ?? "",
    salary: initial?.salary ?? 0,
  });

  const [errors, setErrors] = useState<
    Record<string, string>
  >({});

  const validate = () => {
    const errs: Record<string, string> = {};

    if (!form.machine_employee_no?.trim()) {
      errs.machine_employee_no = "Machine ID is required";
    }

    if (!form.full_name.trim()) {
      errs.full_name = "Full name is required";
    }

    if (!form.phone.trim()) {
      errs.phone = "Phone is required";
    }

    if (!form.position.trim()) {
      errs.position = "Position is required";
    }

    if (!form.hired_date) {
      errs.hired_date = "Hire date is required";
    }

    if (form.salary <= 0) {
      errs.salary = "Salary must be greater than zero";
    }

    setErrors(errs);

    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (
    e: FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();

    if (!validate()) return;

    const payload: EmployeeInput = {
      ...form,
      machine_employee_no:
        form.machine_employee_no?.trim() ?? "",
      full_name: form.full_name.trim(),
      phone: form.phone.trim(),
      position: form.position.trim(),
      emergency_contact_name:
        form.emergency_contact_name?.trim() ?? "",
      emergency_phone:
        form.emergency_phone?.trim() ?? "",
    };

    await onSubmit(payload);
  };

  const update = (
    field: keyof EmployeeInput,
    value: string | number,
  ) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));

    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="rounded-lg border border-destructive-border bg-destructive-soft px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Personal Information */}
      <Section title="Personal Information">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Full Name"
            error={errors.full_name}
            required
          >
            <Input
              value={form.full_name}
              onChange={(e) =>
                update("full_name", e.target.value)
              }
              placeholder="e.g. Abebe Kebede"
              className={`${inputClass} ${
                errors.full_name ? "border-destructive" : ""
              }`}
            />
          </Field>

          <Field
            label="Phone"
            error={errors.phone}
            required
          >
            <Input
              value={form.phone}
              onChange={(e) =>
                update("phone", e.target.value)
              }
              placeholder="e.g. +251-911-123456"
              className={`${inputClass} ${
                errors.phone ? "border-destructive" : ""
              }`}
            />
          </Field>
        </div>
      </Section>

      {/* Employment Information */}
      <Section title="Employment Information">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Machine ID"
            error={errors.machine_employee_no}
            required
          >
            <Input
              value={form.machine_employee_no ?? ""}
              onChange={(e) =>
                update("machine_employee_no", e.target.value)
              }
              placeholder="Enter attendance machine ID"
              className={`${inputClass} ${
                errors.machine_employee_no
                  ? "border-destructive"
                  : ""
              }`}
            />
          </Field>

          <Field
            label="Position"
            error={errors.position}
            required
          >
            <Input
              value={form.position}
              onChange={(e) =>
                update("position", e.target.value)
              }
              placeholder="e.g. Sales Manager"
              className={`${inputClass} ${
                errors.position ? "border-destructive" : ""
              }`}
            />
          </Field>

          <Field
            label="Hired Date"
            error={errors.hired_date}
            required
          >
            <EthiopianDatePicker
              value={form.hired_date}
              onChange={(value) =>
                update("hired_date", value)
              }
              className={
                errors.hired_date ? "border-destructive" : ""
              }
            />
          </Field>

          <Field
            label="Salary (ETB)"
            error={errors.salary}
            required
          >
            <Input
              type="number"
              value={form.salary || ""}
              onChange={(e) =>
                update(
                  "salary",
                  parseFloat(e.target.value) || 0,
                )
              }
              placeholder="0"
              min="0"
              step="0.01"
              className={`${inputClass} ${
                errors.salary ? "border-destructive" : ""
              }`}
            />
          </Field>
        </div>
      </Section>

      {/* Emergency Contact */}
      <Section title="Emergency Contact">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Emergency Contact Name">
            <Input
              value={form.emergency_contact_name ?? ""}
              onChange={(e) =>
                update(
                  "emergency_contact_name",
                  e.target.value,
                )
              }
              placeholder="e.g. Hiwot Kebede"
              className={inputClass}
            />
          </Field>

          <Field label="Emergency Phone">
            <Input
              value={form.emergency_phone ?? ""}
              onChange={(e) =>
                update("emergency_phone", e.target.value)
              }
              placeholder="e.g. +251-911-654321"
              className={inputClass}
            />
          </Field>
        </div>
      </Section>

      {/* Submit */}
      <div className="flex justify-end border-t border-border pt-6">
        <Button
          type="submit"
          disabled={loading}
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}

          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Form layout components                                              */
/* ------------------------------------------------------------------ */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
        {title}
      </h3>

      {children}
    </div>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && " *"}
      </Label>

      <div className="mt-1">{children}</div>

      {error && (
        <p className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
