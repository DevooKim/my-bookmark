import type { Bookmark } from "@my-bookmark/shared";
import { ImagePlus, RefreshCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createImage } from "../../../lib/api-client";

type UploadStatus = "selected" | "queued" | "uploading" | "success" | "failed";

interface UploadItem {
  id: string;
  file: File;
  previewUrl: string;
  status: UploadStatus;
  error: string | null;
}

export function ImageUpload({
  initialFiles,
  onAllSettled,
  onUploaded,
  onBusyChange,
  onSelectionChange,
}: {
  initialFiles?: File[];
  onAllSettled?: () => void;
  onUploaded: (bookmark: Bookmark) => void;
  onBusyChange?: (busy: boolean) => void;
  onSelectionChange?: () => void;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const previewUrls = useRef(new Set<string>());
  const initialFilesQueued = useRef(false);
  const wasBusy = useRef(false);
  const busy = items.some(
    (item) => item.status === "queued" || item.status === "uploading",
  );
  const hasSelected = items.some((item) => item.status === "selected");

  useEffect(() => {
    onBusyChange?.(busy);
    if (wasBusy.current && !busy) {
      onAllSettled?.();
    }
    wasBusy.current = busy;
  }, [busy, onAllSettled, onBusyChange]);
  useEffect(
    () => () => {
      for (const url of previewUrls.current) {
        URL.revokeObjectURL(url);
      }
    },
    [],
  );

  const updateItem = useCallback((id: string, updates: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    );
  }, []);

  const uploadItem = useCallback(
    async (item: UploadItem) => {
      updateItem(item.id, { status: "uploading", error: null });
      try {
        const bookmark = await createImage(item.file);
        updateItem(item.id, { status: "success" });
        onUploaded(bookmark);
      } catch (error) {
        updateItem(item.id, {
          status: "failed",
          error: error instanceof Error ? error.message : "업로드하지 못했어요",
        });
      }
    },
    [onUploaded, updateItem],
  );

  useEffect(() => {
    const activeCount = items.filter(
      (item) => item.status === "uploading",
    ).length;
    const available = Math.max(0, 2 - activeCount);
    for (const item of items
      .filter((candidate) => candidate.status === "queued")
      .slice(0, available)) {
      void uploadItem(item);
    }
  }, [items, uploadItem]);

  const enqueue = useCallback(
    (files: File[]) => {
      const entries = files
        .filter((file) => file.type.startsWith("image/"))
        .map((file) => {
          const previewUrl = URL.createObjectURL(file);
          previewUrls.current.add(previewUrl);
          return {
            id: crypto.randomUUID(),
            file,
            previewUrl,
            status: "selected" as const,
            error: null,
          };
        });
      if (entries.length === 0) {
        return;
      }
      setItems((current) => [...current, ...entries]);
      onSelectionChange?.();
    },
    [onSelectionChange],
  );

  function startSelectedUploads() {
    setItems((current) =>
      current.map((item) =>
        item.status === "selected" ? { ...item, status: "queued" } : item,
      ),
    );
  }

  useEffect(() => {
    if (initialFilesQueued.current || !initialFiles?.length) {
      return;
    }
    initialFilesQueued.current = true;
    enqueue(initialFiles);
  }, [enqueue, initialFiles]);

  function removeItem(item: UploadItem) {
    URL.revokeObjectURL(item.previewUrl);
    previewUrls.current.delete(item.previewUrl);
    setItems((current) =>
      current.filter((candidate) => candidate.id !== item.id),
    );
  }

  return (
    <div className="space-y-3">
      <label
        className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 px-5 text-center transition hover:border-blue-400 hover:bg-blue-50/40 dark:border-zinc-700 dark:bg-zinc-900/60"
        data-testid="image-drop-zone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          enqueue(Array.from(event.dataTransfer.files));
        }}
        onPaste={(event) => enqueue(Array.from(event.clipboardData.files))}
      >
        <ImagePlus className="h-8 w-8 text-blue-500" />
        <span className="mt-3 text-sm font-semibold">
          이미지를 선택하거나 놓으세요
        </span>
        <span className="mt-1 text-xs text-zinc-500">
          클립보드 붙여넣기 가능 · 파일당 최대 20MB
        </span>
        <input
          accept="image/*"
          aria-label="이미지 선택"
          className="sr-only"
          multiple
          onChange={(event) => enqueue(Array.from(event.target.files ?? []))}
          type="file"
        />
      </label>

      {items.length > 0 ? (
        <ul className="space-y-2" aria-label="이미지 업로드 목록">
          {items.map((item) => (
            <li
              className="flex items-center gap-3 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800"
              key={item.id}
            >
              <img
                alt=""
                className="h-12 w-12 rounded-lg object-cover"
                src={item.previewUrl}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.file.name}</p>
                <p className="text-xs text-zinc-500">
                  {item.status === "selected" ? "선택됨" : null}
                  {item.status === "queued" ? "대기 중" : null}
                  {item.status === "uploading" ? "업로드 중…" : null}
                  {item.status === "success" ? "완료" : null}
                  {item.status === "failed" ? item.error : null}
                </p>
              </div>
              {item.status === "failed" ? (
                <button
                  className="icon-button"
                  onClick={() =>
                    updateItem(item.id, { status: "queued", error: null })
                  }
                  type="button"
                >
                  <RefreshCcw className="h-4 w-4" />
                  <span className="sr-only">다시 시도</span>
                </button>
              ) : null}
              {item.status !== "uploading" && item.status !== "queued" ? (
                <button
                  aria-label={`${item.file.name} 제거`}
                  className="icon-button"
                  onClick={() => removeItem(item)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <button
        aria-label="이미지 저장"
        className="btn-primary w-full"
        disabled={!hasSelected || busy}
        onClick={startSelectedUploads}
        type="button"
      >
        {busy ? "저장 중…" : "이미지 저장"}
      </button>
    </div>
  );
}
