import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  API_ERROR_CODES,
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
  searchSemanticBookmarksForUser,
} from "../routes/bookmarks";
import { listCategoriesForUser } from "../routes/categories";

const mcpSearchBookmarksInputSchema = bookmarkListQuerySchema
  .extend({
    semantic: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.semantic && value.q === undefined) {
      context.addIssue({
        code: "custom",
        path: ["q"],
        message: "q is required for semantic search",
      });
    }
    if (
      value.semantic &&
      (value.categoryId !== undefined ||
        value.kind !== undefined ||
        value.cursor !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["semantic"],
        message:
          "semantic search cannot be combined with categoryId, kind, or cursor",
      });
    }
  });

export interface McpServerDeps {
  listBookmarks: (
    userId: string,
    query: BookmarkListQuery,
  ) => Promise<BookmarkListResult>;
  searchSemanticBookmarks: typeof searchSemanticBookmarksForUser;
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
    searchSemanticBookmarks: searchSemanticBookmarksForUser,
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
        "Search the authenticated user's bookmarks. Use semantic=true for meaning- or topic-based searches (for example, finding bookmarks related to a concept even when the exact words are not present); semantic=true requires q and cannot be combined with categoryId, kind, or cursor. Omit semantic or set it to false for partial-text, category, kind, or cursor filtering.",
      inputSchema: mcpSearchBookmarksInputSchema,
    },
    async (query) => {
      const { semantic, ...textQuery } = query;
      try {
        if (semantic) {
          // The input schema rejects missing q; this guard only narrows the type.
          if (!textQuery.q) {
            return toolError(
              new HttpError(
                400,
                API_ERROR_CODES.VALIDATION_ERROR,
                "q is required for semantic search",
              ),
              "북마크 검색에 실패했습니다",
            );
          }
          return jsonToolResult(
            await deps.searchSemanticBookmarks(userId, {
              q: textQuery.q,
              limit: textQuery.limit,
            }),
          );
        }
        return jsonToolResult(await deps.listBookmarks(userId, textQuery));
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
        if (
          error instanceof HttpError &&
          error.status === 409 &&
          error.code === API_ERROR_CODES.CONFLICT
        ) {
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
