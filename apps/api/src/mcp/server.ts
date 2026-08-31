import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  type BookmarkListQuery,
  bookmarkListQuerySchema,
  uuidSchema,
} from "@my-bookmark/shared";
import { HttpError } from "../middleware/error";
import {
  type BookmarkListResult,
  getBookmarkForUser,
  listBookmarksForUser,
} from "../routes/bookmarks";
import { listCategoriesForUser } from "../routes/categories";

export interface McpServerDeps {
  listBookmarks: (
    userId: string,
    query: BookmarkListQuery,
  ) => Promise<BookmarkListResult>;
  getBookmark?: typeof getBookmarkForUser;
  listCategories?: typeof listCategoriesForUser;
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

function toolError(error: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text:
          error instanceof HttpError
            ? error.message
            : "북마크 검색에 실패했습니다",
      },
    ],
    isError: true,
  };
}

export function buildMcpServer(
  userId: string,
  deps: McpServerDeps = { listBookmarks: listBookmarksForUser },
): McpServer {
  const server = new McpServer({
    name: "my-bookmark",
    version: "1.0.0",
  });
  const getBookmark = deps.getBookmark ?? getBookmarkForUser;
  const listCategories = deps.listCategories ?? listCategoriesForUser;

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
        return toolError(error);
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
        return jsonToolResult(await getBookmark(userId, id));
      } catch (error) {
        return toolError(error);
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
          await listCategories({ userId, withCounts: false }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}
