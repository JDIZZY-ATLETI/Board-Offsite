import { aesGcmDecrypt, aesGcmEncrypt, hmacSha256Hex } from "@/lib/crypto/hash";

/**
 * SIN helpers. Raw SIN must never leave this module except through:
 *  - the Rejected Individuals CSV writer (mirrors the input file), and
 *  - the (Phase 3) Ariel export writer.
 */

/** Left-pad to 9 digits per layout note; returns null for blank; non-digit input returned trimmed as-is. */
export function normalizeSin(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const t = raw.trim();
  if (t === "") return null;
  if (/^\d{1,9}$/.test(t)) return t.padStart(9, "0");
  return t;
}

export function isWellFormedSin(sin: string | null): sin is string {
  return sin !== null && /^\d{9}$/.test(sin);
}

export function maskSin(sin: string): string {
  const last3 = sin.length >= 3 ? sin.slice(-3) : sin.padStart(3, "*");
  return `***-***-${last3}`;
}

export function pseudonymizeSin(key: Buffer, sin: string): string {
  return hmacSha256Hex(key, sin);
}

export function encryptSin(key: Buffer, sin: string): Buffer {
  return aesGcmEncrypt(key, sin);
}

export function decryptSin(key: Buffer, blob: Uint8Array): string {
  return aesGcmDecrypt(key, blob);
}

/** Luhn mod-10 (the SIN check digit algorithm). Not a validation rule for Events; used by fixtures. */
export function luhnValid(sin: string): boolean {
  if (!/^\d{9}$/.test(sin)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(sin[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Append the check digit that makes an 8-digit prefix a valid Luhn SIN. */
export function withLuhnCheckDigit(prefix8: string): string {
  if (!/^\d{8}$/.test(prefix8)) throw new Error("withLuhnCheckDigit expects 8 digits");
  for (let c = 0; c <= 9; c++) {
    const s = prefix8 + String(c);
    if (luhnValid(s)) return s;
  }
  throw new Error("unreachable");
}

export interface SinIdentity {
  sin: string;
  sinPseudo: string;
  sinMasked: string;
}

export function sinIdentity(pseudonymKey: Buffer, sin: string): SinIdentity {
  return { sin, sinPseudo: pseudonymizeSin(pseudonymKey, sin), sinMasked: maskSin(sin) };
}
