import { describe, expect, it } from "vitest";

import { isAiRecommenderEnabled, parseSongIdsFromText, sanitizeSongIds, selectSongIdsWithAi } from "../src/recommendation/ai-selector";

describe("ai-selector", () => {
  it("parses clean json song ids", () => {
    const ids = parseSongIdsFromText('{"songIds":["1","2","3"]}');
    expect(ids).toEqual(["1", "2", "3"]);
  });

  it("parses json embedded in text", () => {
    const ids = parseSongIdsFromText('result:\n{"songIds":[1,2,3]}\nthanks');
    expect(ids).toEqual(["1", "2", "3"]);
  });

  it("sanitizes against candidate pool and fills fallback", () => {
    const ids = sanitizeSongIds(["x", "2", "2"], ["1", "2", "3"], 3);
    expect(ids).toEqual(["2", "1", "3"]);
  });

  it("detects ai enabled by api key unless explicitly disabled", () => {
    expect(isAiRecommenderEnabled({ OPENAI_API_KEY: "k" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isAiRecommenderEnabled({ OPENAI_API_KEY: "k", AI_RECOMMENDER_ENABLED: "false" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("selects ids from responses api output_text", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          output_text: '{"songIds":["2","1"]}'
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );

    const ids = await selectSongIdsWithAi({
      apiKey: "k",
      model: "gpt-4.1-mini",
      limit: 2,
      candidates: [
        { songId: "1", title: "a", artist: "b", source: "mixed" },
        { songId: "2", title: "c", artist: "d", source: "mixed" }
      ],
      recentHints: [],
      longTermHints: [],
      fetchFn
    });

    expect(ids).toEqual(["2", "1"]);
  });
});

