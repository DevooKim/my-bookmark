import {
  AI_MODEL_CATALOG,
  type AiModelId,
  type AiProviderName,
  aiModelIdSchema,
  type CategoryWithCount,
  categoryColorSchema,
} from "@my-bookmark/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
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
  revokeApiKey,
  sendTestPush,
  testAiProviderConnection,
  updateAiSettings,
  updateCategory,
} from "../../lib/api-client";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushSupportStatus,
} from "../../lib/push";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsPage,
});

const colors = categoryColorSchema.options;

function SettingsPage() {
  return (
    <main className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold">설정</h1>
        <p className="mt-1 text-sm text-zinc-500">
          카테고리와 테마를 관리합니다.
        </p>
      </section>
      <NotificationSection />
      <CategorySection />
      <ApiKeySection />
      <AiSection />
      <ThemeSection />
    </main>
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

function CategorySection() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState<(typeof colors)[number] | null>("blue");
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
        color: next.color,
        sortOrder: next.sortOrder,
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

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-bold">카테고리 관리</h2>
      <form
        className="mt-4 grid gap-2 sm:grid-cols-[1fr_160px_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate({ name, color });
        }}
      >
        <input
          className="input"
          onChange={(event) => setName(event.target.value)}
          placeholder="새 카테고리"
          required
          value={name}
        />
        <select
          className="input"
          onChange={(event) =>
            setColor(event.target.value as (typeof colors)[number])
          }
          value={color ?? "blue"}
        >
          {colors.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button
          className="btn-primary justify-center"
          disabled={createMutation.isPending}
          type="submit"
        >
          <Plus className="h-4 w-4" /> 추가
        </button>
      </form>

      <div className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
        {categoriesQuery.data?.items.map((category) => (
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
  const [color, setColor] = useState(category.color ?? "blue");
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[1fr_140px_80px_auto] sm:items-center">
      <input
        className="input"
        onBlur={() => name !== category.name && onUpdate({ name })}
        onChange={(e) => setName(e.target.value)}
        value={name}
      />
      <select
        className="input"
        onBlur={() => color !== category.color && onUpdate({ color })}
        onChange={(e) => setColor(e.target.value as typeof color)}
        value={color}
      >
        {colors.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
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
  const [apiKey, setApiKey] = useState("");
  const selectedModel = getModelConfig(model);
  const provider = selectedModel.provider;

  useEffect(() => {
    if (aiQuery.data) {
      setModel(aiQuery.data.model);
    }
  }, [aiQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateAiSettings({
        provider,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      }),
    onSuccess: (status) => {
      queryClient.setQueryData(["ai"], status);
      setApiKey("");
      toast.success("AI 설정을 저장했어요");
    },
    onError: () => toast.error("AI 설정을 저장하지 못했어요"),
  });
  const testMutation = useMutation({
    mutationFn: (name: AiProviderName) => testAiProviderConnection(name),
    onSuccess: (result) => {
      const label = aiProviderLabels[result.provider];
      if (result.ok) {
        toast.success(`${label} 연결에 성공했어요`);
      } else {
        toast.error(`${label} API 키를 확인해 주세요`);
      }
    },
    onError: () => toast.error("연결 테스트를 완료하지 못했어요"),
  });
  const deleteMutation = useMutation({
    mutationFn: (name: AiProviderName) => deleteAiProviderKey(name),
    onSuccess: (status) => {
      queryClient.setQueryData(["ai"], status);
      toast.success("AI API 키를 삭제했어요");
    },
    onError: () => toast.error("AI API 키를 삭제하지 못했어요"),
  });
  const selectedConfigured =
    aiQuery.data?.providers[provider].configured ?? false;
  const controlsPending = saveMutation.isPending || deleteMutation.isPending;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-bold">AI 분류</h2>
      <p className="mt-1 text-sm text-zinc-500">
        자동 분류 모델과 provider별 API 키를 관리합니다. 저장된 키는 다시
        표시되지 않습니다.
      </p>
      {aiQuery.isError ? (
        <p className="mt-3 text-sm text-red-600">
          AI 설정을 불러오지 못했어요.
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,18rem)_1fr_auto] sm:items-end">
        <label className="grid gap-1 text-sm font-medium">
          AI 모델
          <select
            className="input"
            disabled={controlsPending}
            onChange={(event) =>
              setModel(aiModelIdSchema.parse(event.target.value))
            }
            value={model}
          >
            {aiProviderNames.map((name) => (
              <optgroup key={name} label={aiProviderLabels[name]}>
                {AI_MODEL_CATALOG.filter((item) => item.provider === name).map(
                  (item) => {
                    const configured =
                      aiQuery.data?.providers[name].configured ?? false;
                    return (
                      <option key={item.model} value={item.model}>
                        {item.label} · {item.tier}
                        {configured ? "" : " · API 키 필요"}
                      </option>
                    );
                  },
                )}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {aiProviderLabels[provider]} API 키
          <input
            autoComplete="off"
            className="input"
            maxLength={512}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              selectedConfigured ? "새 키를 입력하면 교체됩니다" : "API 키 입력"
            }
            type="password"
            value={apiKey}
          />
        </label>
        <button
          aria-label="AI 설정 저장"
          className="btn-primary justify-center"
          disabled={controlsPending}
          onClick={() => saveMutation.mutate()}
          type="button"
        >
          저장
        </button>
      </div>
      <div className="mt-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {aiProviderNames.map((name) => {
          const configured = aiQuery.data?.providers[name].configured ?? false;
          const testing =
            testMutation.isPending && testMutation.variables === name;
          return (
            <div
              className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"
              key={name}
            >
              <div className="text-sm">
                <span className="font-medium">{aiProviderLabels[name]}</span>
                <span className="ml-2 text-zinc-500">
                  {configured ? "설정됨" : "API 키 필요"}
                </span>
              </div>
              {configured ? (
                <div className="flex items-center gap-3">
                  <button
                    aria-label={`${aiProviderLabels[name]} 연결 테스트`}
                    className="text-sm text-blue-600 disabled:opacity-50"
                    disabled={controlsPending || testMutation.isPending}
                    onClick={() => testMutation.mutate(name)}
                    type="button"
                  >
                    {testing ? "확인 중…" : "연결 테스트"}
                  </button>
                  <button
                    aria-label={`${aiProviderLabels[name]} 키 삭제`}
                    className="text-sm text-red-600 disabled:opacity-50"
                    disabled={controlsPending || testMutation.isPending}
                    onClick={() => deleteMutation.mutate(name)}
                    type="button"
                  >
                    키 삭제
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        연결 테스트는 Models API로 키 인증만 확인하며 추론을 실행하지 않습니다.
      </p>
      {aiQuery.data && !aiQuery.data.enabled ? (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
          선택한 provider의 API 키를 함께 입력해 저장하세요.
        </p>
      ) : null}
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
