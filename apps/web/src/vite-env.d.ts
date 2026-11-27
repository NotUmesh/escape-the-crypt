/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time origin of the generation worker. Unset hides "Generate from my notes". */
  readonly VITE_WORKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
