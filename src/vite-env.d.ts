/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API server. Unset means the app uses its own SQLite. */
  readonly VITE_API_BASE?: string;
  /** Google "Web application" OAuth client id. Unset means a local test sign-in. */
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
