import type {
  Bookmark,
  CategoryWithCount,
  CreateBookmarkRequest,
} from "@my-bookmark/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cloneElement, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ApiClientError,
  createBookmark,
  createCategory,
  createReminder,
  updateBookmark,
} from "../../../lib/api-client";
import { toDatetimeLocalValue } from "../../../lib/datetime";
import {
  BookmarkMetadataEditor,
  metadataRows,
  normalizeMetadataRows,
} from "./bookmark-metadata";
import { ImageUpload } from "./image-upload";
import { TagInput } from "./tag-input";

export function BookmarkDialog({
  categories,
  onClose,
}: {
  categories: CategoryWithCount[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [contentKind, setContentKind] = useState<"link" | "image">("link");
  const [imageBusy, setImageBusy] = useState(false);
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
    <Dialog
      closeDisabled={contentKind === "image" && imageBusy}
      opaque
      title="북마크 추가"
      onClose={onClose}
    >
      <fieldset className="mb-4 grid grid-cols-2 gap-2 text-sm">
        <legend className="sr-only">항목 유형</legend>
        <button
          className={contentKind === "link" ? "chip-active" : "chip"}
          disabled={imageBusy}
          onClick={() => setContentKind("link")}
          type="button"
        >
          링크
        </button>
        <button
          className={contentKind === "image" ? "chip-active" : "chip"}
          onClick={() => setContentKind("image")}
          type="button"
        >
          이미지
        </button>
      </fieldset>
      {contentKind === "image" ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-500">
            이미지를 선택한 뒤 저장하면 별도 항목으로 등록하고 AI가 자동으로
            분석합니다.
          </p>
          <ImageUpload
            onBusyChange={setImageBusy}
            onUploaded={() => {
              toast.success("이미지를 저장했어요");
              void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
              void queryClient.invalidateQueries({ queryKey: ["categories"] });
            }}
          />
        </div>
      ) : (
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
                  placeholder="새 카테고리 (예: 💻 개발)"
                  value={newCategoryName}
                />
                <button
                  className="btn-secondary shrink-0"
                  disabled={
                    createCategoryMutation.isPending || !newCategoryName.trim()
                  }
                  onClick={() =>
                    createCategoryMutation.mutate({ name: newCategoryName })
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
      )}
    </Dialog>
  );
}

export function EditBookmarkDialog({
  bookmark,
  categories,
  onClose,
}: {
  bookmark: Bookmark;
  categories: CategoryWithCount[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(bookmark.title ?? "");
  const [description, setDescription] = useState(bookmark.description ?? "");
  const [tags, setTags] = useState(bookmark.tags);
  const [metadata, setMetadata] = useState(() =>
    metadataRows(bookmark.metadata),
  );
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState(bookmark.categoryId ?? "");
  const mutation = useMutation({
    mutationFn: (normalizedMetadata: Record<string, string>) =>
      updateBookmark(bookmark.id, {
        title: title || null,
        description: description || null,
        tags,
        categoryId: categoryId || null,
        metadata: normalizedMetadata,
      }),
    onSuccess: () => {
      toast.success("수정했어요");
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      onClose();
    },
    onError: () => toast.error("수정하지 못했어요"),
  });
  return (
    <Dialog opaque title="북마크 편집" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const normalized = normalizeMetadataRows(metadata);
          if (!normalized.success) {
            setMetadataError(normalized.message);
            return;
          }
          setMetadataError(null);
          mutation.mutate(normalized.metadata);
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
        <Field label="카테고리">
          <select
            className="input"
            onChange={(event) => setCategoryId(event.target.value)}
            value={categoryId}
          >
            <option value="">미분류</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <TagInput value={tags} onChange={setTags} />
        <BookmarkMetadataEditor
          error={metadataError}
          rows={metadata}
          onChange={(rows) => {
            setMetadata(rows);
            setMetadataError(null);
          }}
        />
        {bookmark.aiModel ? (
          <p className="text-xs text-zinc-500">
            AI 분류 모델: {bookmark.aiModel}
          </p>
        ) : null}
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
  const defaultDate = toDatetimeLocalValue(
    new Date(Date.now() + 2 * 60 * 1000),
  );
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
    onError: (error) => {
      if (error instanceof ApiClientError && error.status === 400) {
        toast.error(`리마인더를 만들지 못했어요 — ${error.message}`);
        return;
      }
      toast.error("리마인더를 만들지 못했어요");
    },
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
            min={toDatetimeLocalValue(new Date())}
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
  closeDisabled = false,
  opaque = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  opaque?: boolean;
}) {
  const titleId = `dialog-${title.replaceAll(" ", "-")}`;
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const initialFocus =
      surfaceRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      ) ??
      surfaceRef.current?.querySelector<HTMLElement>("button:not([disabled])");
    initialFocus?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !closeDisabled) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const focusable = Array.from(
      surfaceRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
      ) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      className="dialog-scrim dialog-scrim-blur"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) {
          onClose();
        }
      }}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={`dialog-surface relative z-10${opaque ? " dialog-surface-opaque" : ""}`}
        onKeyDown={handleKeyDown}
        ref={surfaceRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight" id={titleId}>
            {title}
          </h2>
          <button
            className="min-h-11 rounded-xl px-2 text-sm font-medium text-blue-600"
            disabled={closeDisabled}
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
  children: React.ReactElement<{ id?: string }>;
}) {
  const generatedId = useId();
  const controlId = children.props.id ?? generatedId;
  return (
    <label className="block space-y-1 text-sm font-medium" htmlFor={controlId}>
      <span>{label}</span>
      {cloneElement(children, { id: controlId })}
    </label>
  );
}
