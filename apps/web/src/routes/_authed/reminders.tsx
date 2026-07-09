import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BellOff, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  cancelReminder,
  getPushStatus,
  listReminders,
} from "../../lib/api-client";

export const Route = createFileRoute("/_authed/reminders")({
  component: RemindersPage,
});

function RemindersPage() {
  const queryClient = useQueryClient();
  const remindersQuery = useQuery({
    queryKey: ["reminders"],
    queryFn: listReminders,
  });
  const pushStatusQuery = useQuery({
    queryKey: ["pushStatus"],
    queryFn: getPushStatus,
  });
  const cancelMutation = useMutation({
    mutationFn: cancelReminder,
    onSuccess: () => {
      toast.success("리마인더를 취소했어요");
      void queryClient.invalidateQueries({ queryKey: ["reminders"] });
    },
    onError: () => toast.error("리마인더를 취소하지 못했어요"),
  });
  const reminders = remindersQuery.data?.items ?? [];

  return (
    <main className="space-y-4">
      <section>
        <h1 className="text-2xl font-bold">리마인더</h1>
        <p className="mt-1 text-sm text-zinc-500">
          예정된 북마크 알림을 확인하고 취소합니다.
        </p>
      </section>

      {pushStatusQuery.data && !pushStatusQuery.data.enabled ? (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <BellOff className="h-5 w-5 shrink-0" />
          <p>
            알림이 꺼져 있어요. 설정에서 알림을 켜야 리마인더를 받을 수
            있습니다.
          </p>
        </div>
      ) : null}

      <section className="space-y-3">
        {reminders.map((reminder) => (
          <article
            className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            key={reminder.id}
          >
            <div className="flex items-start gap-3">
              <Clock className="mt-1 h-5 w-5 text-blue-600" />
              <div className="min-w-0 flex-1">
                <a
                  className="font-medium hover:text-blue-600"
                  href={reminder.bookmark.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {reminder.bookmark.title ?? reminder.bookmark.url}
                </a>
                <p className="mt-1 text-sm text-zinc-500">
                  {new Date(reminder.remindAt).toLocaleString()}
                </p>
                {reminder.note ? (
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                    {reminder.note}
                  </p>
                ) : null}
              </div>
              <button
                aria-label="리마인더 취소"
                className="icon-button text-red-600"
                onClick={() => cancelMutation.mutate(reminder.id)}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </article>
        ))}
        {remindersQuery.isLoading ? (
          <p className="py-8 text-center text-zinc-500">불러오는 중…</p>
        ) : null}
        {!remindersQuery.isLoading && reminders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <Clock className="mx-auto h-10 w-10 text-zinc-400" />
            <p className="mt-4 font-medium">예정된 리마인더가 없습니다</p>
            <p className="mt-2 text-sm text-zinc-500">
              북마크 카드 메뉴에서 리마인더를 설정하세요.
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
