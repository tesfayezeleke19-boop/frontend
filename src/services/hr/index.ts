/**
 * HR service layer — the only way the HR UI reads and writes HR data.
 * Swapping the mock client for the live PHP API happens in apiClient.ts;
 * the UI and hooks never change.
 */
export * from "./types";
export {
  getHRApiClient,
  setHrAuthToken,
  getHrAuthToken,
  useMockHRClient,
  resetHRApiClient,
  type HRApiClient,
} from "./apiClient";
export {
  leaveRepository,
  resetLeaveRepository,
  type LeaveRepository,
} from "./leaveRepository";
export {
  payrollRepository,
} from "./payrollRepository";
