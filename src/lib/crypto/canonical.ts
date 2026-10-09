/**
 * RFC 8785 (JCS) style canonical JSON: lexicographically sorted object keys (by UTF-16 code units),
 * no whitespace, numbers serialised as ECMAScript JSON.stringify does, `undefined` keys omitted.
 * Throws on non-finite numbers and on values that cannot be represented (functions, symbols, bigint).
 */
export function canonicalize(value: unknown): string {
  return serialize(value, []);
}

function serialize(value: unknown, path: string[]): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonicalize: non-finite number at ${path.join(".") || "$"}`);
      return JSON.stringify(value);
    case "bigint":
    case "function":
    case "symbol":
    case "undefined":
      throw new Error(`canonicalize: unsupported ${typeof value} at ${path.join(".") || "$"}`);
    default:
      break;
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v, i) => serialize(v === undefined ? null : v, [...path, String(i)])).join(",") + "]";
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  const obj = value as Record<string, unknown>;
  if (typeof (obj as { toJSON?: unknown }).toJSON === "function") {
    return serialize((obj as { toJSON: () => unknown }).toJSON(), path);
  }
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort((a, b) => compareUtf16(a, b));
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + serialize(obj[k], [...path, k])).join(",") + "}";
}

function compareUtf16(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}
