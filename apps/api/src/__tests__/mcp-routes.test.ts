import { API_ERROR_CODES } from "@my-bookmark/shared";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOOKMARK_DB_COLUMNS } from "../lib/db-mappers";
import { buildMcpServer } from "../mcp/server";
import { errorMiddleware, HttpError } from "../middleware/error";
import { getBookmarkForUser } from "../routes/bookmarks";
import { createMcpRouter, type McpRouterDeps } from "../routes/mcp";

const userId = "11111111-1111-4111-8111-111111111111";
const bookmarkId = "22222222-2222-4222-8222-222222222222";
const missingBookmarkId = "33333333-3333-4333-8333-333333333333";
const otherUserBookmarkId = "44444444-4444-4444-8444-444444444444";
const categoryId = "55555555-5555-4555-8555-555555555555";
const accept = "application/json, text/event-stream";
const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

const fake = vi.hoisted(() => ({
  createBookmark: vi.fn(),
  databaseFrom: vi.fn(),
  getBookmark: vi.fn(),
  listBookmarks: vi.fn(),
  listCategories: vi.fn(),
  searchSemanticBookmarks: vi.fn(),
  verifyApiKey: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabaseAdmin: { from: fake.databaseFrom },
}));

function createTestApp(
  getBookmark: typeof getBookmarkForUser = fake.getBookmark,
) {
  const deps: McpRouterDeps = {
    apiKeyVerifier: fake.verifyApiKey,
    buildServer: (authenticatedUserId) =>
      buildMcpServer(authenticatedUserId, {
        createBookmark: fake.createBookmark,
        getBookmark,
        listBookmarks: fake.listBookmarks,
        searchSemanticBookmarks: fake.searchSemanticBookmarks,
        listCategories: fake.listCategories,
      }),
  };
  const app = express();
  app.use(express.json());
  app.use("/api", createMcpRouter(deps));
  app.use(errorMiddleware);
  return app;
}

async function postMcp(
  app: express.Express,
  body: Record<string, unknown>,
  apiKey = "bm_test",
) {
  return request(app)
    .post("/api/mcp")
    .set("Accept", accept)
    .set("X-API-Key", apiKey)
    .send(body);
}

beforeEach(() => {
  fake.createBookmark.mockReset();
  fake.createBookmark.mockResolvedValue({
    id: bookmarkId,
    userId,
    kind: "link",
    title: "New bookmark",
  });
  fake.databaseFrom.mockReset();
  fake.verifyApiKey.mockReset();
  fake.verifyApiKey.mockResolvedValue(userId);
  fake.getBookmark.mockReset();
  fake.getBookmark.mockResolvedValue({
    id: bookmarkId,
    userId,
    kind: "link",
    title: "Design systems",
  });
  fake.listBookmarks.mockReset();
  fake.listBookmarks.mockResolvedValue({
    bookmarks: [],
    nextCursor: null,
  });
  fake.searchSemanticBookmarks.mockReset();
  fake.searchSemanticBookmarks.mockResolvedValue({
    bookmarks: [],
    nextCursor: null,
  });
  fake.listCategories.mockReset();
  fake.listCategories.mockResolvedValue([
    { id: categoryId, userId, name: "Design", sortOrder: 0 },
  ]);
});

