
const configuredApiUrl =
  (import.meta as any).env?.VITE_API_BASE_URL ||
  "http://localhost:8080";

export const API_ROOT = configuredApiUrl
  .replace(/\/api\/?$/i, "")
  .replace(/\/+$/, "");

const IMAGE_TEST_ROOT = `${API_ROOT}/api/image-test`;

export interface TestImage {
  id: number;
  file_name: string;
  mime_type: string;
  file_size: number;
  sha256: string;
  created_at: string;
}

export interface UploadResult {
  id: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
}

export async function uploadTestImage(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(`${IMAGE_TEST_ROOT}/upload`, {
    method: "POST",
    body: formData,
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.message || `Upload failed (${response.status}).`);
  }

  return result.data as UploadResult;
}

export async function getTestImages(): Promise<TestImage[]> {
  const response = await fetch(`${IMAGE_TEST_ROOT}/images`);

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.message || `Could not load images (${response.status}).`);
  }

  return result.data as TestImage[];
}

export async function getTestImageBlob(id: number): Promise<{
  blob: Blob;
  responseHash: string | null;
  expectedSize: string | null;
}> {
  const response = await fetch(`${IMAGE_TEST_ROOT}/images/${id}`);

  if (!response.ok) {
    throw new Error(`Image request failed (${response.status}).`);
  }

  return {
    blob: await response.blob(),
    responseHash: response.headers.get("X-Image-SHA256"),
    expectedSize: response.headers.get("X-Image-Expected-Size"),
  };
}

export async function calculateSha256(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
