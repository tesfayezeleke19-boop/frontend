/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Future PHP/Django API base URL, e.g. https://api.example.com */
  readonly VITE_API_BASE_URL?: string;
  /** Request timeout in milliseconds (default 20000). */
  readonly VITE_API_TIMEOUT_MS?: string;
  /** "true" to send cookies with cross-origin requests (session auth). */
  readonly VITE_API_WITH_CREDENTIALS?: string;
  /** Existing HR PHP API base URL (temporary, pre-dates the REST layer). */
  readonly VITE_HR_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
