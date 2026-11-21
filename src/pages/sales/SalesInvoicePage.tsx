import { EthiopianDatePicker } from "@/components/ui/ethiopian-date-picker";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Save,
  Send,
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  Paperclip,
  Link2,
  FileUp,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  useNextInvoiceNumber,
  useSalesInvoice,
} from "@/hooks/use-sales-data";
import { salesInvoicesRepository } from "@/services/sales/invoiceRepo";
import {
  getSalesAggregateTypes,
  uploadInvoiceAttachment,
  type SalesAggregateTypeOption,
} from "@/services/sales/apiInvoiceRepo";
import {
  calculateSalesInvoiceTotals,
  isEditableInvoiceStatus,
  type FileEvidence,
  type InvoiceOrder,
  type SalesInvoiceInput,
} from "@/services/sales/invoice";
import { formatCurrency } from "@/services/sales/format";
import {
  ORDER_STATUS,
  ORDER_STATUS_UI,
  type AggregateType,
  type OrderStatus,
} from "@/services/sales/types";

const BANKS = [
  "CBE",
  "Awash Bank",
  "Dashen Bank",
  "Wegagen Bank",
  "Bank of Abyssinia",
  "Cooperative Bank",
  "United Bank",
  "Liberty Bank",
  "Zemen Bank",
];

const inputClass =
  "h-9 border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30";
const selectTriggerClass =
  "h-9 w-full border-input bg-popover text-sm text-foreground";

