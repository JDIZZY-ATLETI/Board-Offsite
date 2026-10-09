import type { FindingParams } from "@/types";

const PLACEHOLDER_RE = /\{([^{}]+)\}/g;

/** Replaces {n} (or named {File.FieldName}) placeholders. Unresolved placeholders are left intact. */
export function renderMessage(template: string, params: FindingParams): string {
  return template.replace(PLACEHOLDER_RE, (m, key: string) => (key in params ? String(params[key]) : m));
}

export function hasUnresolvedPlaceholders(text: string): boolean {
  // Fresh regex: the shared /g pattern keeps lastIndex between calls and would skip matches.
  return /\{[^{}]+\}/.test(text);
}
