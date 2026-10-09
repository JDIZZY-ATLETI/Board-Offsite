import { pgEnum } from "drizzle-orm/pg-core";

export const batchStatusEnum = pgEnum("batch_status", [
  "RECEIVED",
  "PARSED",
  "VALIDATED",
  "LEDGERED",
  "PROJECTION_BUILT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPORTED",
  "FAILED",
  "FILE_REJECTED",
]);
export const findingLevelEnum = pgEnum("finding_level", ["L0", "L1", "L2"]);
export const findingSeverityEnum = pgEnum("finding_severity", [
  "FILE_ERROR",
  "COMPLETE_MEMBER_ERROR",
  "WARNING",
  "INFORMATION",
]);
export const findingVisibilityEnum = pgEnum("finding_visibility", ["PUBLIC", "PRIVATE"]);
export const updateSetStatusEnum = pgEnum("update_set_status", [
  "BUILDING",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPORTED",
]);
export const arielOperationEnum = pgEnum("ariel_operation", ["UPDATE", "CREATE", "UPSERT_ADD", "CLOSE", "DELETE", "SET_FLAG"]);
