import { describe, expect, it } from "vitest";

import { NeteaseIncrementalProvider } from "../src/providers/netease/incremental-provider";

describe("NeteaseIncrementalProvider", () => {
  it("maps /event response into incremental events", async () => {
    const provider = new NeteaseIncrementalProvider({
      fetchEvents: async (cursor) => {
        expect(cursor).toBe("1000");
        return {
          nextCursor: "1200",
          rawEvents: [
            {
              id: "evt-1",
              eventTime: 1100,
              json: JSON.stringify({
                song: { id: "s1" },
                msg: "赞了歌曲"
              })
            },
            {
              id: "evt-2",
              eventTime: 1200,
              json: JSON.stringify({
                song: { id: "s2" },
                msg: "收藏到歌单"
              })
            }
          ]
        };
      }
    });

    const result = await provider.fetchSince("1000");

    expect(result.nextCursor).toBe("1200");
    expect(result.events).toEqual([
      { eventId: "evt-1", songId: "s1", actionType: "LIKE", actionTime: 1100 },
      { eventId: "evt-2", songId: "s2", actionType: "FAVORITE", actionTime: 1200 }
    ]);
  });
});
