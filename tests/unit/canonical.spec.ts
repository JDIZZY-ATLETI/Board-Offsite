import { describe, expect, it } from "vitest";
import { canonicalize } from "@/lib/crypto/canonical";
import { sha256Hex } from "@/lib/crypto/hash";
import { entryHashOf, headerStringOf, payloadHashOf } from "@/lib/ledger/hashing";

describe("canonicalize (JCS subset)", () => {
  it("sorts keys recursively and strips whitespace", () => {
    expect(canonicalize({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  });
  it("omits undefined keys, keeps nulls, turns undefined array items into null", () => {
    expect(canonicalize({ a: undefined, b: null, c: [undefined, 1] })).toBe('{"b":null,"c":[null,1]}');
  });
  it("is stable under key insertion order", () => {
    const a = canonicalize({ x: 1, y: [1, 2], z: { k: "v" } });
    const b = canonicalize({ z: { k: "v" }, y: [1, 2], x: 1 });
    expect(a).toBe(b);
  });
  it("sorts by UTF-16 code units and escapes strings like JSON", () => {
    expect(canonicalize({ "\u00e9": 1, e: 2, E: 3 })).toBe('{"E":3,"e":2,"\u00e9":1}');
    expect(canonicalize("a\"b\n")).toBe('"a\\"b\\n"');
  });
  it("rejects non-finite numbers and unsupported types", () => {
    expect(() => canonicalize({ a: Number.NaN })).toThrow();
    expect(() => canonicalize({ a: () => 1 })).toThrow();
    expect(() => canonicalize(undefined)).toThrow();
  });
  it("serialises Dates as ISO strings", () => {
    expect(canonicalize({ d: new Date("2026-10-08T00:00:00.000Z") })).toBe('{"d":"2026-10-08T00:00:00.000Z"}');
  });
});

describe("hash recipe test vectors (architecture section 9.2)", () => {
  it("sha256 of empty string", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("payload hash is the sha256 of the canonical JSON", () => {
    const payload = { employerId: "0235", sha256: "ab", sizeBytes: 12 };
    expect(payloadHashOf(payload)).toBe(sha256Hex('{"employerId":"0235","sha256":"ab","sizeBytes":12}'));
  });
  it("entry hash fixed vector", () => {
    const header = {
      seq: 1,
      entryId: "00000000-0000-7000-8000-000000000001",
      streamId: "batch:00000000-0000-7000-8000-000000000002",
      streamSeq: 1,
      eventType: "BatchReceived" as const,
      batchId: "00000000-0000-7000-8000-000000000002",
      actor: "user:test",
      occurredAt: "2026-10-08T12:00:00.000Z",
      payloadHash: "0".repeat(64),
      prevHashGlobal: "0".repeat(64),
      prevHashStream: "0".repeat(64),
    };
    expect(headerStringOf(header)).toBe(
      '{"actor":"user:test","batchId":"00000000-0000-7000-8000-000000000002","entryId":"00000000-0000-7000-8000-000000000001","eventType":"BatchReceived","occurredAt":"2026-10-08T12:00:00.000Z","payloadHash":"0000000000000000000000000000000000000000000000000000000000000000","prevHashGlobal":"0000000000000000000000000000000000000000000000000000000000000000","prevHashStream":"0000000000000000000000000000000000000000000000000000000000000000","seq":1,"streamId":"batch:00000000-0000-7000-8000-000000000002","streamSeq":1,"v":1}',
    );
    expect(entryHashOf(header)).toBe(sha256Hex(headerStringOf(header)));
    expect(entryHashOf(header)).toMatch(/^[0-9a-f]{64}$/);
    expect(entryHashOf({ ...header, seq: 2 })).not.toBe(entryHashOf(header));
  });
});
