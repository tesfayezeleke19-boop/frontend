/**
 * Authenticated viewer for a saved contract attachment.
 *
 * Attachment URLs are protected by the application's bearer token, so they
 * must never be opened with a plain anchor. This dialog fetches the file
 * through the central attachment service, displays images inline, and renders
 * PDFs in the browser's PDF viewer. The temporary object URL is revoked when
 * the dialog closes, the evidence changes, or the component unmounts.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchInvoiceAttachment } from "@/services/sales/apiInvoiceRepo";
import type { FileEvidence } from "@/services/sales/invoice";

interface Props {
  evidence: FileEvidence | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AttachmentViewer({ evidence, open, onOpenChange }: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl: string | null = null;

    if (!open || !evidence?.fileUrl?.startsWith("/api/")) {
      setObjectUrl(null);
      setMimeType("");
      setLoading(false);
      setError("");
      return;
    }

    setObjectUrl(null);
    setMimeType("");
    setError("");
    setLoading(true);

    void fetchInvoiceAttachment(evidence.fileUrl, evidence.mimeType).then(
      (attachment) => {
        if (cancelled) {
          URL.revokeObjectURL(attachment.objectUrl);
          return;
        }

        createdObjectUrl = attachment.objectUrl;
        setObjectUrl(attachment.objectUrl);
        setMimeType(attachment.mimeType);
        setLoading(false);
      },
      (reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load this attachment.",
        );
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [evidence?.fileUrl, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-input bg-card sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <FileText className="size-4 text-muted-foreground" />
            <span className="truncate">{evidence?.fileName ?? "Attachment"}</span>
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Saved attachment · viewed through your authenticated session
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin" />
            <p className="text-sm">Loading attachment…</p>
          </div>
        ) : error ? (
          <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <AlertTriangle className="size-9 text-warning" />
            <p className="max-w-md text-sm">{error}</p>
          </div>
        ) : objectUrl && mimeType === "application/pdf" ? (
          <iframe
            src={objectUrl}
            title={evidence?.fileName ?? "PDF attachment"}
            className="h-[70vh] w-full rounded-md border border-border bg-white"
          />
        ) : objectUrl && mimeType.startsWith("image/") ? (
          <div className="flex min-h-[40vh] items-center justify-center rounded-md border border-border bg-sidebar p-3">
            <img
              src={objectUrl}
              alt={evidence?.fileName ?? "Attachment"}
              className="max-h-[70vh] max-w-full object-contain"
            />
          </div>
        ) : (
          <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <AlertTriangle className="size-9 text-warning" />
            <p className="text-sm">This attachment could not be displayed.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
