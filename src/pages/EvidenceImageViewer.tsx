
import { ArrowLeft, ImageOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { authRepository } from "@/services/auth/authRepository";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080"
).replace(/\/+$/, "");

export default function EvidenceImageViewer() {
  const searchParams = new URLSearchParams(window.location.search);

  const imageUrl = searchParams.get("src");
  const fileName = searchParams.get("name") || "Evidence image";

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl: string | null = null;

    const loadImage = async () => {
      setImageLoading(true);
      setImageError("");
      setObjectUrl(null);

      if (!imageUrl) {
        setImageError("No image URL was provided.");
        setImageLoading(false);
        return;
      }

      try {
        const session = authRepository.getSession();

        if (!session || session.isGuest || !session.token) {
          throw new Error(
            "Your session is unavailable. Please sign in again."
          );
        }

        // Resolve relative URLs against the backend.
        const requestUrl = new URL(
          imageUrl,
          `${API_BASE_URL}/`
        );

        // Never send the authentication token to another origin.
        if (requestUrl.origin !== new URL(API_BASE_URL).origin) {
          throw new Error("Invalid evidence image URL.");
        }

        const response = await fetch(requestUrl.toString(), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.token}`,
            Accept: "image/*",
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error(
              "Your session has expired. Please sign in again."
            );
          }

          if (response.status === 403) {
            throw new Error(
              "You are not authorized to view this evidence."
            );
          }

          throw new Error(
            `Unable to load the image. Server returned HTTP ${response.status}.`
          );
        }

        const blob = await response.blob();

        if (!blob.type.startsWith("image/")) {
          throw new Error("The server did not return a valid image.");
        }

        createdObjectUrl = URL.createObjectURL(blob);

        if (!cancelled) {
          setObjectUrl(createdObjectUrl);
        }
      } catch (error) {
        if (!cancelled) {
          setImageError(
            error instanceof Error
              ? error.message
              : "Unable to display this image."
          );
        }
      } finally {
        if (!cancelled) {
          setImageLoading(false);
        }
      }
    };

    void loadImage();

    return () => {
      cancelled = true;

      if (createdObjectUrl) {
        URL.revokeObjectURL(createdObjectUrl);
      }
    };
  }, [imageUrl]);

  return (
    <div className="min-h-screen bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-accent"
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
              <p className="text-sm">Loading evidence image...</p>
            </div>
          ) : imageError ? (
            <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
              <ImageOff className="size-10" />
              <p>{imageError}</p>
            </div>
          ) : objectUrl ? (
            <div className="flex w-full items-center justify-center">
              <img
                src={objectUrl}
                alt={fileName}
                className="max-h-[80vh] max-w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
              <ImageOff className="size-10" />
              <p>Unable to display this image.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
