/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected by vite `define`; changes every build so persisted query
// snapshots never outlive the response shapes they were written with.
declare const __BUILD_ID__: string;
