import { describe, expect, it } from "vitest";

import { NeteaseAuthClient } from "../src/providers/netease/auth-client";
import { HttpError } from "../src/providers/netease/types";

describe("NeteaseAuthClient", () => {
  it("returns relogin status when refresh endpoint rejects cookie", async () => {
    const client = new NeteaseAuthClient(async () => {
      throw new HttpError(401, "invalid cookie");
    });

    await expect(client.refresh("bad-cookie")).resolves.toEqual({
      ok: false,
      reason: "RELOGIN_REQUIRED"
    });
  });

  it("returns new cookie on success", async () => {
    const client = new NeteaseAuthClient(async () => {
      return { cookie: "MUSIC_U=next" };
    });

    await expect(client.refresh("old-cookie")).resolves.toEqual({
      ok: true,
      cookie: "MUSIC_U=next"
    });
  });
});
