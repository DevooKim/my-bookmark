import { createClient } from "@supabase/supabase-js";
import { appEnv } from "./env";

export function createSupabaseAdminClient() {
  if (!appEnv.SUPABASE_URL || !appEnv.SUPABASE_SECRET_KEY) {
    throw new Error("Supabase admin client is not configured");
  }

  return createClient(appEnv.SUPABASE_URL, appEnv.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export const supabaseAdmin =
  appEnv.NODE_ENV === "test" ? undefined : createSupabaseAdminClient();
