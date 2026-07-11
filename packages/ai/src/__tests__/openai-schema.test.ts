import { zodTextFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";
import { openAiCategorizeResponseSchema } from "../schema";

describe("OpenAI categorize schema", () => {
  it("uses an object at the structured-output root", () => {
    expect(() =>
      zodTextFormat(openAiCategorizeResponseSchema, "bookmark_category"),
    ).not.toThrow();
  });
});
