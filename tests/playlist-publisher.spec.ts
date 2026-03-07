import { describe, expect, it } from "vitest";

import { publishDailyPlaylist } from "../src/publish/playlist-publisher";

describe("publishDailyPlaylist", () => {
  it("clears existing tracks then adds exactly 20 picks", async () => {
    const state = {
      removeAllCalled: false,
      added: [] as string[]
    };

    const provider = {
      async removeAllTracks(playlistId: string) {
        expect(playlistId).toBe("playlist-id");
        state.removeAllCalled = true;
      },
      async addTracks(playlistId: string, songs: string[]) {
        expect(playlistId).toBe("playlist-id");
        state.added = songs;
      },
      async replaceDescription(playlistId: string, description: string) {
        expect(playlistId).toBe("playlist-id");
        expect(description).toBe("desc");
      }
    };

    const songs = Array.from({ length: 22 }, (_, i) => `s${i + 1}`);
    await publishDailyPlaylist("playlist-id", songs, provider, "desc");

    expect(state.removeAllCalled).toBe(true);
    expect(state.added.length).toBe(20);
    expect(state.added[0]).toBe("s1");
    expect(state.added[19]).toBe("s20");
  });
});
