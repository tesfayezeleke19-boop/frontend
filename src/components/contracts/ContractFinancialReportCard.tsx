
/**
 * Completed-contract financial report, shared by BOTH contract workflows.
 *
 * It stays available after completion/finalization and answers, in order:
 * what the contract was worth, how much work was fulfilled, what has been
 * confirmed as paid, how much withholding applies, the net amount, and the
 * balance still outstanding — with explicit "not recorded" states instead of
 * invented zeros.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FileText, Paperclip, Printer } from "lucide-react";
import { formatCurrency, formatDate } from "@/services/sales/format";
import type { FileEvidence } from "@/services/sales/invoice";
import { AttachmentViewer } from "./AttachmentViewer";
import {
  CONTRACT_PAYMENT_STATUS_UI,
  CONTRACT_WITHHOLDING_STATUS_LABELS,
  type ContractFinancialReport,
} from "@/services/contracts/financials";

interface Props {
  report: ContractFinancialReport;
  /**
   * Standard contracts compare fulfilled value with the contract value.
   * Credit contracts have NO initial value, so their report hides this block
   * instead of showing a misleading 0% / 100% fulfillment.
   */
  showFulfillment?: boolean;
}

function Missing() {
  return <span className="text-muted-foreground/70">Not recorded</span>;
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
      <span className="text-xs text-muted-foreground">{label}</span>
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
  showFulfillment = true,
}: Props) {
  const paymentStatus =
    CONTRACT_PAYMENT_STATUS_UI[report.paymentStatus] ?? {
      label: report.paymentStatus
        ? String(report.paymentStatus).replace(/_/g, " ").toLowerCase()
        : "Unknown",
      className: "border-border bg-muted text-muted-foreground",
    };

  const payment = report.payment;
  const withholding = report.withholding;

  const [viewingEvidence, setViewingEvidence] = useState<FileEvidence | null>(
    null,
  );

  return (
    <>
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
              <FileText className="size-4 text-muted-foreground" />
              Completed Contract Financial Report
            </CardTitle>
           
          </div>

        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Contract identity */}
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
                  {report.contractNumber}
                </Row>

                <Row label="Contract Date">
                  {formatDate(report.contractDate)}
                </Row>

                <Row label="Completed / Finalized">
                  {report.completionDate ? (
                    formatDate(report.completionDate)
                  ) : (
                    <Missing />
                  )}
                </Row>

                <Row label="FS No" mono>
                  {report.fsNo || <Missing />}
                </Row>

                {report.invoice && (
                  <Row label="Sales Invoice" mono>
                    {report.invoice.invoiceNumber}
                    <span className="ml-2 font-sans text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {report.invoice.status.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </Row>
                )}
              </div>
            </div>

            {showFulfillment && (
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  Fulfillment
                </div>

                <div className="mt-1">
                  <Row label="Contract Value">
                    {formatCurrency(report.contractValue)}
                  </Row>

                  <Row label="Fulfilled Value">
                    {formatCurrency(report.fulfilledValue)}
                  </Row>

                  <Row label="Remaining Contract Value">
                    {formatCurrency(report.remainingContractValue)}
                  </Row>

                  <Row label="Fulfillment">
  {typeof report.fulfillmentPercent === "number" &&
  Number.isFinite(report.fulfillmentPercent) ? (
    <>
      {report.fulfillmentPercent.toFixed(1)}%
      {typeof report.rawFulfillmentPercent === "number" &&
        report.rawFulfillmentPercent > 100 && (
          <span className="ml-2 font-sans text-[10px] font-normal uppercase tracking-wide text-warning">
            over-fulfilled
          </span>
        )}
    </>
  ) : (
    <Missing />
  )}
</Row>

                  <Row label="VAT (15%)">
                    {formatCurrency(report.totalVat)}
                  </Row>

                  <Row label="Gross Amount Due">
                    {formatCurrency(report.grossAmountDue)}
                  </Row>
                </div>
              </div>
            )}
          </div>

          <Separator className="bg-muted" />

          {/* Payment + withholding position */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                Payment
              </div>

              <div className="mt-1">
                <Row label="Payment Status">{paymentStatus.label}</Row>

                <Row label="Confirmed Amount Paid">
                  {formatCurrency(report.amountPaid)}
                </Row>

                <Row label="Outstanding Balance">
                  {formatCurrency(report.outstandingBalance)}
                </Row>

                <Row label="Bank">
                  {payment?.bank ? payment.bank : <Missing />}
                </Row>

                <Row label="Payment Sent By">
                  {payment?.paymentSender ? payment.paymentSender : <Missing />}
                </Row>

                <Row label="Reference Number" mono>
                  {payment?.paymentReferenceNumber ? (
                    payment.paymentReferenceNumber
                  ) : (
                    <Missing />
                  )}
                </Row>

                <Row label="Payment Date">
                  {payment?.paymentDate ? (
                    formatDate(payment.paymentDate)
                  ) : (
                    <Missing />
                  )}
                </Row>

                <Row label="Payment Confirmed">
                  {report.paymentConfirmedAt ? (
                    formatDate(report.paymentConfirmedAt, { time: true })
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
                  {CONTRACT_WITHHOLDING_STATUS_LABELS[
                    report.withholdingStatus
                  ] ?? "Unknown"}
                </Row>

                <Row label="Withholding Rate">
                  {report.withholdingEnabled
                    ? `${Math.round(report.withholdingRate * 100)}%`
                    : "Not applied"}
                </Row>

                <Row label="Withholding Amount">
                  {report.withholdingEnabled
                    ? formatCurrency(report.withholdingAmount)
                    : formatCurrency(0)}
                </Row>

                <Row label="Net Amount">
                  {formatCurrency(report.netAmount)}
                </Row>

                <Row label="Withholding Recorded By">
                  {withholding?.recordedBy ? withholding.recordedBy : <Missing />}
                </Row>

                <Row label="Withholding Evidence">
                  {withholding?.evidence ? (
                    withholding.evidence.fileUrl?.startsWith("/api/") ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() =>
                          setViewingEvidence(withholding.evidence ?? null)
                        }
                        className="h-auto gap-1 p-0 font-sans text-xs font-normal text-info"
                      >
                        {withholding.evidence.fileName}
                      </Button>
                    ) : (
                      <span>
                        {withholding.evidence.fileName}{" "}
                        <span className="font-sans text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">
                          metadata only
                        </span>
                      </span>
                    )
                  ) : (
                    <Missing />
                  )}
                </Row>

                <Row label="Payment Evidence">
                  {payment?.paymentEvidence ? (
                    payment.paymentEvidence.fileUrl?.startsWith("/api/") ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() =>
                          setViewingEvidence(payment.paymentEvidence ?? null)
                        }
                        className="h-auto gap-1 p-0 font-sans text-xs font-normal text-info"
                      >
                        <Paperclip className="size-3" />
                        {payment.paymentEvidence.fileName}
                      </Button>
                    ) : (
                      <span>
                        {payment.paymentEvidence.fileName}{" "}
                        <span className="font-sans text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">
                          metadata only
                        </span>
                      </span>
                    )
                  ) : (
                    <Missing />
                  )}
                </Row>
              </div>
            </div>
          </div>

          {(report.closingReason || payment?.remark || report.remark) && (
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
              Confirmed payment information is unavailable: {report.invoiceError}
            </p>
          )}

          
        </CardContent>
      </Card>

      <AttachmentViewer
        evidence={viewingEvidence}
        open={Boolean(viewingEvidence)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setViewingEvidence(null);
        }}
      />
    </>
  );
}
