import { customType } from "drizzle-orm/pg-core";

export const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array | string }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer) {
    return value;
  },
  fromDriver(value: Buffer | Uint8Array | string) {
    if (typeof value === "string") {
      // postgres.js returns hex-escaped strings for bytea when not configured otherwise.
      return value.startsWith("\\x") ? Buffer.from(value.slice(2), "hex") : Buffer.from(value, "binary");
    }
    return Buffer.from(value);
  },
});
