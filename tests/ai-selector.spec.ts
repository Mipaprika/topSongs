import { describe, expect, it } from "vitest";

import {
  generateWorksWithAi,
  isAiRecommenderEnabled,
  parseWorksFromText,
  resolveAiApiKey,
  resolveAiBaseUrl,
  resolveAiModel,
  resolveAiProvider,
  sanitizeWorks
} from "../src/recommendation/ai-selector";

describe("ai-selector", () => {
  it("parses clean json works", () => {
    const works = parseWorksFromText('{"recommendations":[{"title":"Song A","artist":"Artist A"},{"title":"Song B","artist":"Artist B"}]}');
    expect(works).toEqual([
      { title: "Song A", artist: "Artist A", reason: undefined, exploration: undefined },
      { title: "Song B", artist: "Artist B", reason: undefined, exploration: undefined }
    ]);
  });

  it("parses json embedded in text", () => {
    const works = parseWorksFromText('result:\n{"recommendations":[{"title":"Song A","artist":"Artist A"}]}\nthanks');
    expect(works).toEqual([{ title: "Song A", artist: "Artist A", reason: undefined, exploration: undefined }]);
  });

  it("sanitizes against excluded works and dedupes", () => {
    const works = sanitizeWorks(
      [
        { title: "Song A", artist: "Artist A" },
        { title: "Song A", artist: "Artist A" },
        { title: "Song B", artist: "Artist B" }
      ],
      [{ title: "Song A", artist: "Artist A" }],
      5
    );
    expect(works).toEqual([{ title: "Song B", artist: "Artist B" }]);
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

  it("generates works from responses api output_text", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          output_text: '{"recommendations":[{"title":"Song A","artist":"Artist A"},{"title":"Song B","artist":"Artist B"}]}'
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );

    const works = await generateWorksWithAi({
      provider: "openai",
      apiKey: "k",
      model: "gpt-4.1-mini",
      limit: 2,
      recentHints: [],
      longTermHints: [],
      excludedWorks: [],
      fetchFn
    });

    expect(works).toEqual([
      { title: "Song A", artist: "Artist A", reason: undefined, exploration: undefined },
      { title: "Song B", artist: "Artist B", reason: undefined, exploration: undefined }
    ]);
  });

  it("uses compatible base url when provided", async () => {
    let calledUrl = "";
    const fetchFn: typeof fetch = async (input) => {
      calledUrl = String(input);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"recommendations":[{"title":"Song A","artist":"Artist A"}]}'
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    };

    await generateWorksWithAi({
      provider: "aliyun-bailian",
      apiKey: "k",
      model: "qwen-plus-latest",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      limit: 1,
      recentHints: [],
      longTermHints: [],
      excludedWorks: [],
      fetchFn
    });

    expect(calledUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  });
});

