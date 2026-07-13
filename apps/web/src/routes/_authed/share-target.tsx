import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ImagePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { deleteSharedImages, loadSharedImages } from "../../lib/share-target";
import { ImageUpload } from "./-components/image-upload";

interface ShareTargetSearch {
  id?: string;
}

export const Route = createFileRoute("/_authed/share-target")({
  validateSearch: (search): ShareTargetSearch => {
    const id = Reflect.get(search, "id");
    return typeof id === "string" && id.length > 0 ? { id } : {};
  },
  component: ShareTargetPage,
});

function ShareTargetPage() {
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) {
      setError("공유된 이미지 묶음을 찾지 못했어요.");
      return;
    }
    let active = true;
    void loadSharedImages(id)
      .then((staged) => {
        if (!active) {
          return;
        }
        if (!staged?.length) {
          setError("공유된 이미지가 만료되었거나 이미 처리되었어요.");
          return;
        }
        setFiles(staged);
      })
      .catch(() => {
        if (active) {
          setError("공유된 이미지를 불러오지 못했어요.");
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function discardAndLeave() {
    if (busy) {
      return;
    }
    if (id) {
      await deleteSharedImages(id);
    }
    await navigate({ to: "/" });
  }

  return (
    <main className="page-stack">
      <section className="page-header">
        <div>
          <p className="page-eyebrow">Shared images</p>
          <h1 className="page-title">공유한 이미지 저장</h1>
          <p className="page-subtitle">
            이미지마다 별도 항목으로 저장하고 AI 분석을 시작합니다.
          </p>
        </div>
      </section>

      {error ? (
        <section className="empty-state">
          <ImagePlus className="mx-auto h-10 w-10 text-zinc-400" />
          <p className="mt-4 font-semibold">{error}</p>
          <a className="btn-secondary mx-auto mt-4" href="/">
            목록으로
          </a>
        </section>
      ) : null}

      {files ? (
        <section className="surface p-5">
          <ImageUpload
            initialFiles={files}
            onAllSettled={() => {
              if (id) {
                void deleteSharedImages(id);
              }
              setSettled(true);
            }}
            onBusyChange={setBusy}
            onUploaded={() => {
              void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
              void queryClient.invalidateQueries({ queryKey: ["categories"] });
            }}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => void discardAndLeave()}
              type="button"
            >
              {settled ? "목록으로" : "취소"}
            </button>
            {settled ? (
              <button
                className="btn-primary"
                onClick={() => {
                  toast.success("공유 이미지를 처리했어요");
                  void navigate({ to: "/" });
                }}
                type="button"
              >
                완료
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {!files && !error ? (
        <p className="py-12 text-center text-zinc-500">
          공유 이미지를 준비하는 중…
        </p>
      ) : null}
    </main>
  );
}