describe("MCP search route", () => {
  it("rejects requests without an API key", async () => {
    const response = await request(createTestApp())
      .post("/api/mcp")
      .set("Accept", accept)
      .send(initializeRequest);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 for an invalid API key", async () => {
    fake.verifyApiKey.mockRejectedValueOnce(
      new HttpError(401, API_ERROR_CODES.UNAUTHORIZED, "Invalid API key"),
    );

    const response = await postMcp(createTestApp(), initializeRequest);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 for a JWT-shaped bearer token", async () => {
    const response = await request(createTestApp())
      .post("/api/mcp")
      .set("Accept", accept)
      .set("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.token.signature")
      .send(initializeRequest);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(fake.verifyApiKey).not.toHaveBeenCalled();
  });

  it("accepts a bm API key in Authorization and prefers X-API-Key", async () => {
    const response = await postMcp(createTestApp(), initializeRequest);

    expect(response.status).toBe(200);
    expect(fake.verifyApiKey).toHaveBeenCalledWith("bm_test");

    fake.verifyApiKey.mockClear();
    const bearerResponse = await request(createTestApp())
      .post("/api/mcp")
      .set("Accept", accept)
      .set("Authorization", "Bearer bm_bearer")
      .send(initializeRequest);

    expect(bearerResponse.status).toBe(200);
    expect(fake.verifyApiKey).toHaveBeenCalledWith("bm_bearer");
  });

  it("initializes in stateless JSON mode without a session id", async () => {
    const response = await postMcp(createTestApp(), initializeRequest);

    expect(response.status).toBe(200);
    expect(response.body.result.serverInfo.name).toBe("my-bookmark");
    expect(response.headers["mcp-session-id"]).toBeUndefined();
  });

  it("lists the search and read tools", async () => {
    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    expect(response.status).toBe(200);
    expect(response.body.result.tools).toHaveLength(4);
    expect(
      response.body.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual([
      "search_bookmarks",
      "get_bookmark",
      "add_bookmark",
      "list_categories",
    ]);
    const searchTool = response.body.result.tools.find(
      (tool: {
        name: string;
        inputSchema?: {
          properties?: Record<string, { type?: string }>;
        };
      }) => tool.name === "search_bookmarks",
    );
    expect(searchTool?.inputSchema?.properties?.semantic).toMatchObject({
      type: "boolean",
    });
  });

  it("calls search_bookmarks through the injected read service by default", async () => {
    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "search_bookmarks",
        arguments: { q: "design", limit: 10 },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result.isError).toBeUndefined();
    expect(JSON.parse(response.body.result.content[0].text)).toEqual({
      bookmarks: [],
      nextCursor: null,
    });
    expect(fake.listBookmarks).toHaveBeenCalledWith(userId, {
      q: "design",
      limit: 10,
    });
    expect(fake.searchSemanticBookmarks).not.toHaveBeenCalled();
  });

  it("uses the partial-match service when semantic is false", async () => {
    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "search_bookmarks",
        arguments: { q: "design", semantic: false },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result.isError).toBeUndefined();
    expect(fake.listBookmarks).toHaveBeenCalledWith(userId, {
      q: "design",
      limit: 30,
    });
    expect(fake.searchSemanticBookmarks).not.toHaveBeenCalled();
  });

  it("uses the semantic service when semantic is true", async () => {
    fake.searchSemanticBookmarks.mockResolvedValueOnce({
      bookmarks: [{ id: bookmarkId, title: "Cooking" }],
      nextCursor: null,
    });

    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "search_bookmarks",
        arguments: { q: "요리 관련", semantic: true, limit: 7 },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result.isError).toBeUndefined();
    expect(JSON.parse(response.body.result.content[0].text)).toEqual({
      bookmarks: [{ id: bookmarkId, title: "Cooking" }],
      nextCursor: null,
    });
    expect(fake.searchSemanticBookmarks).toHaveBeenCalledWith(userId, {
      q: "요리 관련",
      limit: 7,
    });
    expect(fake.listBookmarks).not.toHaveBeenCalled();
  });

  it("rejects filters that semantic search cannot apply", async () => {
    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 34,
      method: "tools/call",
      params: {
        name: "search_bookmarks",
        arguments: {
          q: "요리",
          semantic: true,
          categoryId: "none",
          cursor: "abc",
          kind: "image",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result.isError).toBe(true);
    expect(response.body.result.content[0].text).toContain(
      "semantic search cannot be combined",
    );
    expect(fake.searchSemanticBookmarks).not.toHaveBeenCalled();
    expect(fake.listBookmarks).not.toHaveBeenCalled();
  });

  it("converts a missing semantic provider to an MCP error result", async () => {
    fake.searchSemanticBookmarks.mockRejectedValueOnce(
      new HttpError(
        500,
        API_ERROR_CODES.INTERNAL,
        "Semantic search is not configured",
      ),
    );

    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: {
        name: "search_bookmarks",
        arguments: { q: "요리 관련", semantic: true },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Semantic search is not configured" }],
    });
    expect(fake.listBookmarks).not.toHaveBeenCalled();
  });

  it("gets a bookmark through the injected read service", async () => {
    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_bookmark",
        arguments: { id: bookmarkId },
      },
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body.result.content[0].text)).toMatchObject({
      id: bookmarkId,
      title: "Design systems",
    });
    expect(fake.getBookmark).toHaveBeenCalledWith(userId, bookmarkId);
  });

  it("adds a bookmark through the injected AI creation service", async () => {
    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "add_bookmark",
        arguments: { url: "https://example.com/new-bookmark" },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result.isError).toBeUndefined();
    expect(JSON.parse(response.body.result.content[0].text)).toMatchObject({
      id: bookmarkId,
      title: "New bookmark",
    });
    expect(fake.createBookmark).toHaveBeenCalledWith({
      userId,
      request: { url: "https://example.com/new-bookmark", mode: "ai" },
    });
  });

  it("returns a normal informational result for a duplicate URL", async () => {
    fake.createBookmark.mockRejectedValueOnce(
      new HttpError(409, API_ERROR_CODES.CONFLICT, "이미 저장된 링크", {
        existingId: bookmarkId,
      }),
    );

    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "add_bookmark",
        arguments: { url: "https://example.com/existing" },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result.isError).toBeUndefined();
    expect(response.body.result.content).toEqual([
      {
        type: "text",
        text: `이미 저장된 북마크입니다. 기존 북마크 ID: ${bookmarkId}`,
      },
    ]);
    expect(fake.createBookmark).toHaveBeenCalledWith({
      userId,
      request: { url: "https://example.com/existing", mode: "ai" },
    });
  });

  it("returns a short informational result when a duplicate has no existing ID", async () => {
    fake.createBookmark.mockRejectedValueOnce(
      new HttpError(409, API_ERROR_CODES.CONFLICT, "이미 저장된 링크", {
        existingId: undefined,
      }),
    );

    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "add_bookmark",
        arguments: { url: "https://example.com/unknown-existing" },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toEqual({
      content: [{ type: "text", text: "이미 저장된 북마크입니다." }],
    });
  });

  it("converts non-conflict HttpError failures to MCP error results", async () => {
    fake.createBookmark.mockRejectedValueOnce(
      new HttpError(
        400,
        API_ERROR_CODES.VALIDATION_ERROR,
        "Bookmark URL is invalid",
      ),
    );

    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "add_bookmark",
        arguments: { url: "https://example.com/rejected" },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Bookmark URL is invalid" }],
    });
  });

  it("lists categories through the injected read service", async () => {
    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "list_categories",
        arguments: {},
      },
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body.result.content[0].text)).toEqual([
      { id: categoryId, userId, name: "Design", sortOrder: 0 },
    ]);
    expect(fake.listCategories).toHaveBeenCalledWith({
      userId,
      withCounts: false,
    });
  });

  it("converts a missing bookmark to an MCP error result instead of HTTP 404", async () => {
    fake.getBookmark.mockRejectedValueOnce(
      new HttpError(404, API_ERROR_CODES.NOT_FOUND, "Bookmark not found"),
    );

    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "get_bookmark",
        arguments: { id: missingBookmarkId },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Bookmark not found" }],
    });
    expect(fake.getBookmark).toHaveBeenCalledWith(userId, missingBookmarkId);
  });

  it("enforces bookmark ownership before returning an MCP error for another user's ID", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const secondEq = vi.fn(() => ({ maybeSingle }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const select = vi.fn(() => ({ eq: firstEq }));
    fake.databaseFrom.mockReturnValue({ select });

    const response = await postMcp(createTestApp(getBookmarkForUser), {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "get_bookmark",
        arguments: { id: otherUserBookmarkId },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Bookmark not found" }],
    });
    expect(fake.databaseFrom).toHaveBeenCalledWith("bookmarks");
    expect(select).toHaveBeenCalledWith(BOOKMARK_DB_COLUMNS);
    expect(firstEq).toHaveBeenCalledWith("user_id", userId);
    expect(secondEq).toHaveBeenCalledWith("id", otherUserBookmarkId);
    expect(maybeSingle).toHaveBeenCalledWith();
  });

  it("uses tool-specific fallback messages for unexpected read failures", async () => {
    fake.getBookmark.mockRejectedValueOnce(new Error("database failed"));

    const bookmarkResponse = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "get_bookmark",
        arguments: { id: bookmarkId },
      },
    });

    fake.listCategories.mockRejectedValueOnce(new Error("database failed"));
    const categoryResponse = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "list_categories",
        arguments: {},
      },
    });

    fake.createBookmark.mockRejectedValueOnce(new Error("database failed"));
    const addResponse = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "add_bookmark",
        arguments: { url: "https://example.com/failure" },
      },
    });

    expect(bookmarkResponse.body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "북마크 조회에 실패했습니다" }],
    });
    expect(categoryResponse.body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "카테고리 조회에 실패했습니다" }],
    });
    expect(addResponse.body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "북마크 등록에 실패했습니다" }],
    });
  });

  it("converts search service failures to MCP error results", async () => {
    fake.listBookmarks.mockRejectedValueOnce(new Error("database failed"));

    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "search_bookmarks",
        arguments: { q: "design" },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "북마크 검색에 실패했습니다" }],
    });
  });

  it("preserves HttpError messages in MCP error results", async () => {
    fake.listBookmarks.mockRejectedValueOnce(
      new HttpError(404, API_ERROR_CODES.NOT_FOUND, "Bookmark not found"),
    );

    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "search_bookmarks",
        arguments: { q: "design" },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Bookmark not found" }],
    });
  });

  it.each([
    "get",
    "delete",
  ] as const)("returns 405 for unauthenticated %s", async (method) => {
    const response = await request(createTestApp())
      [method]("/api/mcp")
      .set("Accept", accept);

    expect(response.status).toBe(405);
    // biome-ignore lint/complexity/useLiteralKeys: supertest exposes IncomingMessage headers through an index signature.
    expect(response.headers["allow"]).toBe("POST");
  });
});
