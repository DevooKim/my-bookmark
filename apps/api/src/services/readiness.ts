import { supabaseAdmin } from "../lib/supabase";

type CheckState = "ok" | "failed";
export interface ReadinessSnapshot {
  ok: boolean;
  checks: {
    database: CheckState;
    push: CheckState;
    reminderCron: CheckState;
  };
}

export interface ReadinessService {
  check(): Promise<ReadinessSnapshot>;
  setPushConfigured(configured: boolean): void;
  markCronStarted(at?: Date): void;
  markCronSuccess(at?: Date): void;
  markCronFailure(at?: Date): void;
  markCronStopped(): void;
}

export function createReadinessService({
  databaseCheck,
  now = () => new Date(),
}: {
  databaseCheck: () => Promise<void>;
  now?: () => Date;
}): ReadinessService {
  let pushConfigured = false;
  let cronStartedAt: number | null = null;
  let cronLastSuccessAt: number | null = null;
  let cronFailed = false;
  return {
    async check() {
      let database: CheckState = "ok";
      try {
        await databaseCheck();
      } catch {
        database = "failed";
      }
      const reference = cronLastSuccessAt ?? cronStartedAt;
      const cronHealthy =
        reference !== null &&
        !cronFailed &&
        now().getTime() - reference <= 180_000;
      const checks = {
        database,
        push: pushConfigured ? ("ok" as const) : ("failed" as const),
        reminderCron: cronHealthy ? ("ok" as const) : ("failed" as const),
      };
      return {
        ok: Object.values(checks).every((value) => value === "ok"),
        checks,
      };
    },
    setPushConfigured(configured) {
      pushConfigured = configured;
    },
    markCronStarted(at = now()) {
      cronStartedAt = at.getTime();
      cronFailed = false;
    },
    markCronSuccess(at = now()) {
      cronLastSuccessAt = at.getTime();
      cronFailed = false;
    },
    markCronFailure() {
      cronFailed = true;
    },
    markCronStopped() {
      cronStartedAt = null;
      cronLastSuccessAt = null;
      cronFailed = true;
    },
  };
}

export const defaultReadinessService = createReadinessService({
  async databaseCheck() {
    if (!supabaseAdmin) throw new Error("Database is not configured");
    const { error } = await supabaseAdmin
      .from("bookmarks")
      .select("id")
      .limit(1);
    if (error) throw error;
  },
});
