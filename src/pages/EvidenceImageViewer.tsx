import { useEffect, useState } from "react";
import { ArrowLeft, ImageOff, Loader2 } from "lucide-react";
import { API_BASE_URL } from "@/lib/api/config";
import { authRepository } from "@/services/auth/authRepository";

const API_BASE = (
  API_BASE_URL ||
  (import.meta as any).env?.VITE_API_BASE_URL ||
  "http://localhost:8080/api"
).replace(/\/+$/, "");
const API_ROOT = API_BASE.replace(/\/api\/?$/i, "");

export default function EvidenceImageViewer() {
  const searchParams = new URLSearchParams(window.location.search);
  const imagePath = searchParams.get("src");
  const fileName = searchParams.get("name") || "Evidence image";

  const [imageUrl, setImageUrl] = useState("");
  const [imageError, setImageError] = useState("");
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadImage() {
      setImageLoading(true);
      setImageError("");
      setImageUrl("");

      if (!imagePath) {
        setImageError("No image URL was provided.");
        setImageLoading(false);
        return;
      }

      // Only allow this viewer to request Finance expense attachments.
      if (!/^\/api\/finance\/expenses\/attachments\/[a-zA-Z0-9-]+$/.test(imagePath)) {
        setImageError("Invalid attachment URL.");
        setImageLoading(false);
        return;
      }

      const session: any = authRepository.getSession();
      const token = session?.token || session?.accessToken || session?.access_token;

      if (typeof token !== "string" || !token.trim()) {
        setImageError("Your session has expired. Please sign in again.");
        setImageLoading(false);
        return;
      }

      try {
        const response = await fetch(`${API_ROOT}${imagePath}`, {
          method: "GET",
          headers: {
            Accept: "image/*",
            Authorization: `Bearer ${token.trim()}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error("You are not authorized to view this attachment.");
          }
          if (response.status === 404) {
            throw new Error("The attachment file could not be found.");
          }
          throw new Error(`Unable to load attachment (HTTP ${response.status}).`);
        }

        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) {
          throw new Error("This attachment is not an image file.");
        }

        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setImageUrl(objectUrl);
      } catch (error) {
        if (!cancelled) {
          setImageError(
            error instanceof Error ? error.message : "Unable to display this image.",
          );
        }
      } finally {
        if (!cancelled) setImageLoading(false);
      }
    }

    void loadImage();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imagePath]);

  return (
    <div className="min-h-screen bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-muted"
          >
            <ArrowLeft className="size-4" />
            Back
          </button>

          <h1 className="truncate text-sm font-medium sm:text-base">
            {fileName}
          </h1>
        </div>

        <div className="flex min-h-[70vh] items-center justify-center overflow-hidden rounded-xl border border-border bg-card p-3 sm:p-6">
          {imageLoading ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="size-8 animate-spin" />
              <p className="text-sm">Loading attachment...</p>
            </div>
          ) : imageError ? (
            <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
              <ImageOff className="size-10" />
              <p className="text-sm">{imageError}</p>
            </div>
          ) : (
            <img
              src={imageUrl}
              alt={fileName}
              className="max-h-[80vh] max-w-full object-contain"
            />
          )}
        </div>
      </div>
    </div>
  );
}
