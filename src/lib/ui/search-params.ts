/** Helpers for URL-held filter state (docs/ux-design.md section 4.5 / 9.2). */

export type SearchParamsInput = Record<string, string | string[] | undefined>;

export function firstParam(sp: SearchParamsInput, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Comma-separated multi-value param (`severity=WARNING,INFORMATION`). */
export function listParam(sp: SearchParamsInput, key: string): string[] {
  const v = firstParam(sp, key);
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export function intParam(sp: SearchParamsInput, key: string): number | undefined {
  const v = firstParam(sp, key);
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
}

export function enumParam<T extends string>(sp: SearchParamsInput, key: string, allowed: readonly T[]): T | undefined {
  const v = firstParam(sp, key);
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Builds a query string, dropping empty values. */
export function buildQuery(params: Record<string, string | number | null | undefined | string[]>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(","));
    } else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}