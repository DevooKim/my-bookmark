import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  type BookmarkListQuery,
  bookmarkListQuerySchema,
  shareUrlItemSchema,
  uuidSchema,
} from "@my-bookmark/shared";
import { z } from "zod";
import { HttpError } from "../middleware/error";
import {
  type BookmarkListResult,
  createLinkBookmarkForUser,
  getBookmarkForUser,
  listBookmarksForUser,
} from "../routes/bookmarks";
import { listCategoriesForUser } from "../routes/categories";

export interface McpServerDeps {
  listBookmarks: (
    userId: string,
    query: BookmarkListQuery,
  ) => Promise<BookmarkListResult>;
  getBookmark: typeof getBookmarkForUser;
  listCategories: typeof listCategoriesForUser;
  createBookmark: typeof createLinkBookmarkForUser;
}

function jsonToolResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value),
      },
    ],
  };
}

const duplicateDetailsSchema = z.object({
  existingId: uuidSchema.optional(),
});

function duplicateBookmarkResult(error: HttpError): CallToolResult {
  const details = duplicateDetailsSchema.safeParse(error.details).data;
  const existingId = details?.existingId;
  return {
    content: [
      {
        type: "text",
        text: existingId
          ? `이미 저장된 북마크입니다. 기존 북마크 ID: ${existingId}`
          : "이미 저장된 북마크입니다.",
      },
    ],
  };
}

function toolError(error: unknown, fallbackMessage: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: error instanceof HttpError ? error.message : fallbackMessage,
      },
    ],
    isError: true,
  };
}

export function buildMcpServer(
  userId: string,
  deps: McpServerDeps = {
    createBookmark: createLinkBookmarkForUser,
    getBookmark: getBookmarkForUser,
    listBookmarks: listBookmarksForUser,
    listCategories: listCategoriesForUser,
  },
): McpServer {
  const server = new McpServer({
    name: "my-bookmark",
    version: "1.0.0",
  });
  server.registerTool(
    "search_bookmarks",
    {
      description:
        "Search the authenticated user's bookmarks by text, category, kind, or cursor.",
      inputSchema: bookmarkListQuerySchema,
    },
    async (query) => {
      try {
        return jsonToolResult(await deps.listBookmarks(userId, query));
      } catch (error) {
        return toolError(error, "북마크 검색에 실패했습니다");
      }
    },
  );

  server.registerTool(
    "get_bookmark",
    {
      description: "Get one of the authenticated user's bookmarks by ID.",
      inputSchema: { id: uuidSchema },
    },
    async ({ id }: { id: string }) => {
      try {
        return jsonToolResult(await deps.getBookmark(userId, id));
      } catch (error) {
        return toolError(error, "북마크 조회에 실패했습니다");
      }
    },
  );

  server.registerTool(
    "add_bookmark",
    {
      description: "Save a URL as a bookmark using AI categorization.",
      inputSchema: { url: shareUrlItemSchema.shape.item },
    },
    async ({ url }: { url: string }) => {
      try {
        return jsonToolResult(
          await deps.createBookmark({
            userId,
            request: { url, mode: "ai" },
          }),
        );
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) {
          return duplicateBookmarkResult(error);
        }
        return toolError(error, "북마크 등록에 실패했습니다");
      }
    },
  );

  server.registerTool(
    "list_categories",
    {
      description: "List the authenticated user's bookmark categories.",
    },
    async () => {
      try {
        return jsonToolResult(
          await deps.listCategories({ userId, withCounts: false }),
        );
      } catch (error) {
        return toolError(error, "카테고리 조회에 실패했습니다");
      }
    },
  );

  return server;
}
