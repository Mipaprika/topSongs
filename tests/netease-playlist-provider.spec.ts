import { describe, expect, it } from "vitest";

import { NeteasePlaylistProvider } from "../src/providers/netease/playlist-provider";

describe("NeteasePlaylistProvider", () => {
  it("removes all tracks before adding new ones", async () => {
    const calls: Array<{ op: "add" | "del"; tracks: string[] }> = [];

    const provider = new NeteasePlaylistProvider({
      getPlaylistTrackIds: async (playlistId) => {
        expect(playlistId).toBe("p1");
        return ["s-old-1", "s-old-2"];
      },
      updatePlaylistTracks: async (playlistId, op, tracks) => {
        expect(playlistId).toBe("p1");
        calls.push({ op, tracks });
      },
      updatePlaylistDescription: async () => {
        return;
      }
    });

    await provider.removeAllTracks("p1");
    await provider.addTracks("p1", ["s1", "s2", "s3"]);

    expect(calls).toEqual([
      { op: "del", tracks: ["s-old-1", "s-old-2"] },
      { op: "add", tracks: ["s3", "s2", "s1"] }
    ]);
  });
});
