/**
 * Public entry point for the future REST backend integration. Feature modules
 * import from `@/lib/api` (or a feature adapter), never from transport code.
 *
 * See docs/backend-integration.md for the integration sequence and
 * docs/api-contracts.md for the endpoint contract.
 */
export {
  API_BASE_URL,
  API_TIMEOUT_MS,
  API_WITH_CREDENTIALS,
  HR_API_BASE_URL,
  apiUrl,
  isApiConfigured,
} from "./config";
export {
  ApiClient,
  apiClient,
  configureApiAuth,
  unwrapApiData,
  type ApiClientOptions,
  type ApiRequestOptions,
  type ApiTokenProvider,
  type HttpMethod,
  type QueryParams,
  type QueryValue,
} from "./client";
export {
  ApiConfigurationError,
  ApiError,
  ApiNotImplementedError,
  ApiValidationError,
  apiErrorMessage,
  apiErrorFromResponse,
  isApiError,
  isUnauthorizedError,
  type ApiErrorKind,
  type ApiErrorOptions,
} from "./errors";
export type {
  ApiAttachmentDto,
  ApiEnvelope,
  ApiErrorBody,
  ApiExpenseDto,
  ApiExpenseLegacyStatus,
  ApiExpenseListQuery,
  ApiExpenseReviewStatus,
  ApiExpenseReviewSummaryDto,
  ApiExpenseSource,
  ApiExpenseStatusHistoryDto,
  ApiExpenseType,
  ApiExpenseWriteDto,
  ApiSessionDto,
  ApiUserDto,
  MoneyDto,
  PaginatedResponse,
  PaginationMeta,
} from "./types";
export { EMPTY_PAGINATION } from "./types";
