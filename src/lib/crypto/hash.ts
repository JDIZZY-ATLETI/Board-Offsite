import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

export const ZERO64 = "0".repeat(64);

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(key: Buffer, input: string): string {
  return createHmac("sha256", key).update(input, "utf8").digest("hex");
}

const BLOB_VERSION = 1;

/** AES-256-GCM. Layout: version(1) || iv(12) || tag(16) || ciphertext. */
export function aesGcmEncrypt(key: Buffer, plaintext: string): Buffer {
  if (key.length !== 32) throw new Error("aesGcmEncrypt: key must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([BLOB_VERSION]), iv, tag, ct]);
}

export function aesGcmDecrypt(key: Buffer, blob: Uint8Array): string {
  const b = Buffer.from(blob);
  if (b[0] !== BLOB_VERSION) throw new Error(`aesGcmDecrypt: unsupported blob version ${b[0]}`);
  const iv = b.subarray(1, 13);
  const tag = b.subarray(13, 29);
  const ct = b.subarray(29);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
