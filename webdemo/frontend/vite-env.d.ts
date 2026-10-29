/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_APP_TITLE: string;
  readonly VITE_API_TIMEOUT_MS?: string;
  readonly VITE_API_DEBUG?: string;
  readonly VITE_USER_CLIENT_ID: string;
  readonly VITE_CHAT_BASE_URL?: string;
  /** Document parsing API base. When set to `/`, requests stay on the current site and the dev server forwards them to the local worker. */
  readonly VITE_OCR_API_BASE?: string;
  readonly VITE_AUTH_PROFILE?: 'legacy' | 'gcp';
  readonly VITE_COOKIE_CONSENT_ENABLED?: 'true' | 'false';
  readonly VITE_IMAGE_PARSE_CROSS_PAGE_MERGE?: 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
