import { describe, expect, it } from "vitest";
import { API_ERROR_CODES } from "../index";

describe("API_ERROR_CODES", () => {
  it("contains the generic internal error code", () => {
    expect(API_ERROR_CODES.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
  });
});
