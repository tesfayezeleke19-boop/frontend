/**
 * Mock HR data for development/demo when the live API is unavailable.
 * All fields match the API contract exactly.
 */

import { ATTENDANCE_STATUS } from "./types";
import type {
  AttendanceRecord,
  Employee,
} from "./types";

const employees: Employee[] = [
  {
    employee_id: "EMP-001",
    full_name: "Abebe Kebede",
    phone: "+251-911-123456",
    position: "Sales Manager",
    hired_date: "2023-01-15",
    emergency_contact_name: "Hiwot Kebede",
    emergency_phone: "+251-911-123457",
    document_photo: "",
    salary: 25000,
    is_active: true,
  },
  {
    employee_id: "EMP-002",
    full_name: "Tigist Haile",
    phone: "+251-911-234567",
    position: "Finance Officer",
    hired_date: "2023-03-20",
    emergency_contact_name: "Solomon Haile",
    emergency_phone: "+251-911-234568",
    document_photo: "",
    salary: 22000,
    is_active: true,
  },
  {
    employee_id: "EMP-003",
    full_name: "Dawit Mulugeta",
    phone: "+251-911-345678",
    position: "Sales Representative",
    hired_date: "2023-06-01",
    emergency_contact_name: "Meron Mulugeta",
    emergency_phone: "+251-911-345679",
    document_photo: "",
    salary: 15000,
    is_active: true,
  },
  {
    employee_id: "EMP-004",
    full_name: "Sara Tadesse",
    phone: "+251-911-456789",
    position: "HR Manager",
    hired_date: "2022-11-10",
    emergency_contact_name: "Daniel Tadesse",
    emergency_phone: "+251-911-456790",
    document_photo: "",
    salary: 24000,
    is_active: true,
  },
  {
    employee_id: "EMP-005",
    full_name: "Yonas Girma",
    phone: "+251-911-567890",
    position: "Operations Lead",
    hired_date: "2023-08-15",
    emergency_contact_name: "Ruth Girma",
    emergency_phone: "+251-911-567891",
    document_photo: "",
    salary: 20000,
    is_active: true,
  },
  {
    employee_id: "EMP-006",
    full_name: "Meskerem Alemayehu",
    phone: "+251-911-678901",
    position: "Accountant",
    hired_date: "2024-01-05",
    emergency_contact_name: "Tesfaye Alemayehu",
    emergency_phone: "+251-911-678902",
    document_photo: "",
    salary: 18000,
    is_active: true,
  },
  {
    employee_id: "EMP-007",
    full_name: "Bereket Fenta",
    phone: "+251-911-789012",
    position: "Machine Operator",
    hired_date: "2022-06-20",
    emergency_contact_name: "Abel Fenta",
    emergency_phone: "+251-911-789013",
    document_photo: "",
    salary: 12000,
    is_active: false,
  },
  {
    employee_id: "EMP-008",
    full_name: "Hana Worku",
    phone: "+251-911-890123",
    position: "Junior Sales Rep",
    hired_date: "2024-04-01",
    emergency_contact_name: "Natan Worku",
    emergency_phone: "+251-911-890124",
    document_photo: "",
    salary: 10000,
    is_active: true,
  },
];

const today = new Date().toISOString().split("T")[0];

const attendance: AttendanceRecord[] = [
  {
    attendance_id: "ATT-001",
    employee_id: "EMP-001",
    attendance_date: today,
    status: ATTENDANCE_STATUS.PRESENT,
    overtime_hours: 1.5,
    note: "Completed quarterly report",
  },
  {
    attendance_id: "ATT-002",
    employee_id: "EMP-002",
    attendance_date: today,
    status: ATTENDANCE_STATUS.LATE,
    overtime_hours: 0,
    note: "Traffic delay",
  },
  {
    attendance_id: "ATT-003",
    employee_id: "EMP-003",
    attendance_date: today,
    status: ATTENDANCE_STATUS.ABSENT,
    overtime_hours: 0,
    note: "No show — unnotified",
  },
  {
    attendance_id: "ATT-004",
    employee_id: "EMP-004",
    attendance_date: today,
    status: ATTENDANCE_STATUS.LEAVE,
    overtime_hours: 0,
    note: "Annual leave — personal appointment",
  },
  {
    attendance_id: "ATT-005",
    employee_id: "EMP-005",
    attendance_date: today,
    status: ATTENDANCE_STATUS.PRESENT,
    overtime_hours: 2,
    note: "Overtime for site inspection",
  },
  {
    attendance_id: "ATT-006",
    employee_id: "EMP-006",
    attendance_date: today,
    status: ATTENDANCE_STATUS.PRESENT,
    overtime_hours: 0,
    note: "",
  },
  {
    attendance_id: "ATT-007",
    employee_id: "EMP-008",
    attendance_date: today,
    status: ATTENDANCE_STATUS.PRESENT,
    overtime_hours: 0.5,
    note: "Late handover from previous shift",
  },
];





export function getMockData() {
  return { employees, attendance };
}
