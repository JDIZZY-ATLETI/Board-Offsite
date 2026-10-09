import { describe, expect, it } from "vitest";
import { aesGcmEncrypt } from "@/lib/crypto/hash";
import { decryptSin, encryptSin, isWellFormedSin, luhnValid, maskSin, normalizeSin, pseudonymizeSin, sinIdentity, withLuhnCheckDigit } from "@/lib/pii/sin";

const PK = Buffer.from("a1".repeat(32), "hex");
const EK = Buffer.from("b2".repeat(32), "hex");

describe("SIN helpers", () => {
  it("normalises by trimming and left-padding to 9 digits", () => {
    expect(normalizeSin(" 1234567 ")).toBe("001234567");
    expect(normalizeSin("900000019")).toBe("900000019");
    expect(normalizeSin("")).toBeNull();
    expect(normalizeSin(null)).toBeNull();
    expect(normalizeSin("12345678X")).toBe("12345678X");
    expect(isWellFormedSin("900000019")).toBe(true);
    expect(isWellFormedSin("12345678X")).toBe(false);
  });
  it("masks to ***-***-NNN", () => {
    expect(maskSin("900000019")).toBe("***-***-019");
    expect(maskSin("12345678X")).toBe("***-***-78X");
  });
  it("pseudonym is HMAC-SHA256 hex, deterministic and key-dependent", () => {
    const p = pseudonymizeSin(PK, "900000019");
    expect(p).toMatch(/^[0-9a-f]{64}$/);
    expect(pseudonymizeSin(PK, "900000019")).toBe(p);
    expect(pseudonymizeSin(EK, "900000019")).not.toBe(p);
    expect(p).not.toContain("900000019");
    expect(sinIdentity(PK, "900000019")).toEqual({ sin: "900000019", sinPseudo: p, sinMasked: "***-***-019" });
  });
  it("encrypts with AES-256-GCM: random IV, authenticated, round-trips", () => {
    const a = encryptSin(EK, "900000019");
    const b = encryptSin(EK, "900000019");
    expect(a.equals(b)).toBe(false);
    expect(a[0]).toBe(1);
    expect(a.length).toBe(1 + 12 + 16 + 9);
    expect(decryptSin(EK, a)).toBe("900000019");
    expect(() => decryptSin(PK, a)).toThrow();
    const tampered = Buffer.from(a);
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => decryptSin(EK, tampered)).toThrow();
    expect(() => aesGcmEncrypt(Buffer.alloc(16), "x")).toThrow();
  });
  it("Luhn helpers agree", () => {
    expect(luhnValid("046454286")).toBe(true);
    expect(luhnValid("046454287")).toBe(false);
    expect(luhnValid(withLuhnCheckDigit("90000001"))).toBe(true);
    expect(() => withLuhnCheckDigit("123")).toThrow();
  });
});
