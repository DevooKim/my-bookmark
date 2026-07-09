import type { SupabaseClient } from "@supabase/supabase-js";

let clientPromise: Promise<SupabaseClient> | undefined;

// supabase-js is ~55KB gzip and is only needed after hydration (auth calls),
// so it loads on demand to keep initial route JS within the 150KB budget.
export function getSupabase(): Promise<SupabaseClient> {
  clientPromise ??= import("@supabase/supabase-js").then(({ createClient }) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabasePublishableKey = import.meta.env
      .VITE_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !supabasePublishableKey) {
      throw new Error("Supabase browser client is not configured");
    }

    return createClient(supabaseUrl, supabasePublishableKey);
  });
  return clientPromise;
}
