import { decryptJson, encryptJson } from "./crypto";

export class CredentialStore {
  constructor(private readonly masterKey: string) {}

  encrypt(payload: unknown): string {
    return encryptJson(this.masterKey, payload);
  }

  decrypt<T>(blob: string): T {
    return decryptJson<T>(this.masterKey, blob);
  }
}
