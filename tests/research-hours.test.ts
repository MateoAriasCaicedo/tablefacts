/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import * as mod1 from "../src/research/lib/hours.mjs";
const { formatRows, fromGoogle, fromOsm, fromSpec, weekSignature } = mod1 as Record<string, any>;

type Slot = [string, string];
type Week = Slot[][];

const same = (slots: Slot[]): Week => Array.from({ length: 7 }, () => slots);

describe("fromGoogle", () => {
  it("is null without periods", () => {
    expect(fromGoogle([])).toBeNull();
    expect(fromGoogle(undefined)).toBeNull();
  });

  it("moves Google's Sunday-first days to a Monday-first week", () => {
    const { week } = fromGoogle([
      { open: { day: 1, hour: 12 }, close: { day: 1, hour: 22 } }, // Monday
      { open: { day: 0, hour: 9, minute: 30 }, close: { day: 0, hour: 15 } }, // Sunday
    ]);
    expect(week[0]).toEqual([["12:00", "22:00"]]);
    expect(week[6]).toEqual([["09:30", "15:00"]]);
    expect(week[1]).toEqual([]);
  });

  it("keeps several slots of one day, sorted", () => {
    const { week } = fromGoogle([
      { open: { day: 2, hour: 18 }, close: { day: 2, hour: 23 } },
      { open: { day: 2, hour: 12 }, close: { day: 2, hour: 15 } },
    ]);
    expect(week[1]).toEqual([
      ["12:00", "15:00"],
      ["18:00", "23:00"],
    ]);
  });

  it("reads a single period with no close as open all day, every day", () => {
    const { week } = fromGoogle([{ open: { day: 0, hour: 0 } }]);
    expect(week).toEqual(same([["00:00", "24:00"]]));
  });

  it("skips a period that has no opening or closing", () => {
    const { week } = fromGoogle([
      { open: { day: 1, hour: 12 } },
      { open: { day: 1, hour: 12 }, close: { day: 1, hour: 14 } },
    ]);
    expect(week[0]).toEqual([["12:00", "14:00"]]);
  });
});

describe("fromOsm", () => {
  it("is null for nothing or for text it cannot read", () => {
    expect(fromOsm("")).toBeNull();
    expect(fromOsm(undefined)).toBeNull();
    expect(fromOsm("whenever we feel like it")).toBeNull();
  });

  it("reads 24/7", () => {
    expect(fromOsm("24/7")?.week).toEqual(same([["00:00", "24:00"]]));
  });

  it("reads day ranges, lists and 'off'", () => {
    const { week, partial } = fromOsm("Mo-Th 12:00-22:00; Fr,Sa 12:00-00:00; Su off");
    for (const d of [0, 1, 2, 3]) expect(week[d]).toEqual([["12:00", "22:00"]]);
    for (const d of [4, 5]) expect(week[d]).toEqual([["12:00", "00:00"]]);
    expect(week[6]).toEqual([]);
    expect(partial).toBe(false);
  });

  it("applies a rule with no days to the whole week", () => {
    expect(fromOsm("10:00-18:00")?.week).toEqual(same([["10:00", "18:00"]]));
  });

  it("wraps a range that crosses Sunday", () => {
    const { week } = fromOsm("Sa-Mo 10:00-12:00");
    expect([5, 6, 0].every((d) => week[d].length === 1)).toBe(true);
    expect(week[1]).toEqual([]);
  });

  it("keeps several slots in one rule", () => {
    expect(fromOsm("Mo 12:00-15:00,18:00-23:00")?.week[0]).toEqual([
      ["12:00", "15:00"],
      ["18:00", "23:00"],
    ]);
  });

  it("flags what it could not read as partial instead of guessing", () => {
    const result = fromOsm("Mo-Fr 12:00-22:00; PH off");
    expect(result?.partial).toBe(true);
    expect(result?.week[0]).toEqual([["12:00", "22:00"]]);
  });

  it("does not read a rule with a day it does not know", () => {
    expect(fromOsm("Xx 10:00-11:00")).toBeNull();
  });
});

describe("fromSpec", () => {
  it("reads schema.org opening hours, full URLs and short times", () => {
    const { week } = fromSpec([
      { dayOfWeek: ["Monday", "https://schema.org/Tuesday"], opens: "12:00:00", closes: "22:00:00" },
      { dayOfWeek: "Sunday", opens: "09:00", closes: "15:00" },
    ]);
    expect(week[0]).toEqual([["12:00", "22:00"]]);
    expect(week[1]).toEqual([["12:00", "22:00"]]);
    expect(week[6]).toEqual([["09:00", "15:00"]]);
  });

  it("accepts a single object", () => {
    expect(fromSpec({ dayOfWeek: "Friday", opens: "10:00", closes: "11:00" } as never)?.week[4]).toEqual([["10:00", "11:00"]]);
  });

  it("is null when nothing usable is there", () => {
    expect(fromSpec([])).toBeNull();
    expect(fromSpec([{ dayOfWeek: "Funday", opens: "10:00", closes: "11:00" }])).toBeNull();
    expect(fromSpec([{ dayOfWeek: "Monday" }])).toBeNull();
  });
});

describe("weekSignature", () => {
  it("is equal for equal weeks and different for different ones", () => {
    expect(weekSignature(same([["12:00", "22:00"]]))).toBe(weekSignature(same([["12:00", "22:00"]])));
    expect(weekSignature(same([["12:00", "22:00"]]))).not.toBe(weekSignature(same([["12:00", "23:00"]])));
  });
});

describe("formatRows", () => {
  const closed: Slot[] = [];
  const open: Slot[] = [["12:00", "22:00"]];
  const week = (days: Slot[][]): Week => days;

  it("is empty when the restaurant is closed every day", () => {
    expect(formatRows(same(closed), "en")).toEqual([]);
  });

  it("merges the same hours across the whole week", () => {
    expect(formatRows(same(open), "en")).toEqual([{ label: "Every day", value: "12:00 to 22:00" }]);
    expect(formatRows(same(open), "es")).toEqual([{ label: "Todos los días", value: "12:00 a 22:00" }]);
  });

  it("merges consecutive identical days into ranges, in the page language", () => {
    const rows = formatRows(week([open, open, open, open, open, [["12:00", "00:00"]], closed]), "es");
    expect(rows).toEqual([
      { label: "Lunes a viernes", value: "12:00 a 22:00" },
      { label: "Sábado", value: "12:00 a 00:00" },
      { label: "Domingo", value: "Cerrado" },
    ]);
  });

  it("names two days with 'and' and a single day on its own", () => {
    const rows = formatRows(week([open, open, closed, closed, closed, closed, [["10:00", "15:00"]]]), "en");
    expect(rows).toEqual([
      { label: "Monday and tuesday", value: "12:00 to 22:00" },
      { label: "Wednesday to saturday", value: "Closed" },
      { label: "Sunday", value: "10:00 to 15:00" },
    ]);
  });

  it("says '24 hours' for a day that never closes and lists split shifts", () => {
    const rows = formatRows(
      week([[["00:00", "24:00"]], [["12:00", "15:00"], ["18:00", "23:00"]], closed, closed, closed, closed, closed]),
      "en",
    );
    expect(rows[0]).toEqual({ label: "Monday", value: "24 hours" });
    expect(rows[1]).toEqual({ label: "Tuesday", value: "12:00 to 15:00, 18:00 to 23:00" });
  });

  it("does not merge days that are not next to each other", () => {
    const rows = formatRows(week([open, closed, open, closed, open, closed, open]), "en");
    expect(rows).toHaveLength(7);
  });
});
