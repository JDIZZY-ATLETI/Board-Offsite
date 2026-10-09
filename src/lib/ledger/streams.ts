export const SYSTEM_STREAM = "system";

export function batchStream(batchId: string): string {
  return `batch:${batchId}`;
}

export function memberStream(sinPseudo: string): string {
  return `member:${sinPseudo}`;
}

export function systemActor(component = "pipeline"): string {
  return `system:${component}`;
}
