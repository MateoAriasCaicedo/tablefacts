import { describe, expect, it } from "vitest";
import { TablefactsError, exitCodeFor, usageError } from "../src/lib/errors.mjs";

describe("exitCodeFor", () => {
  it("is 2 for a usage error and 1 for any other error", () => {
    expect(exitCodeFor(usageError("bad"))).toBe(2);
    expect(exitCodeFor(new TablefactsError("x", "EUSAGE"))).toBe(2);
    for (const code of ["ECONFIG", "EDEPENDENCY", "EFAILED"]) expect(exitCodeFor(new TablefactsError("x", code))).toBe(1);
    expect(exitCodeFor(new Error("boom"))).toBe(1);
  });

  it("usageError is a TablefactsError with code EUSAGE", () => {
    const error = usageError("bad");
    expect(error).toBeInstanceOf(TablefactsError);
    expect(error.code).toBe("EUSAGE");
    expect(error.message).toBe("bad");
  });
});
