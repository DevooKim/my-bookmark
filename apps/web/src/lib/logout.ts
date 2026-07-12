import type { QueryClient } from "@tanstack/react-query";
import { clearServiceWorkerApiCache } from "./service-worker";
import { getSupabase } from "./supabase";

export async function performLogout(queryClient: QueryClient) {
  const supabase = await getSupabase();
  await supabase.auth.signOut();
  await clearServiceWorkerApiCache();
  queryClient.clear();
  window.location.assign("/login");
}
