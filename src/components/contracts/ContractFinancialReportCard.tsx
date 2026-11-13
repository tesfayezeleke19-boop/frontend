
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  Link2,
  Paperclip,
  Printer,
} from "lucide-react";
import { formatCurrency } from "@/services/sales/format";
import {
  getContractPaymentStatusUI,
  getContractWithholdingStatusLabel,
  type ContractFinancialReport,
} from "@/services/contracts/financials";

interface Props {
  report: ContractFinancialReport;
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

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "en-ET-u-ca-ethiopic-nu-latn",
    {
      day: "2-digit",
      month: "long",
      year: "numeric",
      ...(includeTime
        ? { hour: "2-digit", minute: "2-digit" }
        : {}),
    },
  ).format(date);
}

function Missing() {
  return (
    <span className="text-muted-foreground/70">
      Not recorded
    </span>
  );
}

function Row({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-xs text-muted-foreground">
        {label}
      </span>

      <span
        className={`text-right text-sm font-medium text-foreground ${
          mono ? "font-mono text-xs" : "tabular-nums"
        }`}
      >
        {children}
      </span>
    </div>
  );
}

export function ContractFinancialReportCard({
  report,
}: Props) {
  // Safe lookups prevent unknown backend statuses from crashing the card.
  const paymentStatus = getContractPaymentStatusUI(
    report?.paymentStatus,
  );

  const withholdingStatus = getContractWithholdingStatusLabel(
    report?.withholdingStatus,
  );

  const payment = report?.payment;
  const withholding = report?.withholding;

  const fulfillmentPercent = Number.isFinite(
    report?.fulfillmentPercent,
  )
    ? report.fulfillmentPercent
    : 0;

  const rawFulfillmentPercent = Number.isFinite(
    report?.rawFulfillmentPercent,
  )
    ? report.rawFulfillmentPercent
    : fulfillmentPercent;

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileText className="size-4 text-muted-foreground" />
            Completed Contract Financial Report
          </CardTitle>

          <p className="mt-1 text-xs text-muted-foreground/70">
            {report.contractNumber || "—"} · figures are read-only and reflect the
            recorded financial position.
          </p>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <Badge
            variant="outline"
            className={`border text-[10px] font-medium ${paymentStatus.className}`}
          >
            {paymentStatus.label}
          </Badge>

          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="h-7 gap-1.5 border-input text-xs text-foreground hover:bg-accent"
          >
            <Printer className="size-3" />
            Print
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              Contract
            </div>

            <div className="mt-1">
              <Row label="Customer / Company">
                {report.customerName || "—"}
              </Row>

              <Row label="Customer TIN" mono>
                {report.customerTin || "—"}
              </Row>

              <Row label="Contract Reference" mono>
                {report.contractNumber || "—"}
              </Row>

              <Row label="Contract Date">
                {formatEthiopianDate(report.contractDate)}
              </Row>

              <Row label="Completed / Finalized">
                {report.completionDate ? (
                  formatEthiopianDate(report.completionDate)
                ) : (
                  <Missing />
                )}
              </Row>

              <Row label="FS No" mono>
                {report.fsNo || <Missing />}
              </Row>

              {report.invoice && (
                <Row label="Sales Invoice" mono>
                  {report.invoice.invoiceNumber || "—"}

                  <span className="ml-2 font-sans text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    {String(report.invoice.status || "unknown")
                      .replace(/_/g, " ")
                      .toLowerCase()}
                  </span>
                </Row>
              )}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              Fulfillment
            </div>

            <div className="mt-1">
              <Row label="Contract Value">
                {formatCurrency(report.contractValue ?? 0)}
              </Row>

              <Row label="Fulfilled Value">
                {formatCurrency(report.fulfilledValue ?? 0)}
              </Row>

              <Row label="Remaining Contract Value">
                {formatCurrency(report.remainingContractValue ?? 0)}
              </Row>

              <Row label="Fulfillment">
                {fulfillmentPercent.toFixed(1)}%

                {rawFulfillmentPercent > 100 && (
                  <span className="ml-2 font-sans text-[10px] font-normal uppercase tracking-wide text-warning">
                    over-fulfilled
                  </span>
                )}
              </Row>

              <Row label="VAT (15%)">
                {formatCurrency(report.totalVat ?? 0)}
              </Row>

              <Row label="Gross Amount Due">
                {formatCurrency(report.grossAmountDue ?? 0)}
              </Row>
            </div>
          </div>
        </div>

        <Separator className="bg-muted" />

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              Payment
            </div>

            <div className="mt-1">
              <Row label="Payment Status">
                {paymentStatus.label}
              </Row>

              <Row label="Confirmed Amount Paid">
                {formatCurrency(report.amountPaid ?? 0)}
              </Row>

              <Row label="Outstanding Balance">
                {formatCurrency(report.outstandingBalance ?? 0)}
              </Row>

              <Row label="Bank">
                {payment?.bank || <Missing />}
              </Row>

              <Row label="Payment Sent By">
                {payment?.paymentSender || <Missing />}
              </Row>

              <Row label="Reference Number" mono>
                {payment?.paymentReferenceNumber || <Missing />}
              </Row>

              <Row label="Payment Date">
                {payment?.paymentDate ? (
                  formatEthiopianDate(payment.paymentDate)
                ) : (
                  <Missing />
                )}
              </Row>

              <Row label="Payment Confirmed">
                {report.paymentConfirmedAt ? (
                  formatEthiopianDate(
                    report.paymentConfirmedAt,
                    true,
                  )
                ) : (
                  <Missing />
                )}
              </Row>
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              Withholding
            </div>

            <div className="mt-1">
              <Row label="Withholding Status">
                {withholdingStatus}
              </Row>

              <Row label="Withholding Rate">
                {report.withholdingEnabled
                  ? `${Math.round((report.withholdingRate ?? 0) * 100)}%`
                  : "Not applied"}
              </Row>

              <Row label="Withholding Amount">
                {report.withholdingEnabled
                  ? formatCurrency(report.withholdingAmount ?? 0)
                  : formatCurrency(0)}
              </Row>

              <Row label="Net Amount">
                {formatCurrency(report.netAmount ?? 0)}
              </Row>

              <Row label="Withholding Recorded By">
                {withholding?.recordedBy || <Missing />}
              </Row>

              <Row label="Withholding Evidence">
                {withholding?.evidence ? (
                  withholding.evidence.fileUrl ? (
                    <a
                      href={withholding.evidence.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-sans text-xs font-normal text-info hover:underline"
                    >
                      <Link2 className="size-3" />
                      {withholding.evidence.fileName || "View evidence"}
                    </a>
                  ) : (
                    withholding.evidence.fileName || "Evidence attached"
                  )
                ) : (
                  <Missing />
                )}
              </Row>

              <Row label="Payment Evidence">
                {payment?.paymentEvidence ? (
                  payment.paymentEvidence.fileUrl ? (
                    <a
                      href={payment.paymentEvidence.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-sans text-xs font-normal text-info hover:underline"
                    >
                      <Paperclip className="size-3" />
                      {payment.paymentEvidence.fileName || "View evidence"}
                    </a>
                  ) : (
                    payment.paymentEvidence.fileName || "Evidence attached"
                  )
                ) : (
                  <Missing />
                )}
              </Row>
            </div>
          </div>
        </div>

        {(report.closingReason ||
          payment?.remark ||
          report.remark) && (
          <>
            <Separator className="bg-muted" />

            <div className="space-y-2 text-xs text-muted-foreground">
              {report.closingReason && (
                <p>
                  <span className="font-medium text-foreground">
                    Completion note:
                  </span>{" "}
                  {report.closingReason}
                </p>
              )}

              {payment?.remark && (
                <p>
                  <span className="font-medium text-foreground">
                    Payment remark:
                  </span>{" "}
                  {payment.remark}
                </p>
              )}

              {report.remark && (
                <p>
                  <span className="font-medium text-foreground">
                    Contract remark:
                  </span>{" "}
                  {report.remark}
                </p>
              )}
            </div>
          </>
        )}

        {report.invoiceError && (
          <p className="text-[11px] text-warning">
            Confirmed payment information is unavailable:{" "}
            {report.invoiceError}
          </p>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground/70">
          {report.grossAmountDueBasis === "INVOICE"
            ? "Gross amount due, VAT and withholding are taken from the resulting Sales Invoice."
            : "No Sales Invoice exists yet: gross amount due and withholding are derived from the completed orders using the Sales Invoice calculation."}{" "}
          Withholding reduces the net amount only; it is never counted as a
          payment or as fulfilled value.
        </p>
      </CardContent>
    </Card>
  );
}
