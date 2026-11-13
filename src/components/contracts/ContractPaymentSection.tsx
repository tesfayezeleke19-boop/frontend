
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  Link2,
  Paperclip,
  Pencil,
  ReceiptText,
} from "lucide-react";
import { formatCurrency } from "@/services/sales/format";
import {
  CONTRACT_PAYMENT_STATUS_UI,
  CONTRACT_WITHHOLDING_STATUS_LABELS,
  type ContractFinancialReport,
} from "@/services/contracts/financials";

interface Props {
  report: ContractFinancialReport;
  canManage: boolean;
  onEdit: () => void;
  title?: string;
}

function formatEthiopianDate(
  value?: number | string | null,
  includeTime = false,
): string {
  if (value === undefined || value === null || value === "") {
    return "—";
  }

  const date =
    typeof value === "number"
      ? new Date(value)
      : /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T12:00:00`)
        : new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-ET-u-ca-ethiopic-nu-latn", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    ...(includeTime
      ? { hour: "2-digit", minute: "2-digit" }
      : {}),
  }).format(date);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
        {label}
      </div>

      <div className="mt-1 text-sm text-foreground">
        {children}
      </div>
    </div>
  );
}

export function ContractPaymentSection({
  report,
  canManage,
  onEdit,
  title,
}: Props) {
  const payment = report.payment;
  const withholding = report.withholding;

  // Resolve the payment status defensively. API responses may contain
  // an unknown or missing status while older records are being migrated.
  const paymentStatusConfig =
    CONTRACT_PAYMENT_STATUS_UI?.[report.paymentStatus];

  const paymentStatusLabel =
    paymentStatusConfig?.label ?? "Not confirmed";

  const paymentStatusClassName =
    paymentStatusConfig?.className ?? "erp-badge-draft";

  const withholdingStatus =
    CONTRACT_WITHHOLDING_STATUS_LABELS?.[report.withholdingStatus] ??
    (report.withholdingEnabled ? "Applied" : "Not applied");

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="flex flex-row items-start justify-between pb-3">
        <div>
          <CardTitle className="text-sm font-medium text-foreground">
            Payment Information
          </CardTitle>

          <p className="mt-1 text-xs text-muted-foreground/70">
            {title ? `${title} · ` : ""}
            Payment information is optional and never confirms a payment by
            itself.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge
            variant="outline"
            className={`border text-[10px] font-medium ${paymentStatusClassName}`}
          >
            {paymentStatusLabel}
          </Badge>

          <Badge
            variant="outline"
            className={`border text-[10px] font-medium ${
              report.withholdingEnabled
                ? "erp-badge-approved"
                : "erp-badge-draft"
            }`}
          >
            {withholdingStatus}
          </Badge>

          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              className="h-7 gap-1.5 border-input text-xs text-foreground hover:bg-accent"
            >
              <Pencil className="size-3" />
              {payment ? "Update" : "Record"}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {report.invoiceError && (
          <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-soft p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />

            <span>
              The Sales Invoice for this contract could not be read, so
              confirmed payment and withholding figures are unavailable right
              now. {report.invoiceError}
            </span>
          </div>
        )}

        {payment ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Bank">
              {payment.bank || "—"}
            </Field>

            <Field label="Payment Sent By">
              {payment.paymentSender || "—"}
            </Field>

            <Field label="Reference Number">
              <span className="font-mono text-xs">
                {payment.paymentReferenceNumber || "—"}
              </span>
            </Field>

            <Field label="Reported Amount">
              <span className="tabular-nums">
                {formatCurrency(payment.paymentAmount)}
              </span>

              <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                not confirmed
              </span>
            </Field>

            <Field label="Payment Date">
              {payment.paymentDate
                ? formatEthiopianDate(payment.paymentDate)
                : "—"}
            </Field>

            <Field label="Recorded By">
              <span className="text-xs">
                {payment.recordedBy ?? "—"}

                {payment.recordedAt ? (
                  <span className="block font-mono text-[10px] text-muted-foreground/70">
                    {formatEthiopianDate(payment.recordedAt, true)}
                  </span>
                ) : null}
              </span>
            </Field>

            {payment.remark && (
              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Remark">
                  <span className="text-xs text-muted-foreground">
                    {payment.remark}
                  </span>
                </Field>
              </div>
            )}

            <div className="sm:col-span-2 lg:col-span-3">
              <div className="flex items-center gap-2 text-xs">
                <Paperclip className="size-3.5 text-muted-foreground" />

                {payment.paymentEvidence ? (
                  <>
                    <span className="truncate font-medium text-foreground">
                      {payment.paymentEvidence.fileName}
                    </span>

                    {payment.paymentEvidence.fileUrl && (
                      <a
                        href={payment.paymentEvidence.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-info hover:underline"
                      >
                        <Link2 className="size-3" />
                        open
                      </a>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    No payment evidence attached.
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-sidebar p-3.5 text-xs text-muted-foreground">
            <ReceiptText className="mt-0.5 size-4 shrink-0 text-muted-foreground/70" />

            <p className="leading-relaxed">
              No payment information recorded.{" "}
              {canManage
                ? "Finance can record payment details at any time — including after the contract is completed — without changing the contract lifecycle."
                : "Finance records payment details; Sales users see this summary only."}
            </p>
          </div>
        )}

        <Separator className="bg-muted" />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Gross Amount Due">
            <span className="tabular-nums">
              {formatCurrency(report.grossAmountDue)}
            </span>

            <span className="block font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {report.grossAmountDueBasis === "INVOICE"
                ? "VAT-inclusive · invoice"
                : "VAT-inclusive · completed orders"}
            </span>
          </Field>

          <Field
            label={`Withholding${
              report.withholdingEnabled
                ? ` (${Math.round(report.withholdingRate * 100)}%)`
                : ""
            }`}
          >
            <span className="tabular-nums">
              {report.withholdingEnabled
                ? formatCurrency(report.withholdingAmount)
                : "Not applied"}
            </span>
          </Field>

          <Field label="Confirmed Amount Paid">
            <span className="tabular-nums">
              {formatCurrency(report.amountPaid)}
            </span>
          </Field>

          <Field label="Outstanding Balance">
            <span className="tabular-nums">
              {formatCurrency(report.outstandingBalance)}
            </span>
          </Field>
        </div>

        {report.withholdingEnabled && (
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            Withholding is deducted from the gross amount due to reach the net
            amount. It is not a payment and it does not count toward contract
            fulfillment.
            {withholding?.evidence
              ? ` Evidence: ${withholding.evidence.fileName}.`
              : " No withholding evidence attached."}
          </p>
        )}

        {report.paymentStatus === "RECORDED_NOT_CONFIRMED" && (
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            Payment details are recorded for reference only. The outstanding
            balance stays payable until the resulting Sales Invoice payment is
            confirmed by Finance.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
