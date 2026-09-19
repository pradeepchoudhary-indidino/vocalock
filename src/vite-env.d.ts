/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API server. Unset means the app uses its own SQLite. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
