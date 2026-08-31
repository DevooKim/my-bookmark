import { API_ERROR_CODES } from "@my-bookmark/shared";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMcpServer } from "../mcp/server";
import { errorMiddleware, HttpError } from "../middleware/error";
import { createMcpRouter, type McpRouterDeps } from "../routes/mcp";

const userId = "11111111-1111-4111-8111-111111111111";
const missingBookmarkId = "22222222-2222-4222-8222-222222222222";
const otherUserBookmarkId = "33333333-3333-4333-8333-333333333333";
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
  getBookmark: vi.fn(),
  listBookmarks: vi.fn(),
  listCategories: vi.fn(),
  verifyApiKey: vi.fn(),
}));

function createTestApp() {
  const deps: McpRouterDeps = {
    apiKeyVerifier: fake.verifyApiKey,
    buildServer: (authenticatedUserId) =>
      buildMcpServer(authenticatedUserId, {
        getBookmark: fake.getBookmark,
        listBookmarks: fake.listBookmarks,
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
  fake.verifyApiKey.mockReset();
  fake.verifyApiKey.mockResolvedValue(userId);
  fake.getBookmark.mockReset();
  fake.getBookmark.mockResolvedValue({
    id: userId,
    userId,
    kind: "link",
    title: "Design systems",
  });
  fake.listBookmarks.mockReset();
  fake.listBookmarks.mockResolvedValue({
    bookmarks: [],
    nextCursor: null,
  });
  fake.listCategories.mockReset();
  fake.listCategories.mockResolvedValue([
    { id: userId, userId, name: "Design", sortOrder: 0 },
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

  it("lists only the search_bookmarks tool", async () => {
    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    expect(response.status).toBe(200);
    expect(response.body.result.tools).toHaveLength(3);
    expect(
      response.body.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(["search_bookmarks", "get_bookmark", "list_categories"]);
  });

  it("calls search_bookmarks through the injected read service", async () => {
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
  });

  it("gets a bookmark through the injected read service", async () => {
    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_bookmark",
        arguments: { id: userId },
      },
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body.result.content[0].text)).toMatchObject({
      id: userId,
      title: "Design systems",
    });
    expect(fake.getBookmark).toHaveBeenCalledWith(userId, userId);
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
      { id: userId, userId, name: "Design", sortOrder: 0 },
    ]);
    expect(fake.listCategories).toHaveBeenCalledWith({
      userId,
      withCounts: false,
    });
  });

  it.each([
    { caseName: "missing", id: missingBookmarkId },
    { caseName: "owned by another user", id: otherUserBookmarkId },
  ])("converts $caseName bookmark to an MCP error result instead of HTTP 404", async ({
    id,
  }) => {
    fake.getBookmark.mockRejectedValueOnce(
      new HttpError(404, API_ERROR_CODES.NOT_FOUND, "Bookmark not found"),
    );

    const response = await postMcp(createTestApp(), {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "get_bookmark",
        arguments: { id },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Bookmark not found" }],
    });
    expect(fake.getBookmark).toHaveBeenCalledWith(userId, id);
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
