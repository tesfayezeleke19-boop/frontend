
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  adminOperationalSettingsApi,
  type OperationalSetting,
  type AggregateType,
} from "@/services/finance/api";

interface SettingValues {
  overtime_rate: string;
  standard_working_hours: string;
}

interface AggregateForm {
  name: string;
  pricePerM3: string;
  description: string;
}

const emptyAggregateForm: AggregateForm = {
  name: "",
  pricePerM3: "",
  description: "",
};

export default function OperationalSettings() {
  const [settings, setSettings] = useState<SettingValues>({
    overtime_rate: "150",
    standard_working_hours: "8",
  });

  const [originalSettings, setOriginalSettings] =
    useState<SettingValues>({
      overtime_rate: "150",
      standard_working_hours: "8",
    });

  const [aggregateTypes, setAggregateTypes] = useState<AggregateType[]>([]);

  const [aggregateForm, setAggregateForm] =
    useState<AggregateForm>(emptyAggregateForm);

  // Aggregate IDs are numeric in the API.
  const [editingId, setEditingId] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingAggregate, setSavingAggregate] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null);

  const [settingsError, setSettingsError] = useState("");
  const [aggregateError, setAggregateError] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      setSettingsError("");

      const rows: OperationalSetting[] =
        await adminOperationalSettingsApi.settings();

      const values: SettingValues = {
        overtime_rate: "150",
        standard_working_hours: "8",
      };

      rows.forEach((row) => {
        if (row.settingKey === "overtime_rate") {
          values.overtime_rate = String(row.settingValue);
        }

        if (row.settingKey === "standard_working_hours") {
          values.standard_working_hours = String(row.settingValue);
        }
      });

      setSettings(values);
      setOriginalSettings(values);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load operational settings.";

      setSettingsError(message);
    }
  }, []);

  const loadAggregateTypes = useCallback(async () => {
    try {
      setAggregateError("");

      const rows = await adminOperationalSettingsApi.aggregateTypes();

      setAggregateTypes(rows);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not load aggregate types.";

      setAggregateError(message);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);

    try {
      await Promise.all([
        loadSettings(),
        loadAggregateTypes(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [loadSettings, loadAggregateTypes]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // -----------------------------------------
  // General operational settings
  // -----------------------------------------

  const handleSettingChange = (
    key: keyof SettingValues,
    value: string,
  ) => {
    setSettings((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  const saveSettings = async () => {
    const overtime = Number(settings.overtime_rate);
    const hours = Number(settings.standard_working_hours);

    if (
      !Number.isFinite(overtime) ||
      overtime < 100 ||
      overtime > 1000
    ) {
      toast.error("Overtime rate must be between 100% and 1000%.");
      return;
    }

    if (
      !Number.isFinite(hours) ||
      hours <= 0 ||
      hours > 24
    ) {
      toast.error("Working hours must be greater than 0 and at most 24.");
      return;
    }

    try {
      setSavingSettings(true);

      await adminOperationalSettingsApi.updateSettings({
        overtime_rate: overtime,
        standard_working_hours: hours,
      });

      setOriginalSettings({ ...settings });

      toast.success("Operational settings updated successfully.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update operational settings.",
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const discardSettings = () => {
    setSettings({ ...originalSettings });
  };

  // -----------------------------------------
  // Aggregate form
  // -----------------------------------------

  const handleAggregateChange = (
    key: keyof AggregateForm,
    value: string,
  ) => {
    setAggregateForm((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  const resetAggregateForm = () => {
    setAggregateForm(emptyAggregateForm);
    setEditingId(null);
  };

  const editAggregate = (aggregate: AggregateType) => {
    setEditingId(aggregate.id);

    setAggregateForm({
      name: aggregate.name,
      pricePerM3: String(aggregate.pricePerM3),
      description: aggregate.description || "",
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const saveAggregate = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    const name = aggregateForm.name.trim();
    const price = Number(aggregateForm.pricePerM3);
    const description = aggregateForm.description.trim();

    if (!name) {
      toast.error("Please enter the aggregate name.");
      return;
    }

    if (
      aggregateForm.pricePerM3.trim() === "" ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      toast.error("Please enter a valid aggregate price.");
      return;
    }

    try {
      setSavingAggregate(true);

      const payload = {
        name,
        pricePerM3: price,
        description,
      };

      if (editingId !== null) {
        await adminOperationalSettingsApi.updateAggregateType(
          editingId,
          payload,
        );

        toast.success("Aggregate type updated successfully.");
      } else {
        await adminOperationalSettingsApi.createAggregateType(payload);

        toast.success("Aggregate type created successfully.");
      }

      resetAggregateForm();

      await loadAggregateTypes();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save aggregate type.",
      );
    } finally {
      setSavingAggregate(false);
    }
  };

  // -----------------------------------------
  // Deactivate aggregate
  // -----------------------------------------

  const deactivateAggregate = async (aggregate: AggregateType) => {
    const confirmed = window.confirm(
      `Are you sure you want to deactivate "${aggregate.name}"?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeactivatingId(aggregate.id);

      await adminOperationalSettingsApi.deleteAggregateType(
        aggregate.id,
      );

      if (editingId === aggregate.id) {
        resetAggregateForm();
      }

      toast.success("Aggregate type deactivated successfully.");

      await loadAggregateTypes();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not deactivate aggregate type.",
      );
    } finally {
      setDeactivatingId(null);
    }
  };

  // -----------------------------------------
  // Loading screen
  // -----------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="mt-3 text-sm text-muted-foreground">
            Loading operational settings...
          </p>
        </div>
      </div>
    );
  }

  // -----------------------------------------
  // Main page
  // -----------------------------------------

  return (
    <div className="space-y-8 p-4 md:p-6">

      {/* Page heading */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Operational Settings
          </h1>
        </div>

        <button
          type="button"
          onClick={() => void loadAll()}
          className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Refresh
        </button>
      </div>

      {/* Aggregate Types */}
      <section className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">

        <div>
          <h2 className="text-lg font-semibold">
            Aggregate Types
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            Create and manage different aggregate types and their prices per cubic meter.
          </p>
        </div>

        {/* Aggregate form */}
        <form
          onSubmit={saveAggregate}
          className="space-y-4 rounded-lg border bg-muted/20 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">
              {editingId !== null
                ? "Edit Aggregate Type"
                : "Add New Aggregate Type"}
            </h3>

            {editingId !== null && (
              <button
                type="button"
                onClick={resetAggregateForm}
                className="text-sm text-muted-foreground underline"
              >
                Cancel editing
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

            {/* Name */}
            <div>
              <label
                htmlFor="aggregate-name"
                className="mb-1.5 block text-sm font-medium"
              >
                Aggregate Name *
              </label>

              <input
                id="aggregate-name"
                type="text"
                maxLength={150}
                required
                value={aggregateForm.name}
                onChange={(event) =>
                  handleAggregateChange("name", event.target.value)
                }
                placeholder="e.g. Fine Aggregate"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Price */}
            <div>
              <label
                htmlFor="aggregate-price"
                className="mb-1.5 block text-sm font-medium"
              >
                Price per m³ (ETB) *
              </label>

              <input
                id="aggregate-price"
                type="number"
                min="0"
                step="0.01"
                required
                value={aggregateForm.pricePerM3}
                onChange={(event) =>
                  handleAggregateChange("pricePerM3", event.target.value)
                }
                placeholder="e.g. 1500"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="aggregate-description"
              className="mb-1.5 block text-sm font-medium"
            >
              Description
            </label>

            <textarea
              id="aggregate-description"
              rows={3}
              value={aggregateForm.description}
              onChange={(event) =>
                handleAggregateChange("description", event.target.value)
              }
              placeholder="Describe this aggregate type..."
              className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={savingAggregate}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingAggregate
                ? "Saving..."
                : editingId !== null
                  ? "Update Aggregate"
                  : "Add Aggregate"}
            </button>

            <button
              type="button"
              onClick={resetAggregateForm}
              className="rounded-lg border px-5 py-2 text-sm font-medium hover:bg-muted"
            >
              Clear
            </button>
          </div>
        </form>

        {/* Aggregate list */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">
              Existing Aggregate Types
            </h3>

            <span className="text-xs text-muted-foreground">
              {aggregateTypes.length} total
            </span>
          </div>

          {aggregateError && (
            <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              {aggregateError}
            </div>
          )}

          {aggregateTypes.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium">
                No aggregate types found
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                Add your first aggregate type using the form above.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">
                      Price per m³
                    </th>
                    <th className="px-4 py-3 font-semibold">
                      Description
                    </th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {aggregateTypes.map((aggregate) => (
                    <tr
                      key={aggregate.id}
                      className="hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 font-medium">
                        {aggregate.name}
                      </td>

                      <td className="px-4 py-3 tabular-nums">
                        {Number(aggregate.pricePerM3).toLocaleString(
                          "en-US",
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          },
                        )}{" "}
                        ETB
                      </td>

                      <td className="max-w-xs px-4 py-3 text-muted-foreground">
                        {aggregate.description || "—"}
                      </td>

                      <td className="px-4 py-3">
                        {aggregate.isActive ? (
                          <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                            Active
                          </span>
                        ) : (
                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                            Inactive
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={!aggregate.isActive}
                            onClick={() => editAggregate(aggregate)}
                            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Edit
                          </button>

                          {aggregate.isActive && (
                            <button
                              type="button"
                              disabled={deactivatingId === aggregate.id}
                              onClick={() =>
                                void deactivateAggregate(aggregate)
                              }
                              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              {deactivatingId === aggregate.id
                                ? "..."
                                : "Deactivate"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* General Operational Settings */}
      <section className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">

        <div>
          <h2 className="text-lg font-semibold">
            General Operational Settings
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            Configure general working and overtime rules.
          </p>
        </div>

        {settingsError && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {settingsError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">

          {/* Overtime */}
          <div className="rounded-lg border p-4">
            <label
              htmlFor="overtime-rate"
              className="block text-sm font-semibold"
            >
              Overtime Rate
            </label>

            <p className="mt-1 text-xs text-muted-foreground">
              Percentage multiplier used to calculate overtime pay.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <input
                id="overtime-rate"
                type="number"
                min="100"
                max="1000"
                step="0.01"
                value={settings.overtime_rate}
                onChange={(event) =>
                  handleSettingChange(
                    "overtime_rate",
                    event.target.value,
                  )
                }
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />

              <span className="font-semibold">%</span>
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              Example: 150% means 1.5 times the normal hourly rate.
            </p>
          </div>

          {/* Working hours */}
          <div className="rounded-lg border p-4">
            <label
              htmlFor="working-hours"
              className="block text-sm font-semibold"
            >
              Standard Working Hours
            </label>

            <p className="mt-1 text-xs text-muted-foreground">
              Normal working hours per day.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <input
                id="working-hours"
                type="number"
                min="0.01"
                max="24"
                step="0.25"
                value={settings.standard_working_hours}
                onChange={(event) =>
                  handleSettingChange(
                    "standard_working_hours",
                    event.target.value,
                  )
                }
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />

              <span className="whitespace-nowrap font-semibold">
                Hours/day
              </span>
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              Example: 8 hours per working day.
            </p>
          </div>

        </div>

        <div className="flex flex-wrap gap-3 border-t pt-4">
          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={savingSettings}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingSettings ? "Saving..." : "Save General Settings"}
          </button>

          <button
            type="button"
            onClick={discardSettings}
            disabled={savingSettings}
            className="rounded-lg border px-5 py-2 text-sm font-medium hover:bg-muted"
          >
            Discard Changes
          </button>
        </div>
      </section>
    </div>
  );
}
