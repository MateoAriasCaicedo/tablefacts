import { describe, expect, it, vi } from "vitest";

// The library entry must be importable and callable without a CLI around it.
// Only paths that need no network are exercised.

describe("research() API", () => {
  it("rejects without a name", async () => {
    const { research } = await import("../src/research/index.mjs");
    await expect(research({} as any)).rejects.toThrow(/name/);
    await expect(research({ name: "   " })).rejects.toThrow(/name/);
  });

  it("has no side effects on import", async () => {
    vi.resetModules();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const mod = await import("../src/research/index.mjs?fresh");
    expect(typeof mod.research).toBe("function");
    expect(log).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    log.mockRestore();
    exit.mockRestore();
  });
});
