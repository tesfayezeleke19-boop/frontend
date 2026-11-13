
import { authRepository } from "../auth/authRepository";
import type {
  Contract,
  ContractInput,
  ContractOrder,
  ContractOrderInput,
  ContractProgress,
} from "./types";
import type {
  ContractFinancialInput,
  ContractFinancialReport,
} from "./financials";

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080"
).replace(/\/+$/, "");

const ROOT = `${API_BASE}/api/contracts`;

type ApiRecord = Record<string, any>;

function toEpoch(value: unknown): number {
  if (typeof value === "number") return value;
  if (!value) return 0;

  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T12:00:00`)
    : new Date(text);

  const result = date.getTime();
  return Number.isFinite(result) ? result : 0;
}

function toDateString(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(
    typeof value === "number" ? value : String(value ?? ""),
  );

  if (!Number.isFinite(date.getTime())) {
    throw new Error("A valid contract date is required.");
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function numberValue(value: unknown): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value);
}

function optionalEpoch(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;

  const result = toEpoch(value);
  return result || undefined;
}

function normalizeStatus(value: unknown): Contract["status"] {
  const status = String(value ?? "").toUpperCase();

  if (status === "ACTIVE") return "IN_PROGRESS";
  if (status === "COMPLETED") return "READY_FOR_COMPLETION";

  if (
    status === "DRAFT" ||
    status === "IN_PROGRESS" ||
    status === "READY_FOR_COMPLETION" ||
    status === "CONVERTED" ||
    status === "CANCELLED"
  ) {
    return status;
  }

  return "DRAFT";
}

function mapAttachment(row: ApiRecord): Contract["attachments"][number] {
  return {
    id: stringValue(row.id),
    fileName: stringValue(row.fileName ?? row.file_name),
    fileUrl: stringValue(row.fileUrl ?? row.file_url),
    mimeType: stringValue(row.mimeType ?? row.mime_type),
    fileSize: numberValue(row.fileSize ?? row.file_size),
  };
}

function mapStatusHistory(rows: unknown): Contract["statusHistory"] {
  if (!Array.isArray(rows)) return [];

  return rows.map((row: ApiRecord) => ({
    status: normalizeStatus(row.status),
    at: toEpoch(row.at ?? row.createdAt ?? row.created_at),
    by:
      row.by ??
      row.changedByName ??
      row.changed_by_name ??
      undefined,
    note: row.note ?? undefined,
  }));
}

function mapPayment(row: ApiRecord | null | undefined): Contract["payment"] {
  if (!row) return undefined;

  const evidence = row.paymentEvidence ?? row.payment_evidence;

  return {
    bank: stringValue(row.bank ?? row.paymentBank ?? row.payment_bank),
    paymentSender: stringValue(
      row.paymentSender ?? row.payment_sender,
    ),
    paymentAmount: numberValue(
      row.paymentAmount ?? row.payment_amount,
    ),
    paymentDate: optionalEpoch(
      row.paymentDate ?? row.payment_date,
    ),
    paymentReferenceNumber: stringValue(
      row.paymentReferenceNumber ?? row.payment_reference_number,
    ),
    paymentEvidence: evidence ? mapAttachment(evidence) : undefined,
    remark:
      row.remark ??
      row.paymentRemark ??
      row.payment_remark ??
      undefined,
    recordedBy:
      row.recordedBy ??
      row.paymentRecordedByName ??
      row.payment_recorded_by_name ??
      undefined,
    recordedAt: optionalEpoch(
      row.recordedAt ?? row.payment_recorded_at,
    ),
    updatedAt: optionalEpoch(
      row.updatedAt ?? row.payment_updated_at,
    ),
  };
}

function mapWithholding(
  row: ApiRecord | null | undefined,
): Contract["withholding"] {
  if (!row) return undefined;

  const evidence =
    row.evidence ??
    row.withholdingEvidence ??
    row.withholding_evidence;

  return {
    enabled: Boolean(
      row.enabled ??
      row.withholdingEnabled ??
      row.withholding_enabled,
    ),
    rate: numberValue(
      row.rate ??
      row.withholdingRate ??
      row.withholding_rate,
    ),
    evidence: evidence ? mapAttachment(evidence) : undefined,
    recordedBy:
      row.recordedBy ??
      row.withholdingRecordedByName ??
      row.withholding_recorded_by_name ??
      undefined,
    recordedAt: optionalEpoch(
      row.recordedAt ?? row.withholding_recorded_at,
    ),
    updatedAt: optionalEpoch(
      row.updatedAt ?? row.withholding_updated_at,
    ),
  };
}

export function mapContract(row: ApiRecord): Contract {
  const customer = row.customer ?? {};

  const attachments =
    row.attachments ??
    row.contractAttachments ??
    row.contract_attachments ??
    [];

  const financialInformation =
    row.financialInformation ??
    row.financial_information;

  return {
    id: stringValue(row.id),
    contractNumber: stringValue(
      row.contractNumber ?? row.contract_number,
    ),
    customer: {
      name: stringValue(
        customer.name ??
        row.customerName ??
        row.customer_name ??
        row.customer_name_snapshot,
      ),
      tin: stringValue(
        customer.tin ??
        row.customerTin ??
        row.customer_tin ??
        row.customer_tin_snapshot,
      ),
    },
    contractValue: numberValue(
      row.contractValue ?? row.contract_value,
    ),
    fsNo: stringValue(row.fsNo ?? row.fs_no),
    contractDate: toEpoch(
      row.contractDate ?? row.contract_date,
    ),
    attachments: Array.isArray(attachments)
      ? attachments.map(mapAttachment)
      : [],
    remark: row.remark ?? undefined,
    status: normalizeStatus(row.status),
    createdBy:
      row.createdBy ??
      row.created_by_name ??
      row.created_by ??
      undefined,
    createdAt: toEpoch(row.createdAt ?? row.created_at),
    updatedAt: toEpoch(row.updatedAt ?? row.updated_at),
    activatedAt: optionalEpoch(
      row.activatedAt ?? row.activated_at,
    ),
    activatedBy:
      row.activatedBy ??
      row.activated_by_name ??
      row.activated_by ??
      undefined,
    readyAt: optionalEpoch(row.readyAt ?? row.ready_at),
    completionConfirmedAt: optionalEpoch(
      row.completionConfirmedAt ??
      row.completion_confirmed_at,
    ),
    completionConfirmedBy:
      row.completionConfirmedBy ??
      row.completion_confirmed_by_name ??
      row.completion_confirmed_by ??
      undefined,
    completionReason:
      row.completionReason ??
      row.completion_reason ??
      undefined,
    closedBelowValue: Boolean(
      row.closedBelowValue ?? row.closed_below_value,
    ),
    payment: mapPayment(
      row.payment ?? financialInformation,
    ),
    withholding: mapWithholding(
      row.withholding ?? financialInformation,
    ),
    paymentHistory: Array.isArray(
      row.paymentHistory ?? row.payment_history,
    )
      ? (row.paymentHistory ?? row.payment_history).map(
          (item: ApiRecord) => ({
            action: item.action,
            at: toEpoch(
              item.at ?? item.createdAt ?? item.created_at,
            ),
            by:
              item.by ??
              item.changedByName ??
              item.changed_by_name ??
              item.changed_by ??
              "",
            note: item.note ?? undefined,
          }),
        )
      : [],
    cancelledAt: optionalEpoch(
      row.cancelledAt ?? row.cancelled_at,
    ),
    cancelledBy:
      row.cancelledBy ??
      row.cancelled_by_name ??
      row.cancelled_by ??
      undefined,
    cancellationReason:
      row.cancellationReason ??
      row.cancellation_reason ??
      undefined,
    salesInvoiceId:
      row.salesInvoiceId ??
      row.sales_invoice_id ??
      undefined,
    salesInvoiceNumber:
      row.salesInvoiceNumber ??
      row.sales_invoice_number ??
      undefined,
    convertedAt: optionalEpoch(
      row.convertedAt ?? row.converted_at,
    ),
    convertedBy:
      row.convertedBy ??
      row.converted_by_name ??
      row.converted_by ??
      undefined,
    conversionStartedAt: optionalEpoch(
      row.conversionStartedAt ??
      row.conversion_started_at,
    ),
    conversionError:
      row.conversionError ??
      row.conversion_error ??
      undefined,
    statusHistory: mapStatusHistory(
      row.statusHistory ?? row.status_history,
    ),
  };
}

export function mapContractOrder(row: ApiRecord): ContractOrder {
  const quantity = numberValue(row.quantity);
  const unitPrice = numberValue(
    row.unitPrice ?? row.unit_price,
  );

  const excl = numberValue(
    row.lineTotalExclVat ??
    row.line_total_excl_vat ??
    quantity * unitPrice,
  );

  const createdAt = toEpoch(
    row.createdAt ?? row.created_at,
  );

  return {
    id: stringValue(row.id),
    contractId: stringValue(
      row.contractId ?? row.contract_id,
    ),
    orderNumber: numberValue(
      row.orderNumber ?? row.order_number,
    ),

    // Preserve the aggregate code as a string, including values like "00".
    aggregate: stringValue(row.aggregate) as ContractOrder["aggregate"],

    quantity,
    unit: stringValue(row.unit ?? "m³"),
    unitPrice,
    lineTotalExclVat: excl,
    lineTotalInclVat: numberValue(
      row.lineTotalInclVat ??
      row.line_total_incl_vat ??
      excl * 1.15,
    ),
    royaltyInvoiceNumber: stringValue(
      row.royaltyInvoiceNumber ??
      row.royalty_invoice_number,
    ),
    orderDate: toEpoch(
      row.orderDate ?? row.order_date,
    ),
    status:
      String(row.status ?? "COMPLETED").toUpperCase() === "CANCELLED"
        ? "CANCELLED"
        : "COMPLETED",
    completedByUserId:
      row.completedByUserId ??
      row.completed_by ??
      undefined,
    completedByName:
      row.completedByName ??
      row.completed_by_name ??
      undefined,
    completedByEmail:
      row.completedByEmail ??
      row.completed_by_email ??
      undefined,

    // The frontend type requires a number. Use creation time if the
    // backend has no completion timestamp for this record.
    completedAt:
      optionalEpoch(row.completedAt ?? row.completed_at) ?? createdAt,

    createdByUserId:
      row.createdByUserId ??
      row.created_by ??
      undefined,
    createdByName:
      row.createdByName ??
      row.created_by_name ??
      undefined,
    createdAt,
    updatedAt: toEpoch(
      row.updatedAt ?? row.updated_at,
    ),
    lastEditedByUserId:
      row.lastEditedByUserId ??
      row.last_edited_by ??
      undefined,
    lastEditedByName:
      row.lastEditedByName ??
      row.last_edited_by_name ??
      undefined,
    lastEditedByEmail:
      row.lastEditedByEmail ??
      row.last_edited_by_email ??
      undefined,
    editedAt: optionalEpoch(
      row.editedAt ?? row.edited_at,
    ),
    cancelledAt: optionalEpoch(
      row.cancelledAt ?? row.cancelled_at,
    ),
    cancelledBy:
      row.cancelledBy ??
      row.cancelled_by_name ??
      row.cancelled_by ??
      undefined,
    cancelReason:
      row.cancelReason ??
      row.cancellationReason ??
      row.cancellation_reason ??
      undefined,
    royaltySourceKey: stringValue(
      row.royaltySourceKey ??
      `contract-order:${row.id}`,
    ),
  };
}

function extractData<T>(payload: any): T {
  if (payload && payload.success === false) {
    throw new Error(
      payload.message || "The server rejected the request.",
    );
  }

  return (payload?.data ?? payload) as T;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = authRepository.getSession()?.token;
  const headers = new Headers(options.headers ?? {});

  headers.set("Accept", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const isFormData =
    typeof FormData !== "undefined" &&
    options.body instanceof FormData;

  if (
    options.body != null &&
    !isFormData &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(`${ROOT}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      "Unable to connect to the NexERP backend. Check that the backend server is running.",
    );
  }

  const raw = await response.text();
  let payload: any = null;

  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(
        "The server returned an invalid response.",
      );
    }
  }

  if (!response.ok) {
    const validationErrors = payload?.errors
      ? Object.values(payload.errors).flat().join(" ")
      : "";

    throw new Error(
      payload?.message ||
      payload?.title ||
      validationErrors ||
      `Request failed (${response.status}).`,
    );
  }

  if (response.status === 204 || !raw) {
    return undefined as T;
  }

  return extractData<T>(payload);
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

