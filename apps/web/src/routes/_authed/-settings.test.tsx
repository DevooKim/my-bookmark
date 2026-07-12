// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-client", () => ({
  createApiKey: vi.fn(),
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  getAiStatus: vi.fn(),
  listApiKeys: vi.fn(),
  listCategories: vi.fn(),
  reorderCategories: vi.fn(),
  revokeApiKey: vi.fn(),
  testAiConnection: vi.fn(),
  updateCategory: vi.fn(),
}));
vi.mock("../../lib/logout", () => ({ performLogout: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: (props: {
      to: string;
      className?: string;
      children?: React.ReactNode;
    }) => (
      <a className={props.className} href={props.to}>
        {props.children}
      </a>
    ),
  };
});

import {
  getAiStatus,
  listCategories,
  reorderCategories,
  testAiConnection,
} from "../../lib/api-client";
import { performLogout } from "../../lib/logout";
import {
  AiSection,
  CategorySection,
  copyApiKeyToClipboard,
  LogoutSection,
} from "./settings";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const aiStatus = {
  enabled: true,
  preset: "@preset/my-bookmark",
};

function renderAiSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AiSection />
    </QueryClientProvider>,
  );
}

it("logs out from the bottom of settings", () => {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <LogoutSection />
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

  expect(performLogout).toHaveBeenCalledWith(queryClient);
});

describe("AI settings", () => {
  it("shows the preset name and an active status", async () => {
    vi.mocked(getAiStatus).mockResolvedValue(aiStatus);
    renderAiSection();

    expect(await screen.findByText("활성")).toBeTruthy();
    expect(screen.getByText("@preset/my-bookmark")).toBeTruthy();
    expect(
      screen.getByText("서버에 OpenRouter 키가 설정되어 있어요"),
    ).toBeTruthy();
  });

  it("shows a disabled status when the server key is missing", async () => {
    vi.mocked(getAiStatus).mockResolvedValue({
      enabled: false,
      preset: "@preset/my-bookmark",
    });
    renderAiSection();

    expect(await screen.findByText("비활성")).toBeTruthy();
    expect(
      screen.getByText("서버 env에 OPEN_ROUTER_API_KEY가 필요해요"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "연결 테스트" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("links to the AI usage dashboard", async () => {
    vi.mocked(getAiStatus).mockResolvedValue(aiStatus);
    renderAiSection();

    const link = await screen.findByRole("link", {
      name: /사용량 대시보드/,
    });
    expect(link.getAttribute("href")).toBe("/ai-usage");
  });

  it("tests the OpenRouter connection and shows a success toast", async () => {
    vi.mocked(getAiStatus).mockResolvedValue(aiStatus);
    vi.mocked(testAiConnection).mockResolvedValue({ ok: true });
    renderAiSection();

    await screen.findByText("활성");
    fireEvent.click(screen.getByRole("button", { name: "연결 테스트" }));

    await waitFor(() => expect(testAiConnection).toHaveBeenCalled());
  });
});

describe("copyApiKeyToClipboard", () => {
  it("reports success only after the clipboard write resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const success = vi.fn();
    const error = vi.fn();

    await copyApiKeyToClipboard("bm_secret", { writeText, success, error });

    expect(writeText).toHaveBeenCalledWith("bm_secret");
    expect(success).toHaveBeenCalledWith("복사했어요");
    expect(error).not.toHaveBeenCalled();
  });

  it("reports copy failures instead of claiming success", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const success = vi.fn();
    const error = vi.fn();

    await copyApiKeyToClipboard("bm_secret", { writeText, success, error });

    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "복사하지 못했어요. 직접 선택해서 복사하세요.",
    );
  });
});

describe("category ordering", () => {
  const categories = {
    items: [
      {
        id: "00000000-0000-4000-8000-00000000000a",
        userId: "00000000-0000-4000-8000-000000000002",
        name: "💻 개발",
        sortOrder: 0,
        createdAt: "2026-07-12T00:00:00.000Z",
        bookmarkCount: 2,
      },
      {
        id: "00000000-0000-4000-8000-00000000000b",
        userId: "00000000-0000-4000-8000-000000000002",
        name: "📰 뉴스",
        sortOrder: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
        bookmarkCount: 1,
      },
    ],
  };

  function renderCategorySection() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <CategorySection />
      </QueryClientProvider>,
    );
  }

  it("moves a category up by sending the full reordered id list", async () => {
    vi.mocked(listCategories).mockResolvedValue(categories);
    vi.mocked(reorderCategories).mockResolvedValue(categories);
    renderCategorySection();

    fireEvent.click(
      await screen.findByRole("button", { name: "📰 뉴스 위로 이동" }),
    );

    await waitFor(() => expect(reorderCategories).toHaveBeenCalled());
    expect(vi.mocked(reorderCategories).mock.calls[0]?.[0]).toEqual([
      "00000000-0000-4000-8000-00000000000b",
      "00000000-0000-4000-8000-00000000000a",
    ]);
  });

  it("disables boundary move buttons", async () => {
    vi.mocked(listCategories).mockResolvedValue(categories);
    renderCategorySection();

    const firstUp = await screen.findByRole<HTMLButtonElement>("button", {
      name: "💻 개발 위로 이동",
    });
    const lastDown = screen.getByRole<HTMLButtonElement>("button", {
      name: "📰 뉴스 아래로 이동",
    });
    expect(firstUp.disabled).toBe(true);
    expect(lastDown.disabled).toBe(true);
  });

  it("renders a drag handle for each category row", async () => {
    vi.mocked(listCategories).mockResolvedValue(categories);
    renderCategorySection();

    expect(
      await screen.findByRole("button", { name: "💻 개발 순서 변경" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "📰 뉴스 순서 변경" }),
    ).toBeTruthy();
  });
});
