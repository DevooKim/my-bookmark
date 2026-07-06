import {
  type CategoryWithCount,
  categoryColorSchema,
} from "@my-bookmark/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createCategory,
  deleteCategory,
  getAiStatus,
  listCategories,
  updateCategory,
} from "../../lib/api-client";

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
      <CategorySection />
      <AiSection />
      <ThemeSection />
    </main>
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

function AiSection() {
  const aiQuery = useQuery({ queryKey: ["ai"], queryFn: getAiStatus });
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-bold">AI 분류</h2>
      <p className="mt-2 text-sm text-zinc-500">
        현재 provider: {aiQuery.data?.provider ?? "불러오는 중…"}
      </p>
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
