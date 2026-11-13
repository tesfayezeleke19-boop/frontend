import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarOff,
  Search,
  Check,
  X,
  Eye,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  useHRLeaveRequests,
  useHREmployees,
  useApproveLeaveRequest,
  useRejectLeaveRequest,
} from "@/hooks/use-hr-data";
import { useAuth } from "@/hooks/use-auth";
import {
  LEAVE_TYPES,
  LEAVE_STATUS,
  LEAVE_STATUS_LABELS,
  type LeaveStatus,
  type LeaveType,
} from "@/services/hr/types";

const inputClass =
  "h-9 border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30";
const selectTriggerClass =
  "h-9 w-full border-input bg-popover text-sm text-foreground";

const STATUS_STYLE: Record<LeaveStatus, string> = {
  PENDING: "border-warning-border bg-warning-soft text-warning",
  APPROVED: "border-success-border bg-success-soft text-success",
  REJECTED: "border-destructive-border bg-destructive-soft text-destructive",
};

function formatDateStr(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Leave() {
  const { user } = useAuth();
  const actor = user?.name ?? "HR Staff";

  const { data: requests, loading } = useHRLeaveRequests();
  const { data: employees } = useHREmployees();
  const { approve, loading: approving } = useApproveLeaveRequest();
  const { reject, loading: rejecting } = useRejectLeaveRequest();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Dialog states
  const [viewing, setViewing] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  // Employee lookup
  const empMap = useMemo(() => {
    if (!employees) return new Map<string, string>();
    return new Map(employees.map((e) => [e.employee_id, e.full_name]));
  }, [employees]);

  const filtered = useMemo(() => {
    if (!requests) return [];
    const q = search.toLowerCase();
    return requests.filter((r) => {
      const name = empMap.get(r.employee_id) ?? r.employee_id;
      return (
        (name.toLowerCase().includes(q) ||
          r.employee_id.toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q)) &&
        (statusFilter === "all" || r.status === statusFilter)
      );
    });
  }, [requests, search, statusFilter, empMap]);

  const pendingCount = useMemo(
    () => requests?.filter((r) => r.status === "PENDING").length ?? 0,
    [requests],
  );

  const counts = useMemo(() => {
    if (!requests) return { pending: 0, approved: 0, rejected: 0 };
    return {
      pending: requests.filter((r) => r.status === "PENDING").length,
      approved: requests.filter((r) => r.status === "APPROVED").length,
      rejected: requests.filter((r) => r.status === "REJECTED").length,
    };
  }, [requests]);

  const handleApprove = async () => {
    if (!approvingId) return;
    try {
      await approve(approvingId, actor);
      toast.success("Leave request approved");
    } catch {
      toast.error("Unable to approve request");
    }
    setApprovingId(null);
  };

  const handleReject = async () => {
    if (!rejectingId || !rejectionReason.trim()) return;
    try {
      await reject(rejectingId, actor, rejectionReason.trim());
      toast.success("Leave request rejected");
    } catch {
      toast.error("Unable to reject request");
    }
    setRejectingId(null);
    setRejectionReason("");
  };

  const openReject = (id: string) => {
    setRejectingId(id);
    setRejectionReason("");
  };

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
          Leave Requests
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage employee leave applications.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold tabular-nums text-warning">
              {counts.pending}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
              Pending
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold tabular-nums text-success">
              {counts.approved}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
              Approved
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card shadow-none">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold tabular-nums text-destructive">
              {counts.rejected}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
              Rejected
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by employee or reason..."
            className={`${inputClass} pl-9`}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className={`${selectTriggerClass} w-40`}>
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent className="border-input bg-popover">
            <SelectItem value="all" className="text-sm text-foreground focus:bg-accent">
              All Status
            </SelectItem>
            {([LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED, LEAVE_STATUS.REJECTED] as const).map(
              (s) => (
                <SelectItem key={s} value={s} className="text-sm text-foreground focus:bg-accent">
                  {LEAVE_STATUS_LABELS[s]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="border-border bg-card shadow-none">
        <CardContent className="p-0">
          {filtered.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    <th className="px-4 py-2.5 font-medium">Employee</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">From</th>
                    <th className="px-4 py-2.5 font-medium">To</th>
                    <th className="px-4 py-2.5 font-medium">Reason</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((req) => (
                    <tr
                      key={req.leave_id}
                      className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.03]"
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-foreground">
                          {empMap.get(req.employee_id) ?? req.employee_id}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground/70">
                          {req.employee_id}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {req.type}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {formatDateStr(req.start_date)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {formatDateStr(req.end_date)}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-2.5 text-muted-foreground">
                        {req.reason}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant="outline"
                          className={`border text-[10px] font-medium ${STATUS_STYLE[req.status]}`}
                        >
                          {LEAVE_STATUS_LABELS[req.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setViewing(req.leave_id)}
                          >
                            <Eye className="size-3" />
                            View
                          </Button>
                          {req.status === "PENDING" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs text-muted-foreground hover:text-success"
                                onClick={() => setApprovingId(req.leave_id)}
                              >
                                <Check className="size-3" />
                                Approve
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                                onClick={() => openReject(req.leave_id)}
                              >
                                <X className="size-3" />
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarOff className="mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                {search || statusFilter !== "all"
                  ? "No requests match your filters"
                  : "No leave requests"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Dialog */}
      {viewing && (
        <ViewDialog
          requestId={viewing}
          empMap={empMap}
          onClose={() => setViewing(null)}
        />
      )}

      {/* Approve Confirmation Dialog */}
      <Dialog
        open={!!approvingId}
        onOpenChange={(open) => !open && setApprovingId(null)}
      >
        <DialogContent className="border-input bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">
              Approve Leave Request
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Are you sure you want to approve this leave request?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setApprovingId(null)}
              disabled={approving}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approving}
              className="gap-2 bg-success text-primary-foreground hover:bg-success"
            >
              {approving && <Loader2 className="size-4 animate-spin" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog (requires reason) */}
      <Dialog
        open={!!rejectingId}
        onOpenChange={(open) => {
          if (!open) {
            setRejectingId(null);
            setRejectionReason("");
          }
        }}
      >
        <DialogContent className="border-input bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">
              Reject Leave Request
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Please provide a reason for rejecting this request.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">
              Rejection Reason *
            </Label>
            <Input
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Insufficient coverage during peak period"
              className={`${inputClass} mt-1`}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRejectingId(null);
                setRejectionReason("");
              }}
              disabled={rejecting}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleReject}
              disabled={rejecting || !rejectionReason.trim()}
              className="gap-2 bg-destructive text-primary-foreground hover:bg-destructive"
            >
              {rejecting && <Loader2 className="size-4 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* View Dialog                                                         */
/* ------------------------------------------------------------------ */

function ViewDialog({
  requestId,
  empMap,
  onClose,
}: {
  requestId: string;
  empMap: Map<string, string>;
  onClose: () => void;
}) {
  const { data: requests } = useHRLeaveRequests();
  const request = requests?.find((r) => r.leave_id === requestId);

  if (!request) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-input bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-semibold text-foreground">
            Leave Request Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <DetailRow
            label="Employee"
            value={empMap.get(request.employee_id) ?? request.employee_id}
          />
          <DetailRow label="Employee ID" value={request.employee_id} mono />
          <DetailRow label="Leave Type" value={request.type} />
          <DetailRow label="Start Date" value={formatDateStr(request.start_date)} mono />
          <DetailRow label="End Date" value={formatDateStr(request.end_date)} mono />
          <DetailRow label="Reason" value={request.reason} />
          <DetailRow
            label="Status"
            value={LEAVE_STATUS_LABELS[request.status]}
            badge
            badgeStyle={STATUS_STYLE[request.status]}
          />
          <DetailRow
            label="Applied On"
            value={formatDateTime(request.created_date)}
            mono
          />
          {request.reviewed_by && (
            <DetailRow label="Reviewed By" value={request.reviewed_by} />
          )}
          {request.reviewed_date && (
            <DetailRow
              label="Reviewed On"
              value={formatDateTime(request.reviewed_date)}
              mono
            />
          )}
          {request.rejection_reason && (
            <DetailRow
              label="Rejection Reason"
              value={request.rejection_reason}
              highlight
            />
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label,
  value,
  mono,
  badge,
  badgeStyle,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: boolean;
  badgeStyle?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="text-xs text-muted-foreground/70">{label}</span>
      {badge ? (
        <Badge
          variant="outline"
          className={`border text-[10px] font-medium ${badgeStyle}`}
        >
          {value}
        </Badge>
      ) : (
        <span
          className={`text-sm ${
            mono ? "font-mono text-xs text-muted-foreground" : ""
          } ${highlight ? "max-w-[200px] text-sm text-destructive" : "text-foreground"}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}
