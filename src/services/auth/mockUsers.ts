/**
 * DEVELOPMENT-ONLY mock users.
 *
 * These accounts exist so the frontend can be signed in to and demonstrated
 * before the PHP authentication API is built. They are not real accounts and
 * provide NO production security — do not ship these credentials, and do not
 * claim that mock authentication is secure.
 *
 * Development credentials:
 *   Sales   — sales@company.com   / nexerp-dev
 *   Finance — finance@company.com / nexerp-dev
 *   Admin   — admin@company.com   / nexerp-dev
 */
import { USER_ROLES, type AuthUser } from "./types";

export const DEV_PASSWORD = "nexerp-dev";

export interface DevUser extends AuthUser {
  password: string;
  accountStatus: "ACTIVE" | "DISABLED";
  createdAt: number;
}

const RECORD_START = new Date(2026, 0, 15).getTime();

export const DEV_USERS: DevUser[] = [
  {
    id: "usr-sales-1",
    name: "Sales Team",
    email: "sales@company.com",
    password: DEV_PASSWORD,
    role: USER_ROLES.SALES,
    department: "Sales",
    accountStatus: "ACTIVE",
    createdAt: RECORD_START,
  },
  {
    id: "usr-finance-1",
    name: "Finance Team",
    email: "finance@company.com",
    password: DEV_PASSWORD,
    role: USER_ROLES.FINANCE,
    department: "Finance",
    accountStatus: "ACTIVE",
    createdAt: RECORD_START,
  },
  {
    id: "usr-hr-1",
    name: "HR Manager",
    email: "hr@company.com",
    password: DEV_PASSWORD,
    role: USER_ROLES.HR,
    department: "Human Resources",
    accountStatus: "ACTIVE",
    createdAt: RECORD_START,
  },
  {
    id: "usr-admin-1",
    name: "System Admin",
    email: "admin@company.com",
    password: DEV_PASSWORD,
    role: USER_ROLES.ADMIN,
    department: "Administration",
    accountStatus: "ACTIVE",
    createdAt: RECORD_START,
  },
];