export default function SalesInvoicePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const editingId = id;
  const isEditing = !!editingId;

  const { user } = useAuth();
  const actor = user?.email ?? user?.name ?? "Guest";

  const { data: nextInvoiceNumber } = useNextInvoiceNumber();
  const { data: existing, loading: existingLoading } =
    useSalesInvoice(editingId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aggregateTypes, setAggregateTypes] = useState<SalesAggregateTypeOption[]>([]);
  const [aggregateTypesLoading, setAggregateTypesLoading] = useState(true);
  const [aggregateTypesError, setAggregateTypesError] = useState<string | null>(null);
  const [uploadingPaymentEvidence, setUploadingPaymentEvidence] = useState(false);
  const [uploadingWithholdingEvidence, setUploadingWithholdingEvidence] = useState(false);
  const [submittedInvoice, setSubmittedInvoice] = useState<{
    id: string;
    invoiceNumber: string;
    customerName: string;
    total: number;
    status: OrderStatus;
  } | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    customerName: "",
    tin: "",
    fsNo: "",
    remark: "",
  });
  const [orders, setOrders] = useState<
    {
      aggregate: string;
      quantity: string;
      unitPrice: string;
      royaltyInvoiceNumber: string;
    }[]
  >([{ aggregate: "", quantity: "", unitPrice: "", royaltyInvoiceNumber: "" }]);
  const [withholdingEnabled, setWithholdingEnabled] = useState(false);
  const [payment, setPayment] = useState({
    bank: "",
    paymentSender: "",
    paymentReferenceNumber: "",
  });
  const [paymentEvidence, setPaymentEvidence] = useState<FileEvidence | null>(
    null,
  );
  const [withholdingEvidence, setWithholdingEvidence] =
    useState<FileEvidence | null>(null);

  /* ---------------------------------------------------------------- */
  /* Aggregate options — loaded from the live backend database          */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    let cancelled = false;

    const loadAggregateTypes = async () => {
      setAggregateTypesLoading(true);
      setAggregateTypesError(null);
      try {
        const options = await getSalesAggregateTypes();
        if (!cancelled) {
          setAggregateTypes(options);
          if (options.length === 0) {
            setAggregateTypesError("No active aggregate types are configured.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error
            ? error.message
            : "Could not load aggregate types from the server.";
          setAggregateTypesError(message);
        }
      } finally {
        if (!cancelled) setAggregateTypesLoading(false);
      }
    };

    void loadAggregateTypes();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Load existing invoice once                                        */
  /* ---------------------------------------------------------------- */
  const [loadedEditId, setLoadedEditId] = useState<string | null>(null);
  if (isEditing && existing && loadedEditId !== editingId) {
    setLoadedEditId(editingId);
    setForm({
      customerName: existing.customer.name,
      tin: existing.customer.tin,
      fsNo: existing.fsNo,
      remark: existing.remark ?? "",
    });
    setOrders(
      existing.orders.map((order) => ({
        aggregate: order.aggregate,
        quantity: String(order.quantity),
        unitPrice: String(order.unitPrice),
        royaltyInvoiceNumber: order.royaltyInvoiceNumber ?? "",
      })),
    );
    setWithholdingEnabled(existing.financialSummary.withholdingEnabled);
    setPayment({
      bank: existing.payment.bank,
      paymentSender: existing.payment.paymentSender,
      paymentReferenceNumber: existing.payment.paymentReferenceNumber,
    });
    setPaymentEvidence(existing.payment.paymentEvidence ?? null);
    setWithholdingEvidence(existing.withholdingEvidence ?? null);
  }

  /* ---------------------------------------------------------------- */
  /* Live financial summary — always through the central engine        */
  /* ---------------------------------------------------------------- */
  const financialSummary = useMemo(
    () =>
      calculateSalesInvoiceTotals({
        orders: orders.map((o) => ({
          quantity: parseFloat(o.quantity) || 0,
          unitPrice: parseFloat(o.unitPrice) || 0,
        })),
        withholdingEnabled,
      }),
    [orders, withholdingEnabled],
  );

  const displayInvoiceNumber =
    isEditing && existing ? existing.invoiceNumber : nextInvoiceNumber;

  if (isEditing && existingLoading && !existing) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground/70" />
      </div>
    );
  }

  if (isEditing && !existingLoading && !existing) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm font-medium text-foreground">Invoice not found</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This invoice does not exist or may have been removed.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/sales/transactions")}
          className="mt-4 gap-1.5 border-input text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-3.5" />
          Back to Transactions
        </Button>
      </div>
    );
  }

  const canEdit =
    existing && isEditableInvoiceStatus(existing.status);

  if (isEditing && existing && !canEdit) {
    const status = ORDER_STATUS_UI[existing.status];
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm font-medium text-foreground">
          This invoice can no longer be edited
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Only draft or rejected invoices can be modified. This invoice is{" "}
          {status.label.toLowerCase()}.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/sales/transactions/detail/${existing.id}`)}
          className="mt-4 gap-1.5 border-input text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-3.5" />
          Back to Invoice
        </Button>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Order management — add/remove keeps numbering sequential          */
  /* ---------------------------------------------------------------- */
  const addOrder = () => {
    setOrders((prev) => [
      ...prev,
      { aggregate: "", quantity: "", unitPrice: "", royaltyInvoiceNumber: "" },
    ]);
  };
  const removeOrder = (index: number) => {
    setOrders((prev) => prev.filter((_, i) => i !== index));
  };
  const updateOrder = (
    index: number,
    field: "aggregate" | "quantity" | "unitPrice" | "royaltyInvoiceNumber",
    value: string,
  ) => {
    setOrders((prev) =>
      prev.map((order, i) => (i === index ? { ...order, [field]: value } : order)),
    );
    setErrors((prev) => {
      if (!prev[`order-${index}-${field}`]) return prev;
      const next = { ...prev };
      delete next[`order-${index}-${field}`];
      return next;
    });
  };

  const selectAggregate = (index: number, aggregateName: string) => {
    const selected = aggregateTypes.find((item) => item.name === aggregateName);

    setOrders((previous) =>
      previous.map((order, orderIndex) =>
        orderIndex === index
          ? {
              ...order,
              aggregate: aggregateName,
              // Selecting a different aggregate resets the price to its DB price.
              // The Unit Price input remains editable after this assignment.
              unitPrice: selected ? String(selected.pricePerM3) : order.unitPrice,
            }
          : order,
      ),
    );

    setErrors((previous) => {
      const next = { ...previous };
      delete next[`order-${index}-aggregate`];
      return next;
    });
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const updatePayment = (field: string, value: string) => {
    setPayment((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  /* ---------------------------------------------------------------- */
  /* File evidence — API-ready metadata, not a naked browser object     */
  /* ---------------------------------------------------------------- */
  const handleEvidenceUpload = async (
    file: File | null,
    target: "payment" | "withholding",
  ) => {
    if (!file) return;

    const setUploading = target === "payment"
      ? setUploadingPaymentEvidence
      : setUploadingWithholdingEvidence;

    setUploading(true);
    try {
      const evidence = await uploadInvoiceAttachment(file);

      if (target === "payment") {
        setPaymentEvidence(evidence);
        setErrors((previous) => {
          const next = { ...previous };
          delete next.paymentEvidence;
          return next;
        });
      } else {
        setWithholdingEvidence(evidence);
        setErrors((previous) => {
          const next = { ...previous };
          delete next.withholdingEvidence;
          return next;
        });
      }

      toast.success(`${file.name} uploaded successfully`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Evidence upload failed",
      );
    } finally {
      setUploading(false);
    }
  };

  const clearEvidence = (target: "payment" | "withholding") => {
    if (target === "payment") {
      setPaymentEvidence((previous) => {
        if (previous?.fileUrl?.startsWith("blob:")) URL.revokeObjectURL(previous.fileUrl);
        return null;
      });
      setErrors((prev) => {
        const next = { ...prev };
        delete next.paymentEvidence;
        return next;
      });
    } else {
      setWithholdingEvidence((previous) => {
        if (previous?.fileUrl?.startsWith("blob:")) URL.revokeObjectURL(previous.fileUrl);
        return null;
      });
      setErrors((prev) => {
        const next = { ...prev };
        delete next.withholdingEvidence;
        return next;
      });
    }
  };

  /* ---------------------------------------------------------------- */
  /* Validation before submitting to Finance                           */
  /* ---------------------------------------------------------------- */
  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.customerName.trim())
      errs.customerName = "Customer / Company Name is required";
    if (!form.tin.trim()) errs.tin = "Customer TIN Number is required";
    if (!form.fsNo.trim()) errs.fsNo = "FS No is required";

    if (orders.length === 0) {
      errs.orders = "At least one Order is required";
    } else {
      orders.forEach((order, index) => {
        const label = `Order ${index + 1}`;
        const quantityNum = parseFloat(order.quantity) || 0;
        const unitPriceNum = parseFloat(order.unitPrice) || 0;
        if (
          !order.aggregate ||
          !aggregateTypes.some((option) => option.name === order.aggregate)
        ) {
          errs[`order-${index}-aggregate`] =
            `${label}: Select an active aggregate type from the database`;
        }
        if (quantityNum <= 0) {
          errs[`order-${index}-quantity`] = `${label}: Quantity must be greater than zero`;
        }
        if (unitPriceNum < 0 || (order.unitPrice && Number.isNaN(unitPriceNum))) {
          errs[`order-${index}-unitPrice`] = `${label}: Enter a valid unit price`;
        }
        if (order.royaltyInvoiceNumber.trim() === "") {
          errs[`order-${index}-royaltyInvoiceNumber`] =
            `${label}: Royalty Invoice Number is required`;
        } else if (!order.royaltyInvoiceNumber.trim()) {
          errs[`order-${index}-royaltyInvoiceNumber`] =
            `${label}: Royalty Invoice Number cannot be only whitespace`;
        }
      });
    }

    if (!payment.bank) errs.bank = "Bank is required";
    if (!payment.paymentSender.trim())
      errs.paymentSender = "Payment Sent By is required";
    if (!payment.paymentReferenceNumber.trim())
      errs.paymentReferenceNumber = "Reference Number is required";
    if (!paymentEvidence)
      errs.paymentEvidence = "Payment Evidence is required before submitting";
    // Withholding evidence is mandatory only when the withholding switch is ON.
    // If withholding is OFF, do not block submission because evidence is absent.
    if (withholdingEnabled && !withholdingEvidence) {
      errs.withholdingEvidence =
        "Withholding Evidence is required when Withholding is ON";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const buildInput = (): SalesInvoiceInput => ({
    customer: { name: form.customerName, tin: form.tin },
    fsNo: form.fsNo,
    orders: orders.map((o) => ({
      aggregate: o.aggregate as AggregateType,
      quantity: parseFloat(o.quantity) || 0,
      unitPrice: parseFloat(o.unitPrice) || 0,
      royaltyInvoiceNumber: o.royaltyInvoiceNumber.trim() || undefined,
    })),
    withholdingEnabled,
    payment: {
      bank: payment.bank,
      paymentSender: payment.paymentSender,
      paymentReferenceNumber: payment.paymentReferenceNumber,
      paymentEvidence: paymentEvidence ?? undefined,
    },
    // Never send withholding evidence when withholding is disabled.
    withholdingEvidence: withholdingEnabled ? withholdingEvidence ?? undefined : undefined,
    remark: form.remark || undefined,
  });

  const handleSubmit = async (targetStatus: "DRAFT" | "PENDING") => {
    if (targetStatus === "PENDING") {
      if (orders.length === 0) {
        setErrors({ orders: "At least one Order is required" });
        return;
      }
      if (!validate()) return;
    } else {
      if (!form.customerName.trim()) {
        setErrors({ customerName: "Customer name is required" });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const input = buildInput();

      if (isEditing && editingId && existing) {
        await salesInvoicesRepository.saveDraft(editingId, input, actor);
        setErrors({});
        if (targetStatus === "PENDING") {
          const submitted = await salesInvoicesRepository.submitInvoice(
            editingId,
            actor,
          );
          toast.success(`Invoice ${submitted.invoiceNumber} submitted for finance review`);
          setSubmittedInvoice({
            id: submitted.id,
            invoiceNumber: submitted.invoiceNumber,
            customerName: submitted.customer.name,
            total: submitted.financialSummary.totalPriceInclVat,
            status: submitted.status,
          });
        } else {
          toast.success("Invoice draft updated");
          navigate("/sales/transactions");
        }
      } else {
        const created = await salesInvoicesRepository.createInvoice(input, {
          status:
            targetStatus === "PENDING"
              ? ORDER_STATUS.DRAFT
              : ORDER_STATUS.DRAFT,
          actor,
        });
        if (targetStatus === "PENDING") {
          const submitted = await salesInvoicesRepository.submitInvoice(
            created.id,
            actor,
          );
          toast.success(`Invoice ${submitted.invoiceNumber} submitted for finance review`);
          setSubmittedInvoice({
            id: submitted.id,
            invoiceNumber: submitted.invoiceNumber,
            customerName: submitted.customer.name,
            total: submitted.financialSummary.totalPriceInclVat,
            status: submitted.status,
          });
        } else {
          toast.success(`Invoice ${created.invoiceNumber} saved as draft`);
          navigate("/sales/transactions");
        }
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isEditing
            ? "Failed to update invoice"
            : "Failed to create invoice",
      );
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const backTo = isEditing
    ? `/sales/transactions/detail/${editingId}`
    : "/sales/transactions";

  /* ---------------------------------------------------------------- */
  /* Confirmation screen after successful submission                   */
  /* ---------------------------------------------------------------- */
  /**
   * Start a genuinely fresh invoice.
   *
   * "New Invoice" navigates to the SAME route the success screen is already
   * on, so React Router does not remount the page and the submitted-invoice
   * state would stay on screen. Clearing the form state first guarantees a
   * fresh form without touching or duplicating the saved invoice.
   */
  const startNewInvoice = () => {
    setSubmittedInvoice(null);
    setLoadedEditId(null);
    setForm({ customerName: "", tin: "", fsNo: "", remark: "" });
    setOrders([
      {
        aggregate: "",
        quantity: "",
        unitPrice: "",
        royaltyInvoiceNumber: "",
      },
    ]);
    setWithholdingEnabled(false);
    setPayment({
      bank: "",
      paymentSender: "",
      paymentReferenceNumber: "",
    });
    setPaymentEvidence(null);
    setWithholdingEvidence(null);
    setErrors({});
    navigate("/sales/new-invoice", { replace: true });
  };

  if (submittedInvoice) {
    const config = ORDER_STATUS_UI[submittedInvoice.status];
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center py-10 text-center">
        <div className="flex size-14 items-center justify-center rounded-full border border-success-border bg-success-soft">
          <Send className="size-6 text-success" />
        </div>
        <h1 className="mt-5 font-heading text-2xl font-semibold text-foreground">
          Invoice Submitted
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sales Invoice submitted successfully and is waiting for Finance
          review.
        </p>

        <Card className="mt-6 w-full border-border bg-card shadow-none">
          <CardContent className="space-y-3 p-5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Invoice Number</span>
              <span className="font-mono text-sm font-medium text-foreground">
                {submittedInvoice.invoiceNumber}
              </span>
            </div>
            <Separator className="bg-muted" />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Customer</span>
              <span className="font-medium text-foreground">
                {submittedInvoice.customerName}
              </span>
            </div>
            <Separator className="bg-muted" />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Price</span>
              <span className="text-base font-semibold tabular-nums text-foreground">
                {formatCurrency(submittedInvoice.total)}
              </span>
            </div>
            <Separator className="bg-muted" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <Badge
                variant="outline"
                className={`border text-xs font-medium ${config.className}`}
              >
                {config.label}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 flex gap-3">
          <Button
            onClick={() =>
              navigate(`/sales/transactions/detail/${submittedInvoice.id}`)
            }
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            View Invoice
          </Button>
          <Button
            variant="outline"
            onClick={startNewInvoice}
            className="gap-2 border-input text-foreground hover:bg-accent"
          >
            <Plus className="size-4" />
            New Invoice
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate(backTo)}
            className="mb-2 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {isEditing ? "Back to Invoice" : "Back to Transactions"}
          </button>
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold text-foreground">
              {isEditing ? "Edit Sales Invoice" : "New Sales Invoice"}
            </h1>
            {isEditing && existing && (
              <Badge
                variant="outline"
                className={`border text-[10px] font-medium ${ORDER_STATUS_UI[existing.status].className}`}
              >
                {ORDER_STATUS_UI[existing.status].label}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {isEditing
              ? "Make changes to this invoice. Submit it whenever you are ready."
              : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Form — main column */}
        <div className="space-y-5 lg:col-span-2">
          {/* Invoice Information */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Invoice Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">
                    Invoice Number
                  </Label>
                  <Input
                    value={displayInvoiceNumber || "Loading..."}
                    disabled
                    className={`${inputClass} mt-1 font-mono text-xs`}
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">
                    Date
                  </Label>
                  <EthiopianDatePicker
  value={new Date().toLocaleDateString("en-CA")}
  onChange={() => {}}
  className="mt-1 pointer-events-none"
/>
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">
                    FS No *
                  </Label>
                  <Input
                    value={form.fsNo}
                    onChange={(e) => updateField("fsNo", e.target.value)}
                    placeholder="e.g. 2704301"
                    className={`${inputClass} mt-1 font-mono text-xs ${errors.fsNo ? "border-destructive" : ""}`}
                  />
                  {errors.fsNo && (
                    <p className="mt-1 text-xs text-destructive">{errors.fsNo}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Customer Information */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Customer Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">
                    Customer / Company Name *
                  </Label>
                  <Input
                    value={form.customerName}
                    onChange={(e) => updateField("customerName", e.target.value)}
                    placeholder="e.g. ABC Construction PLC"
                    className={`${inputClass} mt-1 ${errors.customerName ? "border-destructive" : ""}`}
                  />
                  {errors.customerName && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.customerName}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">
                    Customer TIN Number *
                  </Label>
                  <Input
                    value={form.tin}
                    onChange={(e) => updateField("tin", e.target.value)}
                    placeholder="e.g. 0012345678"
                    className={`${inputClass} mt-1 font-mono text-xs ${errors.tin ? "border-destructive" : ""}`}
                  />
                  {errors.tin && (
                    <p className="mt-1 text-xs text-destructive">{errors.tin}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Orders (dynamic) */}
          <div className="space-y-3">
            {orders.map((order, index) => {
              const quantityNum = parseFloat(order.quantity) || 0;
              const unitPriceNum = parseFloat(order.unitPrice) || 0;
              const lineTotal = quantityNum * unitPriceNum;
              return (
                <Card
                  key={index}
                  className="border-border bg-card shadow-none"
                >
                  <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <CardTitle className="text-sm font-medium text-foreground">
                      Order {index + 1}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-violet">
                        Royalty Order {index + 1}
                      </span>
                      {orders.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeOrder(index)}
                          className="h-7 gap-1 px-2 text-xs text-destructive hover:bg-destructive-soft hover:text-destructive"
                        >
                          <Trash2 className="size-3" />
                          Remove Order
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 sm:grid-cols-4">
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">
                          Aggregate *
                        </Label>
                        <Select
                          value={order.aggregate}
                          onValueChange={(v) => selectAggregate(index, v)}
                          disabled={aggregateTypesLoading || aggregateTypes.length === 0}
                        >
                          <SelectTrigger
                            className={`${selectTriggerClass} mt-1 ${errors[`order-${index}-aggregate`] ? "border-destructive" : ""}`}
                          >
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent className="border-input bg-popover">
                            {aggregateTypes.map((type) => (
                              <SelectItem
                                key={type.id}
                                value={type.name}
                                className="text-sm text-foreground focus:bg-accent"
                              >
                                {type.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {aggregateTypesLoading && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Loading aggregate types...
                          </p>
                        )}
                        {!aggregateTypesLoading && aggregateTypesError && (
                          <p className="mt-1 text-xs text-destructive">
                            {aggregateTypesError}
                          </p>
                        )}
                        {errors[`order-${index}-aggregate`] && (
                          <p className="mt-1 text-xs text-destructive">
                            {errors[`order-${index}-aggregate`]}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">
                          Quantity (m³) *
                        </Label>
                        <Input
                          type="number"
                          value={order.quantity}
                          onChange={(e) =>
                            updateOrder(index, "quantity", e.target.value)
                          }
                          placeholder="0"
                          min="0"
                          step="0.01"
                          className={`${inputClass} mt-1 ${errors[`order-${index}-quantity`] ? "border-destructive" : ""}`}
                        />
                        {errors[`order-${index}-quantity`] && (
                          <p className="mt-1 text-xs text-destructive">
                            {errors[`order-${index}-quantity`]}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">
                          Unit Price (ETB) *
                        </Label>
                        <Input
                          type="number"
                          value={order.unitPrice}
                          onChange={(e) =>
                            updateOrder(index, "unitPrice", e.target.value)
                          }
                          placeholder="0"
                          min="0"
                          step="0.01"
                          className={`${inputClass} mt-1 ${errors[`order-${index}-unitPrice`] ? "border-destructive" : ""}`}
                        />
                        {order.aggregate && aggregateTypes.some((item) => item.name === order.aggregate) && (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Database price: {formatCurrency(
                              aggregateTypes.find((item) => item.name === order.aggregate)!.pricePerM3
                            )} / m³ — editable
                          </p>
                        )}
                        {errors[`order-${index}-unitPrice`] && (
                          <p className="mt-1 text-xs text-destructive">
                            {errors[`order-${index}-unitPrice`]}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col justify-end">
                        <Label className="text-xs font-medium text-muted-foreground">
                          Line Total
                        </Label>
                        <div className="mt-1 h-9 pt-2 text-sm font-medium tabular-nums text-foreground">
                          {lineTotal > 0 ? formatCurrency(lineTotal) : "—"}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground/70">
                          Quantity × Unit Price (VAT-exclusive)
                        </div>
                      </div>
                    </div>

                    {/* Royalty Invoice Number — per child Order */}
                    <div className="mt-4">
                      <Label className="text-xs font-medium text-muted-foreground">
                        Royalty Invoice Number *
                      </Label>
                      <Input
                        value={order.royaltyInvoiceNumber}
                        onChange={(e) =>
                          updateOrder(index, "royaltyInvoiceNumber", e.target.value)
                        }
                        placeholder={`e.g. RI-${new Date().getFullYear()}-${String(index + 1).padStart(3, "0")}`}
                        className={`${inputClass} mt-1 max-w-xs font-mono text-xs ${errors[`order-${index}-royaltyInvoiceNumber`] ? "border-destructive" : ""}`}
                      />
                      {errors[`order-${index}-royaltyInvoiceNumber`] && (
                        <p className="mt-1 text-xs text-destructive">
                          {errors[`order-${index}-royaltyInvoiceNumber`]}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Add Order */}
            <Button
              variant="outline"
              onClick={addOrder}
              className="w-full gap-2 border-dashed border-input bg-transparent text-sm text-muted-foreground hover:border-success/40 hover:bg-success-soft/40 hover:text-success"
            >
              <Plus className="size-4" />
              Add New Order
            </Button>
            {errors.orders && (
              <p className="text-xs text-destructive">{errors.orders}</p>
            )}
          </div>

          {/* Finance Summary */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Finance Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-sidebar p-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
                    <span className="tabular-nums text-foreground">
                      {formatCurrency(financialSummary.subtotalExclVat)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex justify-between text-sm">
                    <span className="text-muted-foreground">Total VAT (15%)</span>
                    <span className="tabular-nums text-warning">
                      {formatCurrency(financialSummary.totalVat)}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-sidebar p-3">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-foreground">
                      Total Price
                      <span className="ml-2 font-mono text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">
                        VAT-inclusive
                      </span>
                    </span>
                    <span className="text-base font-semibold tabular-nums text-foreground">
                      {formatCurrency(financialSummary.totalPriceInclVat)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex justify-between text-sm">
                    <span className="text-muted-foreground">Net after withholding</span>
                    <span className="tabular-nums text-success">
                      {formatCurrency(financialSummary.netAmountAfterWithholding)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Withholding toggle */}
              <Separator className="my-4 bg-muted" />
              <div className="flex items-center justify-between rounded-lg border border-border bg-sidebar p-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    Withholding (3%)
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground/70">
                    Withholding is {withholdingEnabled ? "ON" : "OFF"} —{" "}
                    {financialSummary.withholdingAmount > 0
                      ? formatCurrency(financialSummary.withholdingAmount)
                      : formatCurrency(0)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {withholdingEnabled ? "ON" : "OFF"}
                  </span>
                  <Switch
                    checked={withholdingEnabled}
                    onCheckedChange={(checked) => {
                      setWithholdingEnabled(checked);
                      // Remove a stale required-field error when the user turns withholding OFF.
                      if (!checked) {
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.withholdingEvidence;
                          return next;
                        });
                      }
                    }}
                    className="data-[state=checked]:bg-success"
                  />
                </div>
              </div>

              {/* Withholding evidence */}
              {withholdingEnabled && (
                <div className="mt-3 rounded-lg border border-border bg-sidebar p-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Withholding Evidence *
                    </Label>
                    {withholdingEvidence && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => clearEvidence("withholding")}
                        className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                      >
                        <Trash2 className="size-3" />
                        Remove
                      </Button>
                    )}
                  </div>
                  {withholdingEvidence ? (
                    <div className="mt-2 flex items-center gap-2 text-xs text-success">
                      <Paperclip className="size-3.5" />
                      <span className="truncate font-medium">
                        {withholdingEvidence.fileName}
                      </span>
                      {withholdingEvidence.fileUrl && (
                        <a
                          href={withholdingEvidence.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-info hover:underline"
                        >
                          <Link2 className="size-3" />
                          open
                        </a>
                      )}
                    </div>
                  ) : (
                    <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input p-3 text-xs text-muted-foreground transition-colors hover:border-success/40 hover:text-foreground">
                      <FileUp className="size-4" />
                      {uploadingWithholdingEvidence ? "Uploading withholding evidence..." : "Upload image or document (required when withholding is ON)"}
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={(e) => {
                          handleEvidenceUpload(e.target.files?.[0] ?? null, "withholding");
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  )}
                  {errors.withholdingEvidence && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.withholdingEvidence}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment Information */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Payment Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">
                    Bank *
                  </Label>
                  <Select
                    value={payment.bank}
                    onValueChange={(v) => updatePayment("bank", v)}
                  >
                    <SelectTrigger
                      className={`${selectTriggerClass} mt-1 ${errors.bank ? "border-destructive" : ""}`}
                    >
                      <SelectValue placeholder="Select bank" />
                    </SelectTrigger>
                    <SelectContent className="border-input bg-popover">
                      {BANKS.map((bank) => (
                        <SelectItem
                          key={bank}
                          value={bank}
                          className="text-sm text-foreground focus:bg-accent"
                        >
                          {bank}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.bank && (
                    <p className="mt-1 text-xs text-destructive">{errors.bank}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">
                    Payment Sent By *
                  </Label>
                  <Input
                    value={payment.paymentSender}
                    onChange={(e) => updatePayment("paymentSender", e.target.value)}
                    placeholder="e.g. Abebe Kebede"
                    className={`${inputClass} mt-1 ${errors.paymentSender ? "border-destructive" : ""}`}
                  />
                  {errors.paymentSender && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.paymentSender}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">
                    Reference Number *
                  </Label>
                  <Input
                    value={payment.paymentReferenceNumber}
                    onChange={(e) =>
                      updatePayment("paymentReferenceNumber", e.target.value)
                    }
                    placeholder="e.g. TXN-12345"
                    className={`${inputClass} mt-1 font-mono text-xs ${errors.paymentReferenceNumber ? "border-destructive" : ""}`}
                  />
                  {errors.paymentReferenceNumber && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.paymentReferenceNumber}
                    </p>
                  )}
                </div>
              </div>

              {/* Payment Evidence */}
              <div className="mt-4 rounded-lg border border-border bg-sidebar p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Payment Evidence *
                  </Label>
                  {paymentEvidence && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => clearEvidence("payment")}
                      className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                      Remove
                    </Button>
                  )}
                </div>
                {paymentEvidence ? (
                  <div className="mt-2 flex items-center gap-2 text-xs text-success">
                    <Paperclip className="size-3.5" />
                    <span className="truncate font-medium">
                      {paymentEvidence.fileName}
                    </span>
                    {paymentEvidence.fileUrl && (
                      <a
                        href={paymentEvidence.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-info hover:underline"
                      >
                        <Link2 className="size-3" />
                        open
                      </a>
                    )}
                  </div>
                ) : (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input p-3 text-xs text-muted-foreground transition-colors hover:border-success/40 hover:text-foreground">
                    <FileUp className="size-4" />
                    {uploadingPaymentEvidence ? "Uploading payment evidence..." : "Upload image or document of the payment confirmation"}
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        handleEvidenceUpload(e.target.files?.[0] ?? null, "payment");
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                )}
                {errors.paymentEvidence && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.paymentEvidence}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Remark */}
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Additional Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Label className="text-xs font-medium text-muted-foreground">Remark</Label>
              <Textarea
                value={form.remark}
                onChange={(e) => updateField("remark", e.target.value)}
                placeholder="Any additional notes..."
                rows={3}
                className="mt-1 resize-none border-input bg-popover text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-success focus-visible:ring-ring/30"
              />
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pb-6">
            <Button
              variant="ghost"
              onClick={() => navigate(backTo)}
              disabled={isSubmitting}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSubmit("DRAFT")}
              disabled={isSubmitting || uploadingPaymentEvidence || uploadingWithholdingEvidence}
              className="gap-2 border-input text-foreground hover:bg-accent"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save Draft
            </Button>
            <Button
              onClick={() => handleSubmit("PENDING")}
              disabled={isSubmitting || uploadingPaymentEvidence || uploadingWithholdingEvidence}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Submit Invoice
            </Button>
          </div>
        </div>

        {/* Summary Sidebar */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6 border-border bg-card shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Invoice Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Invoice Number</span>
                <span className="font-mono text-xs font-medium text-foreground">
                  {displayInvoiceNumber || "—"}
                </span>
              </div>
              <Separator className="bg-muted" />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Customer</span>
                <span className="font-medium text-foreground">
                  {form.customerName || "—"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">FS No</span>
                <span className="font-mono text-xs font-medium text-foreground">
                  {form.fsNo || "—"}
                </span>
              </div>
              <Separator className="bg-muted" />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Orders</span>
                <span className="font-medium text-foreground">
                  {orders.length}
                </span>
              </div>
              {orders.map((order, index) => {
                const qty = parseFloat(order.quantity) || 0;
                const price = parseFloat(order.unitPrice) || 0;
                const lineTotal = qty * price;
                return (
                  <div
                    key={index}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-muted-foreground/70">
                      Order {index + 1} · {order.aggregate || "—"} ·{" "}
                      {qty.toLocaleString()} m³
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {lineTotal > 0 ? formatCurrency(lineTotal) : "—"}
                    </span>
                  </div>
                );
              })}
              <Separator className="bg-muted" />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
                <span className="tabular-nums text-foreground">
                  {formatCurrency(financialSummary.subtotalExclVat)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total VAT (15%)</span>
                <span className="tabular-nums text-warning">
                  {formatCurrency(financialSummary.totalVat)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Withholding ({withholdingEnabled ? "3%" : "OFF"})
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatCurrency(financialSummary.withholdingAmount)}
                </span>
              </div>
              <Separator className="bg-muted" />
              <div className="flex justify-between text-sm">
                <span className="font-medium text-foreground">Total Price</span>
                <span className="text-lg font-semibold tabular-nums text-foreground">
                  {formatCurrency(financialSummary.totalPriceInclVat)}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                VAT-inclusive · Σ(Quantity × Unit Price) × 1.15
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
