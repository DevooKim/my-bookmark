import { createFileRoute } from "@tanstack/react-router";
import { Clock } from "lucide-react";

export const Route = createFileRoute("/_authed/reminders")({
  component: RemindersPage,
});

function RemindersPage() {
  return (
    <main className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <Clock className="mx-auto h-10 w-10 text-zinc-400" />
      <h1 className="mt-4 text-xl font-bold">리마인더</h1>
      <p className="mt-2 text-sm text-zinc-500">
        리마인더와 푸시 알림은 다음 Phase에서 완성됩니다.
      </p>
    </main>
  );
}
