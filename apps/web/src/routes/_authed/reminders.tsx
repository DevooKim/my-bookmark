import type { ReminderWithBookmark } from "@my-bookmark/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BellOff, Clock, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  cancelReminder,
  getPushStatus,
  listReminders,
  updateReminder,
} from "../../lib/api-client";
import { ReminderDialog } from "./-components/bookmark-dialogs";

export const Route = createFileRoute("/_authed/reminders")({
  component: RemindersPage,
});

export function RemindersPage() {
  const queryClient = useQueryClient();
  const [rescheduleTarget, setRescheduleTarget] =
    useState<ReminderWithBookmark | null>(null);
  const remindersQuery = useQuery({
    queryKey: ["reminders"],
    queryFn: listReminders,
  });
  const pushStatusQuery = useQuery({
    queryKey: ["pushStatus"],
    queryFn: getPushStatus,
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelReminder(id),
    onSuccess: () => {
      toast.success("리마인더를 취소했어요");
      void queryClient.invalidateQueries({ queryKey: ["reminders"] });
    },
    onError: () => toast.error("리마인더를 취소하지 못했어요"),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      updateReminder(id, { isEnabled }),
    onSuccess: () => {
      toast.success("리마인더 상태를 변경했어요");
      void queryClient.invalidateQueries({ queryKey: ["reminders"] });
    },
    onError: () => toast.error("리마인더 상태를 변경하지 못했어요"),
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
        {reminders.map((reminder) => {
          const title =
            reminder.bookmark.title ??
            (reminder.bookmark.kind === "image"
              ? "이미지"
              : reminder.bookmark.url);
          const isPast = new Date(reminder.remindAt).getTime() < Date.now();
          const isInactive =
            reminder.recurrence !== "none" && !reminder.isEnabled;
          const statusClass = isInactive
            ? "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400"
            : isPast
              ? "bg-red-500/10 text-red-600 dark:text-red-400"
              : "bg-blue-500/10 text-blue-600 dark:text-blue-400";
          return (
            <article
              className={`bookmark-card${isInactive ? " opacity-70" : ""}`}
              key={reminder.id}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${statusClass}`}
                >
                  <Clock className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <a
                    className="font-semibold tracking-[-0.01em] hover:text-blue-600"
                    href={
                      reminder.bookmark.kind === "image"
                        ? `/images/${reminder.bookmark.id}`
                        : reminder.bookmark.url
                    }
                    rel={
                      reminder.bookmark.kind === "link"
                        ? "noreferrer"
                        : undefined
                    }
                    target={
                      reminder.bookmark.kind === "link" ? "_blank" : undefined
                    }
                  >
                    {title}
                  </a>
                  <p
                    className={`mt-1 text-sm font-medium ${
                      isInactive
                        ? "text-zinc-500 dark:text-zinc-400"
                        : isPast
                          ? "text-red-600 dark:text-red-400"
                          : "text-blue-600 dark:text-blue-400"
                    }`}
                    data-reminder-date
                  >
                    {new Date(reminder.remindAt).toLocaleString("ko-KR", {
                      hourCycle: "h23",
                    })}
                  </p>
                  {reminder.recurrence !== "none" ? (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      <span className="rounded-lg bg-blue-50 px-2 py-1 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-200">
                        {recurrenceLabel(reminder.recurrence)}
                      </span>
                      {!reminder.isEnabled ? (
                        <span className="rounded-lg bg-zinc-100 px-2 py-1 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          비활성
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {reminder.note ? (
                    <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                      {reminder.note}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {reminder.status === "sent" &&
                  reminder.recurrence === "none" ? (
                    <button
                      aria-label={`${title} 다시 알림`}
                      className="icon-button text-blue-600"
                      onClick={() => setRescheduleTarget(reminder)}
                      type="button"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  ) : null}
                  {reminder.recurrence !== "none" ? (
                    <button
                      aria-label={`${title} 리마인더 ${reminder.isEnabled ? "비활성화" : "활성화"}`}
                      className="icon-button text-blue-600"
                      disabled={toggleMutation.isPending}
                      onClick={() =>
                        toggleMutation.mutate({
                          id: reminder.id,
                          isEnabled: !reminder.isEnabled,
                        })
                      }
                      type="button"
                    >
                      {reminder.isEnabled ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </button>
                  ) : null}
                  <button
                    aria-label={`${title} 리마인더 삭제`}
                    className="icon-button text-red-600"
                    disabled={cancelMutation.isPending}
                    onClick={() => cancelMutation.mutate(reminder.id)}
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
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
      {rescheduleTarget ? (
        <ReminderDialog
          bookmark={rescheduleTarget.bookmark}
          onClose={() => setRescheduleTarget(null)}
          reminder={{
            id: rescheduleTarget.id,
            note: rescheduleTarget.note,
            recurrence: rescheduleTarget.recurrence,
          }}
        />
      ) : null}
    </main>
  );
}

function recurrenceLabel(
  recurrence: Exclude<ReminderWithBookmark["recurrence"], "none">,
): string {
  if (recurrence === "daily") {
    return "매일";
  }
  if (recurrence === "weekly") {
    return "매주";
  }
  return "매월";
}
