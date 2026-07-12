import { z } from "zod";

export const API_ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL",
} as const;

export type ApiErrorCode =
  (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export const uuidSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const categorySchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string().min(1).max(50),
  sortOrder: z.number().int(),
  createdAt: isoDateTimeSchema,
});

export const categoryWithCountSchema = categorySchema.extend({
  bookmarkCount: z.number().int().nonnegative().optional(),
});

export const aiStatusSchema = z.enum(["idle", "pending", "done", "failed"]);

const bookmarkTagSchema = z.string().trim().min(1).max(20);

export const bookmarkTagsSchema = z
  .array(bookmarkTagSchema)
  .max(5)
  .transform((tags) => [...new Set(tags)]);

export const bookmarkSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  url: z.url(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  siteName: z.string().nullable(),
  faviconUrl: z.url().nullable(),
  ogImageUrl: z.url().nullable(),
  categoryId: uuidSchema.nullable(),
  tags: bookmarkTagsSchema,
  aiStatus: aiStatusSchema,
  aiModel: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const reminderStatusSchema = z.enum(["pending", "sent", "cancelled"]);

export const reminderSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  bookmarkId: uuidSchema,
  remindAt: isoDateTimeSchema,
  note: z.string().nullable(),
  status: reminderStatusSchema,
  sentAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export const reminderWithBookmarkSchema = reminderSchema.extend({
  bookmark: bookmarkSchema.pick({ id: true, url: true, title: true }),
});

export const pushSubscriptionRequestSchema = z.object({
  endpoint: z.url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const createBookmarkRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    url: z.url(),
    mode: z.literal("ai"),
    categoryId: z.null().optional(),
    title: z.string().min(1).nullable().optional(),
  }),
  z.object({
    url: z.url(),
    mode: z.literal("manual"),
    categoryId: uuidSchema,
    title: z.string().min(1).nullable().optional(),
  }),
  z.object({
    url: z.url(),
    mode: z.literal("none"),
    categoryId: z.null().optional(),
    title: z.string().min(1).nullable().optional(),
  }),
]);

export const updateBookmarkRequestSchema = z
  .object({
    url: z.url().optional(),
    title: z.string().min(1).nullable().optional(),
    description: z.string().nullable().optional(),
    categoryId: uuidSchema.nullable().optional(),
    tags: bookmarkTagsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const bookmarkListQuerySchema = z.object({
  categoryId: z.union([uuidSchema, z.literal("none")]).optional(),
  q: z.string().trim().min(1).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const createCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(50),
});

export const updateCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const reorderCategoriesRequestSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(200),
});

export const createReminderRequestSchema = z.object({
  bookmarkId: uuidSchema,
  remindAt: isoDateTimeSchema,
  note: z.string().trim().max(500).nullable().optional(),
});

