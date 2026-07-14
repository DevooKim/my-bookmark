import type { CategoryWithCount } from "@my-bookmark/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bell,
  ChevronRight,
  Copy,
  KeyRound,
  LogOut,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createApiKey,
  createCategory,
  deleteCategory,
  getAiStatus,
  getPushStatus,
  listApiKeys,
  listCategories,
  reorderCategories,
  revokeApiKey,
  sendTestPush,
  testAiConnection,
  updateCategory,
} from "../../lib/api-client";
import { performLogout } from "../../lib/logout";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushSupportStatus,
} from "../../lib/push";
import { SortableList, SortableRow } from "./-components/sortable-list";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <main className="settings-page page-stack">
      <section className="settings-header page-header">
        <div>
          <p className="page-eyebrow">Preferences</p>
          <h1 className="page-title">설정</h1>
          <p className="page-subtitle">
            알림, 분류, 연결과 화면 표시를 내 방식에 맞춥니다.
          </p>
        </div>
      </section>
      <NotificationSection />
      <CategorySection />
      <ApiKeySection />
      <AiSection />
      <ThemeSection />
      <LogoutSection />
    </main>
  );
}

export function LogoutSection() {
  const queryClient = useQueryClient();

  return (
    <section className="p-5">
      <h2 className="font-bold">계정</h2>
      <p className="mt-1 text-sm text-zinc-500">
        이 기기에서 계정 연결을 종료합니다.
      </p>
      <button
        className="btn-secondary mt-4 text-red-600 dark:text-red-400"
        onClick={() => void performLogout(queryClient)}
        type="button"
      >
        <LogOut className="h-4 w-4" /> 로그아웃
      </button>
    </section>
  );
}

function NotificationSection() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["pushStatus"],
    queryFn: getPushStatus,
  });
  const vapidPublicKey = statusQuery.data?.vapidPublicKey ?? null;
  const support = getPushSupportStatus(vapidPublicKey);
  const enableMutation = useMutation({
    mutationFn: async () => {
      if (!vapidPublicKey) {
        throw new Error("missing-vapid-key");
      }
      await enablePushNotifications(vapidPublicKey);
    },
    onSuccess: () => {
      toast.success("알림을 켰어요");
      void queryClient.invalidateQueries({ queryKey: ["pushStatus"] });
    },
    onError: () => toast.error("알림을 켜지 못했어요"),
  });
  const disableMutation = useMutation({
    mutationFn: disablePushNotifications,
    onSuccess: () => {
      toast.success("알림을 껐어요");
      void queryClient.invalidateQueries({ queryKey: ["pushStatus"] });
    },
    onError: () => toast.error("알림을 끄지 못했어요"),
  });
  const testMutation = useMutation({
    mutationFn: sendTestPush,
    onSuccess: (result) => {
      toast.success(
        `테스트 발송: 성공 ${result.sent}건, 실패 ${result.failed}건`,
      );
    },
    onError: () => toast.error("테스트 알림을 보내지 못했어요"),
  });

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">알림</h2>
          <p className="mt-1 text-sm text-zinc-500">
            리마인더 시간에 Web Push 알림을 받습니다. iPhone은 홈 화면에 추가한
            PWA에서만 동작합니다.
          </p>
        </div>
        <Bell className="h-5 w-5 text-zinc-400" />
      </div>
      {support.ok ? null : (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {support.reason === "ios-not-installed"
            ? "iOS에서는 홈 화면에 추가한 뒤 앱 아이콘으로 열어야 알림을 켤 수 있어요."
            : support.reason === "missing-key"
              ? "서버에 VAPID 공개키가 설정되지 않았어요."
              : "이 브라우저는 Web Push를 지원하지 않아요."}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {statusQuery.data?.enabled ? (
          <button
            className="btn-secondary"
            disabled={disableMutation.isPending}
            onClick={() => disableMutation.mutate()}
            type="button"
          >
            알림 끄기
          </button>
        ) : (
          <button
            className="btn-primary"
            disabled={!support.ok || enableMutation.isPending}
            onClick={() => enableMutation.mutate()}
            type="button"
          >
            알림 켜기
          </button>
        )}
        <button
          className="btn-secondary"
          disabled={!statusQuery.data?.enabled || testMutation.isPending}
          onClick={() => testMutation.mutate()}
          type="button"
        >
          테스트 알림 보내기
        </button>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        현재 구독 {statusQuery.data?.subscriptionCount ?? 0}개
      </p>
    </section>
  );
}

