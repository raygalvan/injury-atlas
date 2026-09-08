import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
let dataDirectory = process.env.DATA_DIR || "data";
export function configureVault(directory: string) {
  dataDirectory = directory;
}
function masterKey(): Buffer {
  let raw = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim() ?? "";
  if (!raw) {
    const file = path.join(dataDirectory, "ai-credential-key");
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    try {
      raw = readFileSync(file, "utf8").trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        writeFileSync(file, randomBytes(32).toString("hex"), {
          flag: "wx",
          mode: 0o600,
        });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      raw = readFileSync(file, "utf8").trim();
    }
  }
  if (!/^[a-fA-F0-9]{64}$/.test(raw))
    throw new Error(
      "Secure credential storage is not configured. Set CREDENTIAL_ENCRYPTION_KEY on the server.",
    );
  return Buffer.from(raw, "hex");
}
export function credentialVaultReady(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}
export function sealCredential(
  value: string,
  scope: string,
): { encrypted: Buffer; context: { version: number }; fingerprint: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(Buffer.from(scope));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    encrypted: Buffer.concat([iv, cipher.getAuthTag(), data]),
    context: { version: 1 },
    fingerprint: createHash("sha256").update(value).digest("hex"),
  };
}
export function openCredential(
  encrypted: Uint8Array,
  context: { version?: number },
  scope: string,
): string {
  if (context.version !== 1)
    throw new Error("Unsupported credential format. Reconnect this account.");
  const blob = Buffer.from(encrypted);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    blob.subarray(0, 12),
  );
  decipher.setAuthTag(blob.subarray(12, 28));
  decipher.setAAD(Buffer.from(scope));
  return Buffer.concat([
    decipher.update(blob.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
