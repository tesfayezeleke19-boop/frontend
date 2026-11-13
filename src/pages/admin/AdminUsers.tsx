
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Users,
  UserPlus,
  Loader2,
  Search,
  ShieldCheck,
  ShieldAlert,
  Ban,
  RotateCcw,
  Pencil,
  KeyRound,
  History,
  Rocket,
  Eye,
  EyeOff,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  authRepository,
  USER_ROLES,
  USER_ROLE_LABELS,
  ValidationError,
  PermissionDeniedError,
  type ManagedAccount,
  type AuthAuditEntry,
  type UserRole,
} from "@/services/auth";
import { formatDate } from "@/services/sales/format";

const inputClass =
  "h-9 border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30";

const selectTriggerClass =
  "h-9 w-full border-input bg-popover text-sm text-foreground";

type ManageDialogKind =
  | "create"
  | "edit"
  | "disable"
  | "reactivate"
  | "reset";

interface FormState {
  name: string;
  email: string;
  role: UserRole;
  department: string;
  initialPassword: string;
}

const emptyForm: FormState = {
  name: "",
  email: "",
  role: "SALES",
  department: "",
  initialPassword: "",
};

export default function AdminUsers() {
  const { session } = useAuth();
  const caller = session;

  const [accounts, setAccounts] = useState<ManagedAccount[] | null>(null);
  const [auditLog, setAuditLog] = useState<AuthAuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [dialog, setDialog] = useState<{
    kind: ManageDialogKind;
    account?: ManagedAccount;
  } | null>(null);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [isWorking, setIsWorking] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  const load = async () => {
    try {
      setLoadError(null);

      const [list, log] = await Promise.all([
        authRepository.listAccounts(caller),
        authRepository.getAuditLog(caller),
      ]);

      setAccounts(list);
      setAuditLog(log);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Unable to load user accounts",
      );
      setAccounts(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caller?.user.id]);

  const filtered = (accounts ?? []).filter((account) => {
    if (roleFilter !== "all" && account.role !== roleFilter) {
      return false;
    }

    if (
      statusFilter !== "all" &&
      account.accountStatus !== statusFilter
    ) {
      return false;
    }

    const query = search.trim().toLowerCase();

    if (!query) return true;

    return (
      account.name.toLowerCase().includes(query) ||
      account.email.toLowerCase().includes(query)
    );
  });

  const openDialog = (
    kind: ManageDialogKind,
    account?: ManagedAccount,
  ) => {
    setErrors({});
    setShowPassword(false);

    if (kind === "create") {
      setForm(emptyForm);
    }

    if (kind === "edit" && account) {
      setForm({
        name: account.name,
        email: account.email,
        role: account.role,
        department: account.department,
        initialPassword: "",
      });
    }

    setDialog({ kind, account });
  };

  const closeDialog = () => {
    if (isWorking) return;

    setDialog(null);
    setForm(emptyForm);
    setErrors({});
    setShowPassword(false);
  };

  const runOperation = async (
    fn: () => Promise<unknown>,
    successMsg: string,
  ) => {
    setIsWorking(true);

    try {
      await fn();

      toast.success(successMsg);
      setDialog(null);
      setForm(emptyForm);
      setErrors({});
      setShowPassword(false);

      await load();
      return true;
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        toast.error(error.message);
      } else if (error instanceof ValidationError) {
        toast.error(error.message);

        if (dialog?.kind === "create" || dialog?.kind === "edit") {
          setErrors({ form: error.message });
        }
      } else {
        toast.error(
          error instanceof Error ? error.message : "Operation failed",
        );
      }

      return false;
    } finally {
      setIsWorking(false);
    }
  };

  const handleCreate = () => {
    const nextErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      nextErrors.name = "Full name is required.";
    }

    if (!form.email.trim()) {
      nextErrors.email = "Email address is required.";
    } else if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    ) {
      nextErrors.email = "Enter a valid email address.";
    }

    if (form.initialPassword.length < 12) {
      nextErrors.initialPassword =
        "Password must contain at least 12 characters.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});

    return runOperation(
      () =>
        authRepository.createAccount(caller, {
          name: form.name.trim(),
          email: form.email.trim(),
          role: form.role,
          department: form.department.trim(),
          initialPassword: form.initialPassword,
        }),
      "Account created successfully",
    );
  };

  const handleEdit = () => {
    if (!dialog?.account) return;

    return runOperation(
      () =>
        authRepository.updateAccount(caller, dialog.account!.id, {
          name: form.name,
          department: form.department,
          role: form.role,
        }),
      "Account updated",
    );
  };

  const handleDisable = () => {
    if (!dialog?.account) return;

    return runOperation(
      () =>
        authRepository.setAccountStatus(
          caller,
          dialog.account!.id,
          "DISABLED",
        ),
      "Account disabled",
    );
  };

  const handleReactivate = () => {
    if (!dialog?.account) return;

    return runOperation(
      () =>
        authRepository.setAccountStatus(
          caller,
          dialog.account!.id,
          "ACTIVE",
        ),
      "Account reactivated",
    );
  };

  const handlePasswordReset = async () => {
    if (!dialog?.account) return;

    setIsWorking(true);

    try {
      const result = await authRepository.initiatePasswordReset(
        caller,
        dialog.account.id,
      );

      if (result.requiresBackend) {
        toast.warning(
          "Password reset requires a configured backend reset flow. No reset email has been sent.",
          { duration: 8000 },
        );
      } else if (result.initiated) {
        toast.success("Password reset request processed.");
      } else {
        toast.warning("Password reset has not been completed.");
      }

      setDialog(null);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Password reset failed",
      );
    } finally {
      setIsWorking(false);
    }
  };

  const activeCount = (accounts ?? []).filter(
    (account) => account.accountStatus === "ACTIVE",
  ).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="mb-3 size-8 text-destructive" />

        <p className="text-sm font-medium text-foreground">
          Unable to load user accounts
        </p>

        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          {loadError}
        </p>

        <Button
          onClick={() => {
            setLoading(true);
            void load();
          }}
          variant="outline"
          size="sm"
          className="mt-4 border-input text-xs text-foreground hover:bg-accent"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            User &amp; Role Management
          </h1>


        </div>

        <Button
          onClick={() => openDialog("create")}
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <UserPlus className="size-4" />
          New User
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Total Accounts
              </span>
              <Users className="size-3.5 text-info" />
            </div>

            <div className="mt-2 font-heading text-xl font-semibold text-foreground">
              {accounts?.length ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground">
              Active
            </span>
            <div className="mt-2 font-heading text-xl font-semibold text-success">
              {activeCount}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground">
              Disabled
            </span>
            <div className="mt-2 font-heading text-xl font-semibold text-destructive">
              {(accounts ?? []).filter(
                (account) => account.accountStatus === "DISABLED",
              ).length}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-muted-foreground">
              Administrators
            </span>
            <div className="mt-2 font-heading text-xl font-semibold text-violet">
              {(accounts ?? []).filter(
                (account) =>
                  account.role === USER_ROLES.ADMIN &&
                  account.accountStatus === "ACTIVE",
              ).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or email..."
            className={`${inputClass} w-64 pl-8`}
          />
        </div>

        <select
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          className={`${inputClass} w-40 rounded-lg px-2`}
        >
          <option value="all">All Roles</option>
          <option value={USER_ROLES.ADMIN}>Admin</option>
          <option value={USER_ROLES.SALES}>Sales</option>
          <option value={USER_ROLES.FINANCE}>Finance</option>
          <option value={USER_ROLES.HR}>HR</option>
        </select>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className={`${inputClass} w-40 rounded-lg px-2`}
        >
          <option value="all">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </div>

      {/* Accounts table */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            User Accounts ({filtered.length})
          </CardTitle>

          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            <ShieldCheck className="size-3.5" />
            Admin only
          </span>
        </CardHeader>

        <CardContent className="p-0">
          {filtered.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Email</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((account) => {
                    const isSelf = caller?.user.email === account.email;

                    return (
                      <tr
                        key={account.id}
                        className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                      >
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {account.name}

                          {isSelf && (
                            <span className="ml-2 font-mono text-[9px] uppercase tracking-wide text-muted-foreground/70">
                              you
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {account.email}
                        </td>

                        <td className="px-4 py-2.5 text-muted-foreground">
                          {USER_ROLE_LABELS[account.role]}
                        </td>

                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`border text-[10px] font-medium ${
                              account.accountStatus === "ACTIVE"
                                ? "erp-badge-approved"
                                : "erp-badge-rejected"
                            }`}
                          >
                            {account.accountStatus}
                          </Badge>
                        </td>

                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {formatDate(account.createdAt)}
                        </td>

                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-muted-foreground hover:text-info"
                              onClick={() => openDialog("edit", account)}
                            >
                              <Pencil className="size-3" />
                              Edit
                            </Button>

                            {account.accountStatus === "ACTIVE" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                                disabled={isSelf}
                                title={
                                  isSelf
                                    ? "You cannot disable your own account"
                                    : undefined
                                }
                                onClick={() => openDialog("disable", account)}
                              >
                                <Ban className="size-3" />
                                Disable
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs text-success hover:text-success"
                                onClick={() => openDialog("reactivate", account)}
                              >
                                <RotateCcw className="size-3" />
                                Reactivate
                              </Button>
                            )}

                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-warning"
                              title="Initiate password reset"
                              onClick={() => openDialog("reset", account)}
                            >
                              <KeyRound className="size-3" />
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
                No accounts match the filters
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Adjust search or filters, or create a new user account.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit log */}
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            User Management Audit Log ({auditLog?.length ?? 0})
          </CardTitle>

          <History className="size-4 text-muted-foreground/70" />
        </CardHeader>

        <CardContent className="p-0">
          {auditLog && auditLog.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-4 py-2 font-medium">Actor</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Target</th>
                    <th className="px-4 py-2 font-medium">Outcome</th>
                    <th className="px-4 py-2 font-medium">Details</th>
                  </tr>
                </thead>

                <tbody>
                  {auditLog.slice(0, 50).map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>

                      <td className="px-4 py-2 font-mono text-muted-foreground">
                        {entry.actorEmail}
                      </td>

                      <td className="px-4 py-2 font-mono text-foreground">
                        {entry.action}
                      </td>

                      <td className="px-4 py-2 font-mono text-muted-foreground">
                        {entry.targetEmail ?? "—"}
                      </td>

                      <td className="px-4 py-2">
                        <span
                          className={
                            entry.outcome === "SUCCESS"
                              ? "text-success"
                              : entry.outcome === "BLOCKED"
                                ? "text-warning"
                                : "text-destructive"
                          }
                        >
                          {entry.outcome}
                        </span>
                      </td>

                      <td className="px-4 py-2 text-muted-foreground">
                        {entry.details ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground/70">
              No user-management activity recorded yet. Actions appear here
              as admins create, edit, disable, or reactivate accounts.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Development information */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="p-4">
          <div className="flex items-start gap-2.5">
            <Rocket className="mt-0.5 size-4 shrink-0 text-info" />

            <p className="text-xs leading-5 text-muted-foreground">
              Account creation and status changes are processed by the
              authentication backend. New accounts receive the initial
              password entered by the administrator. Password-reset email
              delivery requires a separately configured backend reset flow.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog
        open={dialog?.kind === "create" || dialog?.kind === "edit"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent className="border-input bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-lg font-semibold text-foreground">
              {dialog?.kind === "create"
                ? "New User Account"
                : "Edit User"}
            </DialogTitle>

          </DialogHeader>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Full Name *
              </Label>

              <Input
                value={form.name}
                onChange={(event) => {
                  setForm((previous) => ({
                    ...previous,
                    name: event.target.value,
                  }));
                  setErrors((previous) => ({ ...previous, name: "" }));
                }}
                placeholder="e.g. Abebe Kebede"
                className={`${inputClass} mt-1`}
                autoComplete="name"
              />

              {errors.name && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.name}
                </p>
              )}
            </div>

            {/* Email */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Email / Login Identifier *
              </Label>

              <Input
                type="email"
                value={form.email}
                onChange={(event) => {
                  setForm((previous) => ({
                    ...previous,
                    email: event.target.value,
                  }));
                  setErrors((previous) => ({ ...previous, email: "" }));
                }}
                placeholder="name@company.com"
                disabled={dialog?.kind === "edit"}
                className={`${inputClass} mt-1 font-mono text-xs ${
                  dialog?.kind === "edit" ? "opacity-60" : ""
                }`}
                autoComplete="email"
              />

              {dialog?.kind === "edit" && (
                <p className="mt-1 text-[10px] text-muted-foreground/70">
                  Email is the immutable login identifier and cannot be changed.
                </p>
              )}

              {errors.email && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.email}
                </p>
              )}
            </div>

            {/* Initial password: create only */}
            {dialog?.kind === "create" && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  Initial Password *
                </Label>

                <div className="relative mt-1">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={form.initialPassword}
                    onChange={(event) => {
                      setForm((previous) => ({
                        ...previous,
                        initialPassword: event.target.value,
                      }));

                      setErrors((previous) => ({
                        ...previous,
                        initialPassword: "",
                      }));
                    }}
                    placeholder="Enter at least 12 characters"
                    className={`${inputClass} pr-10`}
                    autoComplete="new-password"
                    minLength={12}
                    required
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((previous) => !previous)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>

                <p className="mt-1 text-[10px] text-muted-foreground">
                  Use at least 12 characters. Avoid predictable passwords
                  such as 1234 or Password123.
                </p>

                {errors.initialPassword && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.initialPassword}
                  </p>
                )}
              </div>
            )}

            {/* Role */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Role *
              </Label>

              <Select
                value={form.role}
                onValueChange={(value) =>
                  setForm((previous) => ({
                    ...previous,
                    role: value as UserRole,
                  }))
                }
              >
                <SelectTrigger className={`${selectTriggerClass} mt-1`}>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent className="border-input bg-popover">
                  {(
                    [
                      USER_ROLES.SALES,
                      USER_ROLES.FINANCE,
                      USER_ROLES.HR,
                      USER_ROLES.ADMIN,
                    ] as UserRole[]
                  ).map((role) => (
                    <SelectItem
                      key={role}
                      value={role}
                      className="text-sm text-foreground focus:bg-accent"
                    >
                      {USER_ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Department */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                Department
              </Label>

              <Input
                value={form.department}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    department: event.target.value,
                  }))
                }
                placeholder="Defaults from role"
                className={`${inputClass} mt-1`}
              />
            </div>

            {errors.form && (
              <p className="text-xs text-destructive">{errors.form}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={closeDialog}
              disabled={isWorking}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>

            <Button
              onClick={
                dialog?.kind === "create" ? handleCreate : handleEdit
              }
              disabled={isWorking}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isWorking && <Loader2 className="size-4 animate-spin" />}

              {dialog?.kind === "create"
                ? "Create Account"
                : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable / Reactivate dialog */}
      <Dialog
        open={
          dialog?.kind === "disable" || dialog?.kind === "reactivate"
        }
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent className="border-input bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">
              {dialog?.kind === "disable"
                ? "Disable Account"
                : "Reactivate Account"}
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              {dialog?.kind === "disable"
                ? `Disable ${dialog.account?.email ?? "this account"}? The user will be rejected at sign-in and lose protected-route access. Their historical records are preserved.`
                : `Restore access for ${dialog?.account?.email ?? "this account"}? Historical records are unaffected.`}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={closeDialog}
              disabled={isWorking}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>

            <Button
              onClick={
                dialog?.kind === "disable"
                  ? handleDisable
                  : handleReactivate
              }
              disabled={isWorking}
              className={
                dialog?.kind === "disable"
                  ? "gap-2 bg-destructive text-primary-foreground hover:bg-destructive"
                  : "gap-2 bg-success text-primary-foreground hover:bg-success"
              }
            >
              {isWorking && <Loader2 className="size-4 animate-spin" />}

              {dialog?.kind === "disable"
                ? "Disable Account"
                : "Reactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password reset dialog */}
      <Dialog
        open={dialog?.kind === "reset"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent className="border-input bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">
              Initiate Password Reset
            </DialogTitle>

            <DialogDescription className="text-sm text-muted-foreground">
              This requests a password reset for {dialog?.account?.email}.
              An actual reset email is sent only if the backend reset
              workflow is configured.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={closeDialog}
              disabled={isWorking}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>

            <Button
              onClick={handlePasswordReset}
              disabled={isWorking}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isWorking && <Loader2 className="size-4 animate-spin" />}
              Request Password Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
