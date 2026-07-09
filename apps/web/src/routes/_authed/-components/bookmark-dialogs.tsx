import type {
  Bookmark,
  CategoryWithCount,
  CreateBookmarkRequest,
} from "@my-bookmark/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  ApiClientError,
  createBookmark,
  createCategory,
  createReminder,
  updateBookmark,
} from "../../../lib/api-client";

export function BookmarkDialog({
  categories,
  onClose,
}: {
  categories: CategoryWithCount[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"ai" | "manual" | "none">(() => {
    const stored = localStorage.getItem("bookmarkMode");
    return stored === "ai" || stored === "manual" ? stored : "none";
  });
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [newCategoryName, setNewCategoryName] = useState("");
  const createCategoryMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: (category) => {
      setCategoryId(category.id);
      setNewCategoryName("");
      toast.success("카테고리를 만들었어요");
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: () => toast.error("카테고리를 만들지 못했어요"),
  });
  const mutation = useMutation({
    mutationFn: createBookmark,
    onSuccess: () => {
      localStorage.setItem("bookmarkMode", mode);
      toast.success("북마크를 저장했어요");
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.status === 409) {
        toast.error("이미 저장된 링크예요");
        return;
      }
      toast.error("저장하지 못했어요");
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const body: CreateBookmarkRequest =
      mode === "manual"
        ? { url, mode, categoryId, title: title.trim() || null }
        : { url, mode, title: title.trim() || null };
    mutation.mutate(body);
  }

  return (
    <Dialog title="북마크 추가" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="URL">
          <input
            className="input"
            onChange={(e) => setUrl(e.target.value)}
            required
            type="url"
            value={url}
          />
        </Field>
        <Field label="제목(선택)">
          <input
            className="input"
            onChange={(e) => setTitle(e.target.value)}
            value={title}
          />
        </Field>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <button
            className={mode === "ai" ? "chip-active" : "chip"}
            onClick={() => setMode("ai")}
            type="button"
          >
            AI 자동
          </button>
          <button
            className={mode === "manual" ? "chip-active" : "chip"}
            onClick={() => setMode("manual")}
            type="button"
          >
            직접 선택
          </button>
          <button
            className={mode === "none" ? "chip-active" : "chip"}
            onClick={() => setMode("none")}
            type="button"
          >
            미지정
          </button>
        </div>
        {mode === "manual" ? (
          <div className="space-y-3">
            <Field label="카테고리">
              <select
                className="input"
                onChange={(e) => setCategoryId(e.target.value)}
                required
                value={categoryId}
              >
                <option value="" disabled>
                  카테고리를 선택하세요
                </option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex gap-2">
              <input
                className="input"
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="새 카테고리 이름"
                value={newCategoryName}
              />
              <button
                className="btn-secondary shrink-0"
                disabled={
                  createCategoryMutation.isPending || !newCategoryName.trim()
                }
                onClick={() =>
                  createCategoryMutation.mutate({
                    name: newCategoryName,
                    color: "blue",
                  })
                }
                type="button"
              >
                새 카테고리
              </button>
            </div>
          </div>
        ) : null}
        <button
          className="btn-primary w-full justify-center"
          disabled={mutation.isPending || (mode === "manual" && !categoryId)}
          type="submit"
        >
          저장
        </button>
      </form>
    </Dialog>
  );
}

export function EditBookmarkDialog({
  bookmark,
  onClose,
}: {
  bookmark: Bookmark;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(bookmark.title ?? "");
  const [description, setDescription] = useState(bookmark.description ?? "");
  const mutation = useMutation({
    mutationFn: () =>
      updateBookmark(bookmark.id, {
        title: title || null,
        description: description || null,
      }),
    onSuccess: () => {
      toast.success("수정했어요");
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      onClose();
    },
    onError: () => toast.error("수정하지 못했어요"),
  });
  return (
    <Dialog title="북마크 편집" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label="제목">
          <input
            className="input"
            onChange={(e) => setTitle(e.target.value)}
            value={title}
          />
        </Field>
        <Field label="설명">
          <textarea
            className="input min-h-24"
            onChange={(e) => setDescription(e.target.value)}
            value={description}
          />
        </Field>
        <button
          className="btn-primary w-full justify-center"
          disabled={mutation.isPending}
          type="submit"
        >
          저장
        </button>
      </form>
    </Dialog>
  );
}

export function ReminderDialog({
  bookmark,
  onClose,
}: {
  bookmark: Bookmark;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const defaultDate = new Date(Date.now() + 2 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
  const [remindAt, setRemindAt] = useState(defaultDate);
  const [note, setNote] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      createReminder({
        bookmarkId: bookmark.id,
        remindAt: new Date(remindAt).toISOString(),
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success("리마인더를 만들었어요");
      void queryClient.invalidateQueries({ queryKey: ["reminders"] });
      onClose();
    },
    onError: () => toast.error("리마인더를 만들지 못했어요"),
  });
  return (
    <Dialog title="리마인더 설정" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <p className="truncate text-sm text-zinc-500">
          {bookmark.title ?? bookmark.url}
        </p>
        <Field label="알림 시간">
          <input
            className="input"
            min={new Date().toISOString().slice(0, 16)}
            onChange={(event) => setRemindAt(event.target.value)}
            required
            type="datetime-local"
            value={remindAt}
          />
        </Field>
        <Field label="메모(선택)">
          <textarea
            className="input min-h-20"
            onChange={(event) => setNote(event.target.value)}
            value={note}
          />
        </Field>
        <button
          className="btn-primary w-full justify-center"
          disabled={mutation.isPending}
          type="submit"
        >
          저장
        </button>
      </form>
    </Dialog>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:justify-center sm:p-4">
      <div className="w-full rounded-t-3xl bg-white p-5 shadow-xl dark:bg-zinc-900 sm:max-w-md sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            className="text-sm text-zinc-500"
            onClick={onClose}
            type="button"
          >
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block space-y-1 text-sm font-medium">
      <span>{label}</span>
      {children}
    </div>
  );
}