export function CategorySection() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["categories"] });
    void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
  };
  const createMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      toast.success("카테고리를 만들었어요");
      setName("");
      invalidate();
    },
    onError: () => toast.error("카테고리를 만들지 못했어요"),
  });
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      next,
    }: {
      id: string;
      next: Partial<CategoryWithCount>;
    }) =>
      updateCategory(id, {
        name: next.name,
      }),
    onSuccess: () => {
      toast.success("카테고리를 수정했어요");
      invalidate();
    },
    onError: () => toast.error("카테고리를 수정하지 못했어요"),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      toast.success("카테고리를 삭제했어요. 소속 북마크는 미분류가 됩니다.");
      invalidate();
    },
    onError: () => toast.error("카테고리를 삭제하지 못했어요"),
  });
  const reorderMutation = useMutation({
    mutationFn: reorderCategories,
    onSuccess: () => invalidate(),
    onError: () => toast.error("순서를 변경하지 못했어요"),
  });
  const items = categoriesQuery.data?.items ?? [];

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-bold">카테고리 관리</h2>
      <form
        className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate({ name });
        }}
      >
        <input
          className="input"
          onChange={(event) => setName(event.target.value)}
          placeholder="새 카테고리 (예: 💻 개발)"
          required
          value={name}
        />
        <button
          className="btn-primary justify-center"
          disabled={createMutation.isPending}
          type="submit"
        >
          <Plus className="h-4 w-4" /> 추가
        </button>
      </form>

      <SortableList
        ids={items.map((item) => item.id)}
        onReorder={(ids) => reorderMutation.mutate(ids)}
      >
        <div className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.map((category) => (
            <CategoryRow
              category={category}
              key={category.id}
              onDelete={() => {
                const count = category.bookmarkCount ?? 0;
                if (
                  window.confirm(
                    `북마크 ${count}개가 미분류가 됩니다. 삭제할까요?`,
                  )
                ) {
                  deleteMutation.mutate(category.id);
                }
              }}
              onUpdate={(next) =>
                updateMutation.mutate({ id: category.id, next })
              }
            />
          ))}
        </div>
      </SortableList>
    </section>
  );
}

