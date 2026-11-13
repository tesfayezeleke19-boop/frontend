/**
 * REST adapters — future backend implementations of the feature repository
 * interfaces. Nothing here is wired into the running UI yet; the current
 * implementation stays active until the backend endpoints are verified.
 */
export {
  RestExpensesRepository,
  createRestExpensesRepository,
} from "./expensesRepository";
export {
  toExpense,
  toExpenseWriteDto,
  toExpenseUpdateDto,
} from "./expenseDto";
