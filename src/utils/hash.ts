import crypto from "node:crypto";

/** SHA-256 hex digest of a string. */
export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}