export const updateReminderRequestSchema = z
  .object({
    remindAt: isoDateTimeSchema.optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const meResponseSchema = z.object({ userId: uuidSchema });
export const aiProviderNameSchema = z.enum(["gemini", "anthropic", "openai"]);
export const aiModelIdSchema = z.enum([
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "gpt-4o-mini",
  "gpt-5.4-mini",
]);
export const AI_MODEL_CATALOG = [
  {
    provider: "gemini",
    model: "gemini-flash-lite-latest",
    label: "Gemini Flash Lite",
    tier: "저비용",
  },
  {
    provider: "gemini",
    model: "gemini-flash-latest",
    label: "Gemini Flash",
    tier: "균형",
  },
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    tier: "저비용",
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    tier: "균형",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    label: "GPT-4o mini",
    tier: "저비용",
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    tier: "균형",
  },
] as const;
export const aiProviderStatusSchema = z.object({ configured: z.boolean() });
export const aiStatusResponseSchema = z.object({
  provider: aiProviderNameSchema,
  model: aiModelIdSchema,
  enabled: z.boolean(),
  modelOrder: z.array(aiModelIdSchema),
  providers: z.object({
    gemini: aiProviderStatusSchema,
    anthropic: aiProviderStatusSchema,
    openai: aiProviderStatusSchema,
  }),
});
export const saveAiProviderKeyRequestSchema = z.object({
  apiKey: z.string().trim().min(1).max(512),
});
export const reorderAiModelsRequestSchema = z
  .object({
    models: z.array(aiModelIdSchema).min(1).max(AI_MODEL_CATALOG.length),
  })
  .refine((value) => new Set(value.models).size === value.models.length, {
    message: "models must be unique",
    path: ["models"],
  });
export type ReorderAiModelsRequest = z.infer<
  typeof reorderAiModelsRequestSchema
>;
export const aiConnectionTestResponseSchema = z.object({
  provider: aiProviderNameSchema,
  ok: z.boolean(),
});

export const aiUsageStatusSchema = z.enum(["success", "failed"]);
export const aiUsageEventSchema = z.object({
  id: uuidSchema,
  provider: aiProviderNameSchema,
  model: z.string(),
  bookmarkId: uuidSchema.nullable(),
  status: aiUsageStatusSchema,
  errorCode: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: isoDateTimeSchema,
});
export const aiUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
export const aiUsageResponseSchema = z.object({
  days: z.number().int(),
  items: z.array(aiUsageEventSchema),
});
export type AiUsageEvent = z.infer<typeof aiUsageEventSchema>;
export type AiUsageResponse = z.infer<typeof aiUsageResponseSchema>;

export const createApiKeyRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const apiKeySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  keyPrefix: z.string(),
  lastUsedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export const createApiKeyResponseSchema = apiKeySchema.extend({
  key: z.string().regex(/^bm_[A-Za-z0-9_-]{43}$/),
});

export const apiKeysResponseSchema = z.object({
  items: z.array(apiKeySchema),
});

export const pushStatusResponseSchema = z.object({
  enabled: z.boolean(),
  subscriptionCount: z.number().int().nonnegative(),
  vapidPublicKey: z.string().nullable(),
});

export const pushTestResponseSchema = z.object({
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const bookmarkResponseSchema = z.object({ bookmark: bookmarkSchema });
export const bookmarksResponseSchema = z.object({
  items: z.array(bookmarkSchema),
  nextCursor: z.string().nullable(),
});
export const categoriesResponseSchema = z.object({
  items: z.array(categoryWithCountSchema),
});
export const remindersResponseSchema = z.object({
  items: z.array(reminderWithBookmarkSchema),
});
export const reminderResponseSchema = z.object({
  reminder: reminderWithBookmarkSchema,
});

export type Category = z.infer<typeof categorySchema>;
export type CategoryWithCount = z.infer<typeof categoryWithCountSchema>;
export type Bookmark = z.infer<typeof bookmarkSchema>;
export type Reminder = z.infer<typeof reminderSchema>;
export type ReminderWithBookmark = z.infer<typeof reminderWithBookmarkSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type CreateBookmarkRequest = z.infer<typeof createBookmarkRequestSchema>;
export type UpdateBookmarkRequest = z.infer<typeof updateBookmarkRequestSchema>;
export type BookmarkListQuery = z.infer<typeof bookmarkListQuerySchema>;
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;
export type ReorderCategoriesRequest = z.infer<
  typeof reorderCategoriesRequestSchema
>;
export type CreateReminderRequest = z.infer<typeof createReminderRequestSchema>;
export type UpdateReminderRequest = z.infer<typeof updateReminderRequestSchema>;
export type PushSubscriptionRequest = z.infer<
  typeof pushSubscriptionRequestSchema
>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type AiProviderName = z.infer<typeof aiProviderNameSchema>;
export type AiModelId = z.infer<typeof aiModelIdSchema>;
export type AiStatusResponse = z.infer<typeof aiStatusResponseSchema>;
export type AiConnectionTestResponse = z.infer<
  typeof aiConnectionTestResponseSchema
>;
export type SaveAiProviderKeyRequest = z.infer<
  typeof saveAiProviderKeyRequestSchema
>;
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;
export type ApiKey = z.infer<typeof apiKeySchema>;
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;
export type ApiKeysResponse = z.infer<typeof apiKeysResponseSchema>;
export type PushStatusResponse = z.infer<typeof pushStatusResponseSchema>;
export type PushTestResponse = z.infer<typeof pushTestResponseSchema>;
export type BookmarkResponse = z.infer<typeof bookmarkResponseSchema>;
export type BookmarksResponse = z.infer<typeof bookmarksResponseSchema>;
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>;
export type RemindersResponse = z.infer<typeof remindersResponseSchema>;
export type ReminderResponse = z.infer<typeof reminderResponseSchema>;
