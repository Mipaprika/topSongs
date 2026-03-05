import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function deriveKey(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey, "utf8").digest();
}

export function encryptJson(masterKey: string, payload: unknown): string {
  const key = deriveKey(masterKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const envelope = Buffer.concat([iv, authTag, ciphertext]);
  return envelope.toString("base64url");
}

export function decryptJson<T>(masterKey: string, blob: string): T {
  try {
    const key = deriveKey(masterKey);
    const envelope = Buffer.from(blob, "base64url");

    if (envelope.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error("encrypted blob too short");
    }

    const iv = envelope.subarray(0, IV_LENGTH);
    const authTag = envelope.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = envelope.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch (error) {
    throw new Error(`decrypt failed: ${(error as Error).message}`);
  }
}
