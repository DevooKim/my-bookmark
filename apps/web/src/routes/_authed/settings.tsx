import {
  AI_MODEL_CATALOG,
  type AiModelId,
  type AiProviderName,
  aiModelIdSchema,
  type CategoryWithCount,
} from "@my-bookmark/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Bell,
  ChevronDown,
  ChevronUp,
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
  deleteAiProviderKey,
  deleteCategory,
  getAiStatus,
  getPushStatus,
  listApiKeys,
  listCategories,
  reorderCategories,
  revokeApiKey,
  saveAiProviderKey,
  selectAiModel,
  sendTestPush,
  testAiProviderConnection,
  updateCategory,
} from "../../lib/api-client";
import { performLogout } from "../../lib/logout";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushSupportStatus,
} from "../../lib/push";

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
  const moveCategory = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) {
      return;
    }
    const ids = items.map((item) => item.id);
    const moved = ids[index];
    const swapped = ids[target];
    if (!moved || !swapped) {
      return;
    }
    ids[index] = swapped;
    ids[target] = moved;
    reorderMutation.mutate(ids);
  };

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

      <div className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((category, index) => (
          <CategoryRow
            category={category}
            isFirst={index === 0}
            isLast={index === items.length - 1}
            key={category.id}
            moving={reorderMutation.isPending}
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
            onMove={(direction) => moveCategory(index, direction)}
            onUpdate={(next) =>
              updateMutation.mutate({ id: category.id, next })
            }
          />
        ))}
      </div>
    </section>
  );
}

