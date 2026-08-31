import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  type BookmarkListQuery,
  bookmarkListQuerySchema,
} from "@my-bookmark/shared";
import { HttpError } from "../middleware/error";
import {
  type BookmarkListResult,
  listBookmarksForUser,
} from "../routes/bookmarks";

export interface McpServerDeps {
  listBookmarks: (
    userId: string,
    query: BookmarkListQuery,
  ) => Promise<BookmarkListResult>;
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

  server.registerTool(
    "search_bookmarks",
    {
      description:
        "Search the authenticated user's bookmarks by text, category, kind, or cursor.",
      inputSchema: bookmarkListQuerySchema,
    },
    async (query) => {
      try {
        const result = await deps.listBookmarks(userId, query);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}