function CategoryRow({
  category,
  onUpdate,
  onDelete,
}: {
  category: CategoryWithCount;
  onUpdate: (next: Partial<CategoryWithCount>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(category.name);
  return (
    <SortableRow
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 py-3 sm:grid-cols-[auto_1fr_80px_auto] sm:gap-2"
      handleClassName="row-span-2 sm:row-span-1"
      handleLabel={`${category.name} 순서 변경`}
      id={category.id}
    >
      <input
        className="input col-span-2 min-w-0 sm:col-span-1"
        onBlur={() => name !== category.name && onUpdate({ name })}
        onChange={(e) => setName(e.target.value)}
        value={name}
      />
      <span className="col-start-2 text-sm text-zinc-500 sm:col-start-auto">
        {category.bookmarkCount ?? 0}개
      </span>
      <button
        aria-label="카테고리 삭제"
        className="icon-button col-start-3 row-start-2 text-red-600 sm:col-start-auto sm:row-start-auto"
        onClick={onDelete}
        type="button"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </SortableRow>
  );
}

interface ClipboardCopyDeps {
  writeText: (text: string) => Promise<void>;
  success: (message: string) => void;
  error: (message: string) => void;
}

export async function copyApiKeyToClipboard(
  key: string,
  deps: ClipboardCopyDeps = {
    writeText: (text) => navigator.clipboard.writeText(text),
    success: toast.success,
    error: toast.error,
  },
): Promise<void> {
  try {
    await deps.writeText(key);
    deps.success("복사했어요");
  } catch {
    deps.error("복사하지 못했어요. 직접 선택해서 복사하세요.");
  }
}

function ApiKeySection() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("iOS 단축어");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const apiKeysQuery = useQuery({
    queryKey: ["apiKeys"],
    queryFn: listApiKeys,
  });
  const createMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: (apiKey) => {
      setCreatedKey(apiKey.key);
      toast.success("API 키를 발급했어요. 지금 복사해두세요.");
      void queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
    },
    onError: () => toast.error("API 키를 발급하지 못했어요"),
  });
  const revokeMutation = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      toast.success("API 키를 회수했어요");
      void queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
    },
    onError: () => toast.error("API 키를 회수하지 못했어요"),
  });

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">API 키</h2>
          <p className="mt-1 text-sm text-zinc-500">
            iOS 단축어에서 북마크를 저장할 때 사용합니다. 원문 키는 발급 직후 한
            번만 표시됩니다.
          </p>
        </div>
        <KeyRound className="h-5 w-5 text-zinc-400" />
      </div>

      <form
        className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate({ name });
        }}
      >
        <input
          className="input"
          onChange={(event) => setName(event.target.value)}
          placeholder="키 이름"
          required
          value={name}
        />
        <button
          className="btn-primary justify-center"
          disabled={createMutation.isPending}
          type="submit"
        >
          발급
        </button>
      </form>

      {createdKey ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <p className="font-medium text-amber-900 dark:text-amber-100">
            이 키는 다시 볼 수 없습니다. 지금 복사하세요.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-white p-2 dark:bg-zinc-950">
              {createdKey}
            </code>
            <button
              className="btn-secondary justify-center"
              onClick={() => {
                void copyApiKeyToClipboard(createdKey);
              }}
              type="button"
            >
              <Copy className="h-4 w-4" /> 복사
            </button>
            <button
              className="btn-secondary justify-center"
              onClick={() => setCreatedKey(null)}
              type="button"
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
        {apiKeysQuery.data?.items.map((apiKey) => (
          <div
            className="grid gap-2 py-3 sm:grid-cols-[1fr_120px_170px_auto] sm:items-center"
            key={apiKey.id}
          >
            <div>
              <p className="font-medium">{apiKey.name}</p>
              <p className="text-xs text-zinc-500">
                prefix: {apiKey.keyPrefix}
              </p>
            </div>
            <span className="text-sm text-zinc-500">
              {apiKey.lastUsedAt ? "사용됨" : "미사용"}
            </span>
            <span className="text-xs text-zinc-500">
              {new Date(apiKey.createdAt).toLocaleString()}
            </span>
            <button
              className="btn-secondary justify-center text-red-600"
              onClick={() => {
                if (window.confirm("이 API 키를 회수할까요?")) {
                  revokeMutation.mutate(apiKey.id);
                }
              }}
              type="button"
            >
              회수
            </button>
          </div>
        ))}
        {apiKeysQuery.data?.items.length === 0 ? (
          <p className="py-4 text-sm text-zinc-500">
            발급된 API 키가 없습니다.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function AiSection() {
  const aiQuery = useQuery({ queryKey: ["ai"], queryFn: getAiStatus });
  const testMutation = useMutation({
    mutationFn: testAiConnection,
    onSuccess: (result) =>
      result.ok
        ? toast.success("OpenRouter 연결에 성공했어요")
        : toast.error("OpenRouter 키를 확인해 주세요"),
    onError: () => toast.error("연결 테스트를 완료하지 못했어요"),
  });

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-bold">AI 분류</h2>
      <p className="mt-1 text-sm text-zinc-500">
        분류는 OpenRouter preset이 담당합니다. 모델·폴백·파라미터는
        openrouter.ai 대시보드에서 관리하세요.
      </p>
      {aiQuery.isError ? (
        <p className="mt-3 text-sm text-red-600">
          AI 설정을 불러오지 못했어요.
        </p>
      ) : null}
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <div>
          <p className="text-sm font-medium">
            {aiQuery.data?.preset ?? "@preset/my-bookmark"}
          </p>
          <p className="text-xs text-zinc-500">
            {aiQuery.data?.enabled
              ? "서버에 OpenRouter 키가 설정되어 있어요"
              : "서버 env에 OPEN_ROUTER_API_KEY가 필요해요"}
          </p>
        </div>
        <span
          className={
            aiQuery.data?.enabled
              ? "text-xs text-green-600"
              : "text-xs text-red-600"
          }
        >
          {aiQuery.data?.enabled ? "활성" : "비활성"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          className="btn-secondary"
          disabled={!aiQuery.data?.enabled || testMutation.isPending}
          onClick={() => testMutation.mutate()}
          type="button"
        >
          {testMutation.isPending ? "확인 중…" : "연결 테스트"}
        </button>
        <Link
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600"
          to="/ai-usage"
        >
          사용량 대시보드 <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function ThemeSection() {
  const [theme, setTheme] = useState("system");
  useEffect(() => {
    setTheme(localStorage.getItem("theme") ?? "system");
  }, []);
  function apply(next: string) {
    setTheme(next);
    if (next === "system") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", next);
    }
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    document.documentElement.classList.toggle(
      "dark",
      next === "dark" || (next === "system" && prefersDark),
    );
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        document.documentElement.classList.contains("dark")
          ? "#000000"
          : "#f2f2f7",
      );
  }
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-bold">테마</h2>
      <div className="mt-3 flex gap-2">
        {["system", "light", "dark"].map((item) => (
          <button
            className={theme === item ? "chip-active" : "chip"}
            key={item}
            onClick={() => apply(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
    </section>
  );
}
