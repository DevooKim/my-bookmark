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
    <main className="page-stack">
      <section className="page-header">
        <div>
          <p className="page-eyebrow">Up next</p>
          <h1 className="page-title">리마인더</h1>
          <p className="page-subtitle">
            다시 볼 링크와 시간을 한곳에서 확인하세요.
          </p>
        </div>
      </section>

      {pushStatusQuery.data && !pushStatusQuery.data.enabled ? (
        <div className="surface flex gap-3 border-amber-200 bg-amber-50/80 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <BellOff className="h-5 w-5 shrink-0" />
          <p className="leading-5">
            알림이 꺼져 있어요. 설정에서 알림을 켜야 리마인더를 받을 수
            있습니다.
          </p>
        </div>
      ) : null}

      <section className="space-y-3" aria-label="예정된 리마인더">
        {reminders.map((reminder) => (
          <article className="bookmark-card" key={reminder.id}>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Clock className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <a
                  className="font-semibold tracking-[-0.01em] hover:text-blue-600"
                  href={reminder.bookmark.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {reminder.bookmark.title ?? reminder.bookmark.url}
                </a>
                <p className="mt-1 text-sm font-medium text-blue-600 dark:text-blue-400">
                  {new Date(reminder.remindAt).toLocaleString()}
                </p>
                {reminder.note ? (
                  <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
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
          <div className="empty-state">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Clock className="h-7 w-7" />
            </span>
            <p className="mt-4 text-lg font-semibold">
              예정된 리마인더가 없어요
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              라이브러리의 북마크 메뉴에서 시간을 정할 수 있습니다.
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
