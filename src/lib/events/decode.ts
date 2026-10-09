import iconv from "iconv-lite";
import type { EncodingDetected } from "@/types";

export interface DecodedText {
  text: string;
  encoding: EncodingDetected;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export type EncodingProblem = "UTF16_LE" | "UTF16_BE" | "NUL_BYTES";

/**
 * The layout mandates ANSI (windows-1252); UTF-16 (with or without BOM) and any other NUL-bearing content
 * is not an Events file and must be rejected at L0 (QA BUG-PIPE-1/2) - NUL cannot be stored in text/jsonb.
 */
export function detectEncodingProblem(bytes: Buffer): EncodingProblem | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "UTF16_LE";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "UTF16_BE";
  let even = 0;
  let odd = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) continue;
    if (i % 2 === 0) even += 1;
    else odd += 1;
  }
  const nul = even + odd;
  if (nul === 0) return null;
  // ASCII-range UTF-16 has a NUL in every other byte; a few stray NULs are just corrupt text.
  if (nul * 2 >= bytes.length * 0.8) return odd >= even ? "UTF16_LE" : "UTF16_BE";
  return "NUL_BYTES";
}

/**
 * The layout mandates ANSI (windows-1252). Pure-ASCII and valid UTF-8 input decode identically, so we
 * prefer UTF-8 when it is valid and fall back to windows-1252 (which never fails) otherwise.
 */
export function decodeBytes(bytes: Buffer): DecodedText {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(UTF8_BOM)) {
    return { text: bytes.subarray(3).toString("utf8"), encoding: "utf-8-bom" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (bytes.every((b) => b < 0x80)) return { text, encoding: "windows-1252" };
    return { text, encoding: "utf-8" };
  } catch {
    return { text: iconv.decode(bytes, "windows-1252"), encoding: "windows-1252" };
  }
}

export function encodeText(text: string, encoding: EncodingDetected): Buffer {
  switch (encoding) {
    case "utf-8":
      return Buffer.from(text, "utf8");
    case "utf-8-bom":
      return Buffer.concat([UTF8_BOM, Buffer.from(text, "utf8")]);
    case "windows-1252":
      return iconv.encode(text, "windows-1252");
  }
}

/** Magic-byte sniff for obviously-not-CSV uploads (architecture section 13.2). */
export function looksLikeBinary(bytes: Buffer): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "zip";
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return "exe";
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "ole";
  return null;
}
