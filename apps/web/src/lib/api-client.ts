import {
  type AiStatusResponse,
  type ApiKeysResponse,
  aiStatusResponseSchema,
  apiKeysResponseSchema,
  type Bookmark,
  type BookmarksResponse,
  bookmarkSchema,
  bookmarksResponseSchema,
  type CategoriesResponse,
  type Category,
  type CreateApiKeyRequest,
  type CreateApiKeyResponse,
  type CreateBookmarkRequest,
  type CreateCategoryRequest,
  categoriesResponseSchema,
  categorySchema,
  createApiKeyResponseSchema,
  type MeResponse,
  meResponseSchema,
  type UpdateBookmarkRequest,
  type UpdateCategoryRequest,
} from "@my-bookmark/shared";
import { supabase } from "./supabase";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session?.access_token;
}

async function refreshAccessToken() {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    throw error;
  }
  return data.session?.access_token;
}

async function apiFetch(path: string, init: RequestInit = {}, retry = true) {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiUrl}${path}`, { ...init, headers });

  if (response.status === 401 && retry) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      headers.set("Authorization", `Bearer ${refreshedToken}`);
      return fetch(`${apiUrl}${path}`, { ...init, headers });
    }
  }

  return response;
}

async function parseJsonResponse<T>(
  response: Response,
  parse: (json: unknown) => T,
): Promise<T> {
  if (!response.ok) {
    let details: unknown;
    let message = "요청을 처리하지 못했습니다";
    try {
      const json = await response.json();
      details = json;
      const maybeError = json as { error?: { message?: unknown } };
      if (typeof maybeError.error?.message === "string") {
        message = maybeError.error.message;
      }
    } catch {
      // Ignore malformed error payloads; status still carries failure.
    }
    throw new ApiClientError(message, response.status, details);
  }

  return parse(await response.json());
}

export async function getMe(): Promise<MeResponse> {
  const response = await apiFetch("/api/me");
  return parseJsonResponse(response, (json) => meResponseSchema.parse(json));
}

export async function getAiStatus(): Promise<AiStatusResponse> {
  const response = await apiFetch("/api/ai");
  return parseJsonResponse(response, (json) =>
    aiStatusResponseSchema.parse(json),
  );
}

export async function listApiKeys(): Promise<ApiKeysResponse> {
  const response = await apiFetch("/api/keys");
  return parseJsonResponse(response, (json) =>
    apiKeysResponseSchema.parse(json),
  );
}

export async function createApiKey(
  body: CreateApiKeyRequest,
): Promise<CreateApiKeyResponse> {
  const response = await apiFetch("/api/keys", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response, (json) =>
    createApiKeyResponseSchema.parse(json),
  );
}

export async function revokeApiKey(id: string): Promise<void> {
  const response = await apiFetch(`/api/keys/${id}`, { method: "DELETE" });
  if (!response.ok) {
    await parseJsonResponse(response, (json) => json);
  }
}

export async function listCategories(): Promise<CategoriesResponse> {
  const response = await apiFetch("/api/categories?withCounts=true");
  return parseJsonResponse(response, (json) =>
    categoriesResponseSchema.parse(json),
  );
}

export async function createCategory(
  body: CreateCategoryRequest,
): Promise<Category> {
  const response = await apiFetch("/api/categories", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response, (json) =>
    categorySchema.parse((json as { category?: unknown }).category),
  );
}

export async function updateCategory(
  id: string,
  body: UpdateCategoryRequest,
): Promise<Category> {
  const response = await apiFetch(`/api/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response, (json) =>
    categorySchema.parse((json as { category?: unknown }).category),
  );
}

export async function deleteCategory(id: string): Promise<void> {
  const response = await apiFetch(`/api/categories/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    await parseJsonResponse(response, (json) => json);
  }
}

export async function listBookmarks(params: {
  categoryId?: string;
  q?: string;
  cursor?: string;
}): Promise<BookmarksResponse> {
  const search = new URLSearchParams();
  if (params.categoryId) {
    search.set("categoryId", params.categoryId);
  }
  if (params.q) {
    search.set("q", params.q);
  }
  if (params.cursor) {
    search.set("cursor", params.cursor);
  }
  const response = await apiFetch(`/api/bookmarks?${search.toString()}`);
  return parseJsonResponse(response, (json) =>
    bookmarksResponseSchema.parse(json),
  );
}

export async function createBookmark(
  body: CreateBookmarkRequest,
): Promise<Bookmark> {
  const response = await apiFetch("/api/bookmarks", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response, (json) =>
    bookmarkSchema.parse((json as { bookmark?: unknown }).bookmark),
  );
}

export async function updateBookmark(
  id: string,
  body: UpdateBookmarkRequest,
): Promise<Bookmark> {
  const response = await apiFetch(`/api/bookmarks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response, (json) =>
    bookmarkSchema.parse((json as { bookmark?: unknown }).bookmark),
  );
}

export async function recategorizeBookmark(id: string): Promise<Bookmark> {
  const response = await apiFetch(`/api/bookmarks/${id}/categorize`, {
    method: "POST",
  });
  return parseJsonResponse(response, (json) =>
    bookmarkSchema.parse((json as { bookmark?: unknown }).bookmark),
  );
}

export async function deleteBookmark(id: string): Promise<void> {
  const response = await apiFetch(`/api/bookmarks/${id}`, { method: "DELETE" });
  if (!response.ok) {
    await parseJsonResponse(response, (json) => json);
  }
}
