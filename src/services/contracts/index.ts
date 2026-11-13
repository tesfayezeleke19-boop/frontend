/**
 * Contract Orders service layer.
 *
 * UI components import contracts through this module only — never from
 * storage directly — so replacing the browser-local persistence with the
 * PHP REST API later means replacing the repository, not the pages.
 */
export * from "./types";
export * from "./financials";
export {
  contractsRepository,
  completedContractOrders,
  ContractPermissionError,
  type ContractsRepository,
} from "./repository";
export {
  loadContractOrders,
  loadContracts,
  notifyContractsChanged,
  persistContractOrders,
  persistContracts,
  subscribeContracts,
} from "./storage";