function CategoryRow({
  category,
  isFirst,
  isLast,
  moving,
  onMove,
  onUpdate,
  onDelete,
}: {
  category: CategoryWithCount;
  isFirst: boolean;
  isLast: boolean;
  moving: boolean;
  onMove: (direction: -1 | 1) => void;
  onUpdate: (next: Partial<CategoryWithCount>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(category.name);
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[auto_1fr_80px_auto] sm:items-center">
      <div className="flex gap-1">
        <button
          aria-label={`${category.name} 위로 이동`}
          className="icon-button"
          disabled={isFirst || moving}
          onClick={() => onMove(-1)}
          type="button"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          aria-label={`${category.name} 아래로 이동`}
          className="icon-button"
          disabled={isLast || moving}
          onClick={() => onMove(1)}
          type="button"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <input
        className="input"
        onBlur={() => name !== category.name && onUpdate({ name })}
        onChange={(e) => setName(e.target.value)}
        value={name}
      />
      <span className="text-sm text-zinc-500">
        {category.bookmarkCount ?? 0}개
      </span>
      <button
        aria-label="카테고리 삭제"
        className="icon-button text-red-600"
        onClick={onDelete}
        type="button"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
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

const aiProviderLabels: Record<AiProviderName, string> = {
  gemini: "Gemini",
  anthropic: "Anthropic",
  openai: "OpenAI",
};
const aiProviderNames = ["gemini", "anthropic", "openai"] as const;
const emptyAiKeys: Record<AiProviderName, string> = {
  gemini: "",
  anthropic: "",
  openai: "",
};

function getModelConfig(model: AiModelId) {
  const config = AI_MODEL_CATALOG.find((item) => item.model === model);
  if (!config) {
    throw new Error("Unknown AI model");
  }
  return config;
}

export function AiSection() {
  const queryClient = useQueryClient();
  const aiQuery = useQuery({ queryKey: ["ai"], queryFn: getAiStatus });
  const [model, setModel] = useState<AiModelId>("gemini-flash-lite-latest");
  const [apiKeys, setApiKeys] = useState(emptyAiKeys);
  const availableModels = AI_MODEL_CATALOG.filter(
    (item) => aiQuery.data?.providers[item.provider].configured,
  );

  useEffect(() => {
    if (!aiQuery.data) {
      return;
    }
    const activeConfigured =
      aiQuery.data.providers[aiQuery.data.provider].configured;
    const firstAvailable = AI_MODEL_CATALOG.find(
      (item) => aiQuery.data?.providers[item.provider].configured,
    );
    if (activeConfigured) {
      setModel(aiQuery.data.model);
    } else if (firstAvailable) {
      setModel(firstAvailable.model);
    }
  }, [aiQuery.data]);

  const keyMutation = useMutation({
    mutationFn: ({
      provider,
      apiKey,
    }: {
      provider: AiProviderName;
      apiKey: string;
    }) => saveAiProviderKey(provider, { apiKey }),
    onSuccess: (status, variables) => {
      queryClient.setQueryData(["ai"], status);
      setApiKeys((current) => ({ ...current, [variables.provider]: "" }));
      toast.success(
        `${aiProviderLabels[variables.provider]} API 키를 저장했어요`,
      );
    },
    onError: () => toast.error("AI API 키를 저장하지 못했어요"),
  });
  const modelMutation = useMutation({
    mutationFn: () => {
      const selected = getModelConfig(model);
      return selectAiModel({ provider: selected.provider, model });
    },
    onSuccess: (status) => {
      queryClient.setQueryData(["ai"], status);
      toast.success("사용 모델을 저장했어요");
    },
    onError: () => toast.error("사용 모델을 저장하지 못했어요"),
  });
  const testMutation = useMutation({
    mutationFn: (provider: AiProviderName) =>
      testAiProviderConnection(provider),
    onSuccess: (result) => {
      const label = aiProviderLabels[result.provider];
      result.ok
        ? toast.success(`${label} 연결에 성공했어요`)
        : toast.error(`${label} API 키를 확인해 주세요`);
    },
    onError: () => toast.error("연결 테스트를 완료하지 못했어요"),
  });
  const deleteMutation = useMutation({
    mutationFn: (provider: AiProviderName) => deleteAiProviderKey(provider),
    onSuccess: (status) => {
      queryClient.setQueryData(["ai"], status);
      toast.success("AI API 키를 삭제했어요");
    },
    onError: () => toast.error("AI API 키를 삭제하지 못했어요"),
  });

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-bold">AI 분류</h2>
      <p className="mt-1 text-sm text-zinc-500">
        provider API 키를 관리하고, 키가 등록된 provider의 모델을 선택합니다.
      </p>
      {aiQuery.isError ? (
        <p className="mt-3 text-sm text-red-600">
          AI 설정을 불러오지 못했어요.
        </p>
      ) : null}

      <div className="mt-5 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-sm font-semibold">사용 모델</h3>
        {availableModels.length === 0 ? (
          <p className="mt-2 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-500 dark:bg-zinc-950">
            먼저 provider API 키를 등록하세요
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="grid flex-1 gap-1 text-sm">
              사용 모델
              <select
                className="input"
                disabled={modelMutation.isPending}
                onChange={(event) =>
                  setModel(aiModelIdSchema.parse(event.target.value))
                }
                value={model}
              >
                {aiProviderNames.map((provider) => {
                  const models = availableModels.filter(
                    (item) => item.provider === provider,
                  );
                  return models.length > 0 ? (
                    <optgroup key={provider} label={aiProviderLabels[provider]}>
                      {models.map((item) => (
                        <option key={item.model} value={item.model}>
                          {item.label} · {item.tier}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </label>
            <button
              aria-label="모델 저장"
              className="btn-primary justify-center"
              disabled={modelMutation.isPending}
              onClick={() => modelMutation.mutate()}
              type="button"
            >
              모델 저장
            </button>
          </div>
        )}
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold">AI API 키</h3>
        <div className="mt-2 grid gap-3 lg:grid-cols-3">
          {aiProviderNames.map((provider) => {
            const configured =
              aiQuery.data?.providers[provider].configured ?? false;
            const saving =
              keyMutation.isPending &&
              keyMutation.variables?.provider === provider;
            const testing =
              testMutation.isPending && testMutation.variables === provider;
            return (
              <div
                className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                key={provider}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {aiProviderLabels[provider]}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {configured ? "설정됨" : "API 키 필요"}
                  </span>
                </div>
                <label className="mt-3 grid gap-1 text-sm">
                  {aiProviderLabels[provider]} API 키
                  <input
                    autoComplete="off"
                    className="input"
                    maxLength={512}
                    onChange={(event) =>
                      setApiKeys((current) => ({
                        ...current,
                        [provider]: event.target.value,
                      }))
                    }
                    placeholder={
                      configured ? "새 키를 입력하면 교체됩니다" : "API 키 입력"
                    }
                    type="password"
                    value={apiKeys[provider]}
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    aria-label={`${aiProviderLabels[provider]} 키 저장`}
                    className="btn-secondary"
                    disabled={
                      !apiKeys[provider].trim() || keyMutation.isPending
                    }
                    onClick={() =>
                      keyMutation.mutate({
                        provider,
                        apiKey: apiKeys[provider].trim(),
                      })
                    }
                    type="button"
                  >
                    {saving ? "저장 중…" : configured ? "키 교체" : "키 저장"}
                  </button>
                  {configured ? (
                    <>
                      <button
                        aria-label={`${aiProviderLabels[provider]} 연결 테스트`}
                        className="btn-secondary"
                        disabled={
                          testMutation.isPending || deleteMutation.isPending
                        }
                        onClick={() => testMutation.mutate(provider)}
                        type="button"
                      >
                        {testing ? "확인 중…" : "연결 테스트"}
                      </button>
                      <button
                        aria-label={`${aiProviderLabels[provider]} 키 삭제`}
                        className="btn-secondary text-red-600"
                        disabled={
                          testMutation.isPending || deleteMutation.isPending
                        }
                        onClick={() => deleteMutation.mutate(provider)}
                        type="button"
                      >
                        키 삭제
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          연결 테스트는 Models API로 키 인증만 확인하며 추론을 실행하지
          않습니다.
        </p>
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
