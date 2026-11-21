
/**
 * Payment Information section shared by BOTH contract workflows.
 *
 * It presents the contract's financial position without ever presenting
 * recorded payment details as a confirmed payment:
 *
 *   - "Recorded — not confirmed" means Finance typed the details; no money is
 *     counted as paid.
 *   - Paid amounts only appear once the resulting Sales Invoice is
 *     PAYMENT_CONFIRMED.
 *   - Withholding is shown as a separate decision and amount, never as a
 *     payment and never as fulfillment.
 *
 * Withholding enabled state is determined by the API rate:
 * rate > 0 means enabled; rate = 0 means disabled.
 */
import { useState } from "react";
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
  Paperclip,
  Pencil,
  ReceiptText,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/services/sales/format";
import type { FileEvidence } from "@/services/sales/invoice";
import { AttachmentViewer } from "./AttachmentViewer";
import {
  CONTRACT_PAYMENT_STATUS_UI,
  type ContractFinancialReport,
} from "@/services/contracts/financials";

interface Props {
  report: ContractFinancialReport;
  /** Only Finance may record or change payment and withholding information. */
  canManage: boolean;
  onEdit: () => void;
  /** Shown in the section header, e.g. the contract number. */
  title?: string;
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
      <div className="mt-1 text-sm text-foreground">{children}</div>
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

  // The API rate is the source of truth for withholding.
  // Do not rely on report.withholdingEnabled or withholding.enabled.
  const withholdingRateFromApi = Number(
    report.withholding?.rate ?? report.withholdingRate ?? 0,
  );

  const withholdingEnabled = withholdingRateFromApi > 0;

  const withholdingAmount = withholdingEnabled
    ? Number(report.withholdingAmount ?? 0)
    : 0;

  const paymentStatus =
    CONTRACT_PAYMENT_STATUS_UI?.[report.paymentStatus] ??
    CONTRACT_PAYMENT_STATUS_UI?.RECORDED_NOT_CONFIRMED ??
    {
      label: "Not confirmed",
      className: "erp-badge-draft",
    };

  const withholdingStatusLabel = withholdingEnabled
    ? "Enabled"
    : "Not applied";

  const [viewingEvidence, setViewingEvidence] =
    useState<FileEvidence | null>(null);

  return (
    <>
      <Card className="border-border bg-card shadow-none">
        <CardHeader className="flex flex-row items-start justify-between pb-3">
          <div>
            <CardTitle className="text-sm font-medium text-foreground">
              Payment Information
            </CardTitle>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge
              variant="outline"
              className={`border text-[10px] font-medium ${paymentStatus.className}`}
            >
              {paymentStatus.label}
            </Badge>

            <Badge
              variant="outline"
              className={`border text-[10px] font-medium ${
                withholdingEnabled
                  ? "erp-badge-approved"
                  : "erp-badge-draft"
              }`}
            >
              {withholdingStatusLabel}
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
              <Field label="Bank">{payment.bank || "—"}</Field>

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
                {payment.paymentDate ? formatDate(payment.paymentDate) : "—"}
              </Field>

              <Field label="Recorded By">
                <span className="text-xs">
                  {payment.recordedBy ?? "—"}
                  {payment.recordedAt ? (
                    <span className="block font-mono text-[10px] text-muted-foreground/70">
                      {formatDate(payment.recordedAt, { time: true })}
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

                      {payment.paymentEvidence.fileUrl?.startsWith("/api/") ? (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          onClick={() =>
                            setViewingEvidence(
                              payment.paymentEvidence ?? null,
                            )
                          }
                          className="h-auto gap-1 p-0 text-xs text-info"
                        >
                          view
                        </Button>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          metadata only
                        </span>
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
        
          </div>

          {withholdingEnabled && (
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              Withholding 
              {withholding?.evidence ? (
                <>
                  {" Evidence: "}
                  {withholding.evidence.fileName}.
                  {withholding.evidence.fileUrl?.startsWith("/api/") && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() =>
                        setViewingEvidence(withholding?.evidence ?? null)
                      }
                      className="h-auto gap-1 p-0 text-[11px] text-info"
                    >
                      view
                    </Button>
                  )}
                </>
              ) : (
                " No withholding evidence attached."
              )}
            </p>
          )}

          {report.paymentStatus === "RECORDED_NOT_CONFIRMED" && (
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              Payment details are recorded for reference only. The outstanding
              balance stays payable until the resulting Sales Invoice payment
              is confirmed by Finance.
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
