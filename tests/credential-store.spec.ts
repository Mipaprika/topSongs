import { describe, expect, it } from "vitest";

import { CredentialStore } from "../src/security/credential-store";

describe("CredentialStore", () => {
  it("round-trips encrypted credential payload", () => {
    const store = new CredentialStore("test-master-key-32bytes-min");
    const cipher = store.encrypt({ cookie: "abc=1", expiresAt: "2026-03-06T00:00:00Z" });
    const plain = store.decrypt<{ cookie: string; expiresAt: string }>(cipher);

    expect(plain.cookie).toBe("abc=1");
    expect(plain.expiresAt).toBe("2026-03-06T00:00:00Z");
  });

  it("throws on modified payload", () => {
    const store = new CredentialStore("test-master-key-32bytes-min");
    const cipher = store.encrypt({ cookie: "abc=1" });
    const envelope = Buffer.from(cipher, "base64url");
    envelope[0] = envelope[0] ^ 0xff;
    const tampered = envelope.toString("base64url");

    expect(() => store.decrypt(tampered)).toThrow(/decrypt/i);
  });
});
