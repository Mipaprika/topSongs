import { describe, expect, it } from "vitest";
import { loadConfig, validateNeteaseApiBaseUrl } from "../src/config";

describe("loadConfig", () => {
  it("throws when MASTER_KEY is missing", () => {
    expect(() =>
      loadConfig({
        MASTER_KEY: ""
      } as NodeJS.ProcessEnv)
    ).toThrow(/MASTER_KEY/);
  });

  it("loads netease api config with sane defaults", () => {
    const config = loadConfig({
      MASTER_KEY: "key",
      NETEASE_API_BASE_URL: "http://127.0.0.1:3000",
      NETEASE_PLAYLIST_ID: "playlist-1"
    } as NodeJS.ProcessEnv);

    expect(config.neteaseApiBaseUrl).toBe("http://127.0.0.1:3000");
    expect(config.neteasePlaylistId).toBe("playlist-1");
  });

  it("rejects non-allowlisted host", () => {
    expect(() => validateNeteaseApiBaseUrl("https://ncm.example.com")).toThrow(/not allowed/);
  });
});
