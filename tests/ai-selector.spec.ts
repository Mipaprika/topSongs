import { describe, expect, it } from "vitest";

import {
  isAiRecommenderEnabled,
  parseSongIdsFromText,
  resolveAiApiKey,
  resolveAiBaseUrl,
  resolveAiModel,
  resolveAiProvider,
  sanitizeSongIds,
  selectSongIdsWithAi
} from "../src/recommendation/ai-selector";

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

  it("resolves generic llm config with bailian defaults", () => {
    const env = {
      LLM_PROVIDER: "aliyun-bailian",
      LLM_API_KEY: "k"
    } as NodeJS.ProcessEnv;

    expect(resolveAiProvider(env)).toBe("aliyun-bailian");
    expect(resolveAiApiKey(env)).toBe("k");
    expect(resolveAiModel(env)).toBe("qwen-plus-latest");
    expect(resolveAiBaseUrl(env)).toBeUndefined();
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
      provider: "openai",
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

  it("uses compatible base url when provided", async () => {
    let calledUrl = "";
    const fetchFn: typeof fetch = async (input) => {
      calledUrl = String(input);
      return new Response(JSON.stringify({ output_text: '{"songIds":["2","1"]}' }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    await selectSongIdsWithAi({
      provider: "aliyun-bailian",
      apiKey: "k",
      model: "qwen-plus-latest",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      limit: 2,
      candidates: [
        { songId: "1", title: "a", artist: "b", source: "mixed" },
        { songId: "2", title: "c", artist: "d", source: "mixed" }
      ],
      recentHints: [],
      longTermHints: [],
      fetchFn
    });

    expect(calledUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/responses");
  });
});
