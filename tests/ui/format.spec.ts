import { describe, expect, it } from "vitest";
import { actorLabel, displayName, fillTemplate, formatBytes, formatDecimal, formatDuration, formatInt, formatPercent, formatRelative, formatUtcIso, initials, isoToMmddyyyy, mmddyyyyToIso, shortBatchId, shortId } from "@/lib/ui/format";

describe("format.ts (section 7.3)", () => {
  it("shortens ids/hashes as first 8 + ellipsis + last 4", () => {
    expect(shortId("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")).toBe("9f86d081\u20260a08");
    expect(shortId("short")).toBe("short");
    expect(shortId(null)).toBe("\u2014");
  });

  it("shortens UUID v7 batch ids without hyphens", () => {
    expect(shortBatchId("0192f3a4-1b2c-7d3e-8f4a-5b6c7d8e4e5f")).toBe("0192f3a4\u20264e5f");
  });

  it("formats integers and decimals with en-CA grouping and U+2212 minus", () => {
    expect(formatInt(12594)).toBe("12,594");
    expect(formatInt(-5)).toBe("\u22125");
    expect(formatDecimal("1723.64")).toBe("1,723.64");
    expect(formatDecimal("38.86")).toBe("38.86");
    expect(formatDecimal("5")).toBe("5.00");
    expect(formatDecimal("-150.00")).toBe("\u2212150.00");
    expect(formatDecimal(null)).toBe("\u2014");
    expect(formatDecimal("abc")).toBe("abc");
  });

  it("never rounds a 2-dp API string", () => {
    expect(formatDecimal("0.10")).toBe("0.10");
    expect(formatDecimal("2844.87")).toBe("2,844.87");
  });

  it("formats percent with one decimal and a thin space", () => {
    expect(formatPercent(0.068)).toBe("6.8\u2009%");
    expect(formatPercent(null)).toBe("\u2014");
  });

  it("converts MMDDYYYY <-> ISO", () => {
    expect(mmddyyyyToIso("09302026")).toBe("2026-09-30");
    expect(mmddyyyyToIso("2026-09-30")).toBeNull();
    expect(isoToMmddyyyy("2026-09-30")).toBe("09302026");
  });

  it("renders UTC ISO with milliseconds for ledger timestamps", () => {
    expect(formatUtcIso("2026-10-08T14:03:19.412Z")).toBe("2026-10-08T14:03:19.412Z");
  });

  it("relative time uses coarse units", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(formatRelative("2026-10-08T11:58:30Z", now)).toBe("2 min ago");
    expect(formatRelative("2026-10-08T10:00:00Z", now)).toBe("2 h ago");
    expect(formatRelative("2026-10-05T12:00:00Z", now)).toBe("3 d ago");
  });

  it("formats bytes and durations", () => {
    expect(formatBytes(18_636)).toBe("18.2 KB");
    expect(formatBytes(24_117_248)).toBe("23.0 MB");
    expect(formatDuration(1200)).toBe("1.2 s");
    expect(formatDuration(80)).toBe("80 ms");
  });

  it("names: initials and LAST, First", () => {
    expect(initials("Anna", "Able")).toBe("A.A.");
    expect(displayName("Anna", "Able")).toBe("ABLE, Anna");
    expect(actorLabel("system:pipeline")).toBe("pipeline");
  });

  it("fills templates and leaves unknown placeholders visible", () => {
    expect(fillTemplate("Row {line} · {raw}", { line: 12 })).toBe("Row 12 · {raw}");
  });
});