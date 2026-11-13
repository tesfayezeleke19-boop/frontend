/**
 * Leave repository — local persistence for leave requests.
 *
 * There is no Leave API in the current backend documentation. This module
 * provides a clean repository abstraction so:
 *   1. The UI works fully with localStorage persistence today.
 *   2. When a Leave API is provided, swap this for a LiveLeaveRepository
 *      implementing the same interface — no UI changes needed.
 *
 * Payroll can later read approved leave from this repository to calculate
 * working days, absences, and salary adjustments.
 */

import type {
  LeaveRequest,
  LeaveStatus,
  LeaveType,
} from "./types";

const LEAVE_KEY = "nexerp.hr.leave.v1";

/* ------------------------------------------------------------------ */
/* Persistence helpers                                                 */
/* ------------------------------------------------------------------ */

function load(): LeaveRequest[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(LEAVE_KEY);
    return raw ? (JSON.parse(raw) as LeaveRequest[]) : [];
  } catch {
    return [];
  }
}

function persist(records: LeaveRequest[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LEAVE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage failures
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `leave-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ */
/* Repository interface                                                */
/* ------------------------------------------------------------------ */

export interface LeaveRepository {
  getRequests(): LeaveRequest[];
  getRequestById(id: string): LeaveRequest | null;
  createRequest(input: {
    employee_id: string;
    type: LeaveType;
    start_date: string;
    end_date: string;
    reason: string;
  }): LeaveRequest;
  approveRequest(id: string, reviewedBy: string): LeaveRequest;
  rejectRequest(
    id: string,
    reviewedBy: string,
    rejectionReason: string,
  ): LeaveRequest;
  deleteRequest(id: string): void;
}

class LocalLeaveRepository implements LeaveRepository {
  private records: LeaveRequest[];

  constructor() {
    this.records = load();
    if (this.records.length === 0) {
      // Seed demo data on first run
      this.records = buildSeeds();
      persist(this.records);
    }
  }

  getRequests(): LeaveRequest[] {
    return [...this.records].sort(
      (a, b) =>
        new Date(b.created_date).getTime() -
        new Date(a.created_date).getTime(),
    );
  }

  getRequestById(id: string): LeaveRequest | null {
    return this.records.find((r) => r.leave_id === id) ?? null;
  }

  createRequest(input: {
    employee_id: string;
    type: LeaveType;
    start_date: string;
    end_date: string;
    reason: string;
  }): LeaveRequest {
    const now = new Date().toISOString();
    const request: LeaveRequest = {
      leave_id: createId(),
      employee_id: input.employee_id,
      type: input.type,
      start_date: input.start_date,
      end_date: input.end_date,
      reason: input.reason,
      status: "PENDING",
      created_date: now,
    };
    this.records.push(request);
    persist(this.records);
    return request;
  }

  approveRequest(id: string, reviewedBy: string): LeaveRequest {
    const idx = this.records.findIndex((r) => r.leave_id === id);
    if (idx === -1) throw new Error("Leave request not found");
    if (this.records[idx].status !== "PENDING") {
      throw new Error("Only pending requests can be approved");
    }
    const now = new Date().toISOString();
    this.records[idx] = {
      ...this.records[idx],
      status: "APPROVED",
      reviewed_by: reviewedBy,
      reviewed_date: now,
    };
    persist(this.records);
    return this.records[idx];
  }

  rejectRequest(
    id: string,
    reviewedBy: string,
    rejectionReason: string,
  ): LeaveRequest {
    const idx = this.records.findIndex((r) => r.leave_id === id);
    if (idx === -1) throw new Error("Leave request not found");
    if (this.records[idx].status !== "PENDING") {
      throw new Error("Only pending requests can be rejected");
    }
    const now = new Date().toISOString();
    this.records[idx] = {
      ...this.records[idx],
      status: "REJECTED",
      reviewed_by: reviewedBy,
      reviewed_date: now,
      rejection_reason: rejectionReason,
    };
    persist(this.records);
    return this.records[idx];
  }

  deleteRequest(id: string): void {
    this.records = this.records.filter((r) => r.leave_id !== id);
    persist(this.records);
  }
}

/* ------------------------------------------------------------------ */
/* Seed data                                                          */
/* ------------------------------------------------------------------ */

function buildSeeds(): LeaveRequest[] {
  const today = new Date().toISOString().split("T")[0];
  return [
    {
      leave_id: "leave-001",
      employee_id: "EMP-004",
      type: "Annual",
      start_date: today,
      end_date: today,
      reason: "Personal appointment",
      status: "PENDING",
      created_date: "2026-08-26T10:00:00Z",
    },
    {
      leave_id: "leave-002",
      employee_id: "EMP-003",
      type: "Sick",
      start_date: "2026-08-25",
      end_date: "2026-08-27",
      reason: "Feeling unwell — doctor visit",
      status: "PENDING",
      created_date: "2026-08-25T07:30:00Z",
    },
    {
      leave_id: "leave-003",
      employee_id: "EMP-005",
      type: "Personal",
      start_date: "2026-08-20",
      end_date: "2026-08-20",
      reason: "Family event",
      status: "APPROVED",
      created_date: "2026-08-18T14:00:00Z",
      reviewed_by: "Sara Tadesse",
      reviewed_date: "2026-08-18T16:00:00Z",
    },
    {
      leave_id: "leave-004",
      employee_id: "EMP-006",
      type: "Sick",
      start_date: "2026-08-10",
      end_date: "2026-08-12",
      reason: "Medical procedure",
      status: "APPROVED",
      created_date: "2026-08-08T09:00:00Z",
      reviewed_by: "Sara Tadesse",
      reviewed_date: "2026-08-08T11:00:00Z",
    },
    {
      leave_id: "leave-005",
      employee_id: "EMP-008",
      type: "Annual",
      start_date: "2026-08-15",
      end_date: "2026-08-15",
      reason: "Personal errands",
      status: "REJECTED",
      created_date: "2026-08-12T08:00:00Z",
      reviewed_by: "Sara Tadesse",
      reviewed_date: "2026-08-12T10:00:00Z",
      rejection_reason: "Peak sales period — insufficient coverage",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Singleton export                                                    */
/* ------------------------------------------------------------------ */

export const leaveRepository: LeaveRepository = new LocalLeaveRepository();

/**
 * Reset the repository (clears localStorage and re-seeds).
 * Useful during development.
 */
export function resetLeaveRepository(): void {
  localStorage.removeItem(LEAVE_KEY);
}
