
import { authRepository } from "@/services/auth/authRepository";

const DEFAULT_API_BASE_URL = "http://localhost:8080";

function getApiBaseUrl(): string {
  return (
    import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL
  ).replace(/\/+$/, "");
}

export interface ProfileUser {
  id: string;
  display_name: string;
  email: string;
  role: string;
  department: string | null;
  account_status: string;
  created_at: string;
  last_signed_in_at: string | null;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  user?: T;
  email?: string;
}

function getToken(): string {
  const session = authRepository.getSession();

  if (!session || session.isGuest || !session.token) {
    throw new Error("Your session is missing. Please sign in again.");
  }

  return session.token;
}

async function request<T>(
  path: string,
  method: "GET" | "PUT" = "GET",
  body?: Record<string, string>,
): Promise<T> {
  const token = getToken();

  let response: Response;

  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(
      "Cannot connect to the backend. Check that CodeIgniter is running.",
    );
  }

  const result = (await response.json().catch(() => null)) as
    | ApiResponse<T>
    | null;

  if (!response.ok || !result?.success) {
    throw new Error(
      result?.message ||
        (response.status === 401
          ? "Your session has expired. Please sign in again."
          : `The server returned HTTP ${response.status}.`),
    );
  }

  return result as T;
}

export async function getProfile(): Promise<ProfileUser> {
  const result = await request<ApiResponse<ProfileUser>>(
    "/api/profile",
  );

  if (!result.user) {
    throw new Error("The server did not return your profile.");
  }

  return result.user;
}

export async function updateProfileEmail(
  email: string,
): Promise<string> {
  const result = await request<ApiResponse>(
    "/api/profile/email",
    "PUT",
    { email },
  );

  return result.email || email;
}

export async function updateProfilePassword(input: {
  current_password: string;
  new_password: string;
  confirm_password: string;
}): Promise<void> {
  await request<ApiResponse>(
    "/api/profile/password",
    "PUT",
    input,
  );
}