function mapContractList(value: unknown): Contract[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "The contracts endpoint returned an invalid list.",
    );
  }

  return value.map(mapContract);
}

function mapOrderList(value: unknown): ContractOrder[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "The contract orders endpoint returned an invalid list.",
    );
  }

  return value.map(mapContractOrder);
}

/* ------------------------------------------------------------------ */
/* Contract endpoints                                                  */
/* ------------------------------------------------------------------ */

export const contractsApi = {
  async getContracts(): Promise<Contract[]> {
    const result = await request<unknown>("/");
    return mapContractList(result);
  },

  async getContract(id: string): Promise<Contract> {
    const result = await request<ApiRecord>(
      `/${encodeURIComponent(id)}`,
    );

    return mapContract(result);
  },

  async createContract(input: ContractInput): Promise<Contract> {
    const result = await request<ApiRecord>("/", {
      method: "POST",
      body: jsonBody({
        customerName: input.customerName,
        customerTin: input.tin,
        contractValue: input.contractValue,
        fsNo: input.fsNo,
        contractDate: toDateString(input.contractDate),
        remark: input.remark,
      }),
    });

    return mapContract(result);
  },

  async updateContract(
    id: string,
    input: ContractInput,
  ): Promise<Contract> {
    const result = await request<ApiRecord>(
      `/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: jsonBody({
          customerName: input.customerName,
          customerTin: input.tin,
          contractValue: input.contractValue,
          fsNo: input.fsNo,
          contractDate: toDateString(input.contractDate),
          remark: input.remark,
        }),
      },
    );

    return mapContract(result);
  },

  async activateContract(id: string): Promise<Contract> {
    const result = await request<ApiRecord>(
      `/${encodeURIComponent(id)}/activate`,
      {
        method: "POST",
        body: jsonBody({}),
      },
    );

    return mapContract(result);
  },

  async requestCompletion(id: string): Promise<Contract> {
    const result = await request<ApiRecord>(
      `/${encodeURIComponent(id)}/request-completion`,
      {
        method: "POST",
        body: jsonBody({}),
      },
    );

    return mapContract(result);
  },

  async confirmCompletion(
    id: string,
    reason?: string,
  ): Promise<Contract> {
    const result = await request<ApiRecord>(
      `/${encodeURIComponent(id)}/confirm-completion`,
      {
        method: "POST",
        body: jsonBody({
          reason: reason?.trim() || null,
        }),
      },
    );

    return mapContract(result);
  },

  async cancelContract(
    id: string,
    reason: string,
  ): Promise<Contract> {
    const result = await request<ApiRecord>(
      `/${encodeURIComponent(id)}/cancel`,
      {
        method: "POST",
        body: jsonBody({ reason }),
      },
    );

    return mapContract(result);
  },

  /* ---------------------------------------------------------------- */
  /* Order endpoints                                                   */
  /* ---------------------------------------------------------------- */

  async getAllOrders(): Promise<ContractOrder[]> {
    const result = await request<unknown>("/all-orders");
    return mapOrderList(result);
  },

  async getOrders(contractId: string): Promise<ContractOrder[]> {
    const result = await request<unknown>(
      `/${encodeURIComponent(contractId)}/orders`,
    );

    return mapOrderList(result);
  },

  async createOrder(
    contractId: string,
    input: ContractOrderInput,
  ): Promise<ContractOrder> {
    const result = await request<ApiRecord>(
      `/${encodeURIComponent(contractId)}/orders`,
      {
        method: "POST",
        body: jsonBody({
          aggregate: input.aggregate,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          royaltyInvoiceNumber: input.royaltyInvoiceNumber,
          orderDate: toDateString(input.orderDate),
        }),
      },
    );

    return mapContractOrder(result);
  },

  async updateOrder(
    orderId: string,
    input: ContractOrderInput,
  ): Promise<ContractOrder> {
    const result = await request<ApiRecord>(
      `/orders/${encodeURIComponent(orderId)}`,
      {
        method: "PUT",
        body: jsonBody({
          aggregate: input.aggregate,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          royaltyInvoiceNumber: input.royaltyInvoiceNumber,
          orderDate: toDateString(input.orderDate),
        }),
      },
    );

    return mapContractOrder(result);
  },

  async cancelOrder(
    orderId: string,
    reason: string,
  ): Promise<ContractOrder> {
    const result = await request<ApiRecord>(
      `/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        method: "POST",
        body: jsonBody({ reason }),
      },
    );

    return mapContractOrder(result);
  },

  /* ---------------------------------------------------------------- */
  /* Progress and financial information                               */
  /* ---------------------------------------------------------------- */

  async getProgress(
    contractId: string,
  ): Promise<ContractProgress> {
    return request<ContractProgress>(
      `/${encodeURIComponent(contractId)}/progress`,
    );
  },

  async getFinancialReport(
    contractId: string,
  ): Promise<ContractFinancialReport> {
    return request<ContractFinancialReport>(
      `/${encodeURIComponent(contractId)}/financial-report`,
    );
  },

  async saveFinancialInformation(
    contractId: string,
    input: ContractFinancialInput,
  ): Promise<Contract> {
    const payment =
      input.payment === null
        ? null
        : input.payment
          ? {
              bank: input.payment.bank,
              paymentSender: input.payment.paymentSender,
              paymentAmount: input.payment.paymentAmount,
              paymentDate:
                input.payment.paymentDate == null
                  ? null
                  : toDateString(input.payment.paymentDate),
              paymentReferenceNumber:
                input.payment.paymentReferenceNumber,
              paymentEvidenceId:
                input.payment.paymentEvidence?.id ?? null,
              remark: input.payment.remark ?? null,
            }
          : undefined;

    const result = await request<ApiRecord>(
      `/${encodeURIComponent(contractId)}/financial-information`,
      {
        method: "PUT",
        body: jsonBody({
          payment,
          withholding: {
  enabled: input.withholding.enabled,
  rate: input.withholding.enabled ? 0.03 : 0,
  evidence: input.withholding.evidence
    ? {
        id: input.withholding.evidence.id,
      }
    : null,
},
        }),
      },
    );

    return mapContract(result);
  },

  /* ---------------------------------------------------------------- */
  /* Attachments                                                       */
  /* ---------------------------------------------------------------- */

  async uploadAttachment(
    contractId: string,
    file: File,
    attachmentType: "CONTRACT" | "PAYMENT" | "WITHHOLDING",
  ): Promise<Contract["attachments"][number]> {
    const body = new FormData();

    body.append("file", file);
    body.append("attachmentType", attachmentType);

    const result = await request<ApiRecord>(
      `/${encodeURIComponent(contractId)}/attachments`,
      {
        method: "POST",
        body,
      },
    );

    return mapAttachment(result);
  },

  async deleteAttachment(
    contractId: string,
    attachmentId: string,
  ): Promise<void> {
    await request<void>(
      `/${encodeURIComponent(contractId)}/attachments/${encodeURIComponent(attachmentId)}`,
      {
        method: "DELETE",
      },
    );
  },

  /* ---------------------------------------------------------------- */
  /* Conversion handoff                                                */
  /* ---------------------------------------------------------------- */

  async startConversion(contractId: string): Promise<void> {
    await request<void>(
      `/${encodeURIComponent(contractId)}/conversion/start`,
      {
        method: "POST",
        body: jsonBody({}),
      },
    );
  },

  async markConverted(
    contractId: string,
    salesInvoiceId: string,
  ): Promise<Contract> {
    const result = await request<ApiRecord>(
      `/${encodeURIComponent(contractId)}/conversion/complete`,
      {
        method: "POST",
        body: jsonBody({ salesInvoiceId }),
      },
    );

    return mapContract(result);
  },

  async markConversionFailed(
    contractId: string,
    message: string,
  ): Promise<void> {
    await request<void>(
      `/${encodeURIComponent(contractId)}/conversion/failed`,
      {
        method: "POST",
        body: jsonBody({ message }),
      },
    );
  },
};
