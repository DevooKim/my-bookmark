import { zodTextFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";
import { analyzeResponseSchema } from "../schema";

describe("OpenAI analysis schema", () => {
  it("uses an object at the structured-output root", () => {
    expect(() =>
      zodTextFormat(analyzeResponseSchema, "bookmark_analysis"),
    ).not.toThrow();
  });
});
