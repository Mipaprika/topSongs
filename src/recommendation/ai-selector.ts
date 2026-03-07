export interface AiRecommendedWork {
  title: string;
  artist: string;
  reason?: string;
  exploration?: boolean;
}

export interface AiSelectorInput {
  provider: "openai" | "openai-compatible" | "aliyun-bailian";
  apiKey: string;
  model: string;
  baseUrl?: string;
  limit: number;
  recentHints: string[];
  longTermSongHints: string[];
  longTermAlbumHints: string[];
  preferenceTags?: string[];
  excludedWorks: Array<{ title: string; artist: string }>;
  timeoutMs?: number;
  retryCount?: number;
  fetchFn?: typeof fetch;
}

interface ResponsesApiOutput {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

interface ChatCompletionsOutput {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export async function generateWorksWithAi(input: AiSelectorInput): Promise<AiRecommendedWork[]> {
  if (input.limit <= 0) {
    return [];
  }

  const fetchFn = input.fetchFn ?? fetch;
  const prompt = buildPrompt(input);
  const endpoint = resolveEndpoint(input);
  const requestBody = buildRequestBody(input, prompt);
  const timeoutMs = Math.max(5_000, input.timeoutMs ?? 45_000);
  const retryCount = Math.max(0, input.retryCount ?? 2);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetchFn(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        if (response.status >= 500 && attempt < retryCount) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        throw new Error(`AI selector failed: ${response.status} ${response.statusText}`);
      }

      const text = await extractModelText(response, input.provider);
      const parsed = parseWorksFromText(text);
      return sanitizeWorks(parsed, input.excludedWorks, input.limit);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const timedOut = lastError.name === "TimeoutError" || /aborted|timeout/i.test(lastError.message);
      if (attempt < retryCount && timedOut) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("AI selector failed");
}

export function parseWorksFromText(text: string): AiRecommendedWork[] {
  const raw = text.trim();
  if (!raw) return [];

  const parsed =
    tryParseJson(raw) ??
    tryParseJson(raw.match(/\{[\s\S]*\}/)?.[0] ?? "") ??
    tryParseJson(raw.match(/\[[\s\S]*\]/)?.[0] ?? "");
  if (!parsed) {
    return [];
  }
  const recommendations = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { recommendations?: unknown }).recommendations)
      ? (parsed as { recommendations: unknown[] }).recommendations
      : [];
  if (recommendations.length === 0) return [];

  const works: AiRecommendedWork[] = [];
  for (const item of recommendations) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title.trim() : "";
    const artist = typeof (item as { artist?: unknown }).artist === "string" ? (item as { artist: string }).artist.trim() : "";
    const reasonRaw =
      typeof (item as { reason?: unknown }).reason === "string" ? (item as { reason: string }).reason.trim() : undefined;
    const reason = normalizeReason(reasonRaw);
    const exploration =
      typeof (item as { exploration?: unknown }).exploration === "boolean"
        ? (item as { exploration: boolean }).exploration
        : undefined;

    if (!title || !artist) {
      continue;
    }

    works.push({
      title,
      artist,
      reason,
      exploration
    });
  }

  return works;
}

export function sanitizeWorks(
  works: AiRecommendedWork[],
  excludedWorks: Array<{ title: string; artist: string }>,
  limit: number
): AiRecommendedWork[] {
  const excluded = new Set(excludedWorks.map((item) => normalizeWorkKey(item.title, item.artist)));
  const result: AiRecommendedWork[] = [];
  const seen = new Set<string>();

  for (const work of works) {
    const key = normalizeWorkKey(work.title, work.artist);
    if (excluded.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(work);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

export function isAiRecommenderEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = (env.AI_RECOMMENDER_ENABLED ?? "").trim().toLowerCase();
  if (value === "false" || value === "0" || value === "off") {
    return false;
  }
  return Boolean(resolveAiApiKey(env));
}

export function resolveAiProvider(env: NodeJS.ProcessEnv): "openai" | "openai-compatible" | "aliyun-bailian" {
  const value = (env.LLM_PROVIDER ?? "").trim().toLowerCase();
  if (value === "aliyun-bailian") {
    return "aliyun-bailian";
  }
  if (value === "openai-compatible") {
    return "openai-compatible";
  }
  return "openai";
}

export function resolveAiApiKey(env: NodeJS.ProcessEnv): string {
  return (env.LLM_API_KEY ?? env.OPENAI_API_KEY ?? "").trim();
}

export function resolveAiModel(env: NodeJS.ProcessEnv): string {
  return (env.LLM_MODEL ?? env.OPENAI_MODEL ?? defaultModelForProvider(resolveAiProvider(env))).trim();
}

export function resolveAiBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = (env.LLM_BASE_URL ?? "").trim();
  return value.length > 0 ? value : undefined;
}

function buildPrompt(input: AiSelectorInput): string {
  const recentHints = input.recentHints.slice(0, 30).join(", ") || "none";
  const longTermSongHints = input.longTermSongHints.slice(0, 80).join(", ") || "none";
  const longTermAlbumHints = input.longTermAlbumHints.slice(0, 80).join(", ") || "none";
  const preferenceTags = (input.preferenceTags ?? []).slice(0, 40).join(", ") || "none";
  const excludedWorks = input.excludedWorks
    .slice(0, 120)
    .map((item) => `${item.title} - ${item.artist}`)
    .join(", ") || "none";

  return [
    "You are a music recommender.",
    "Goal: recommend songs the user is likely to love now, not songs they already know well.",
    "Return exactly the requested number of recommendations.",
    "Selection policy:",
    "- Mostly similarity-driven, with about 20%-30% exploration.",
    "- Exploration should still stay near the user's taste.",
    "- Prefer songs adjacent to the user's long-term and recent taste.",
    "- Avoid obvious repeats of songs the user already liked or recently interacted with.",
    "- Avoid duplicate songs, alternate versions, or trivial re-picks when possible.",
    "- `reason` must be Simplified Chinese, concise and specific, no more than 30 Chinese characters, and avoid repetitive templates.",
    "Important: recommendations must avoid the excluded works list.",
    'Output JSON only: {"recommendations":[{"title":"...","artist":"...","reason":"...","exploration":false}]}',
    "",
    `Need ${input.limit} recommendations.`,
    `Recent taste hints: ${recentHints}`,
    `Long-term song taste hints (Netease): ${longTermSongHints}`,
    `Long-term album taste hints (Douban): ${longTermAlbumHints}`,
    `Preference tags: ${preferenceTags}`,
    `Excluded works: ${excludedWorks}`
  ].join("\n");
}

function extractResponseText(body: ResponsesApiOutput): string {
  if (typeof body.output_text === "string" && body.output_text.trim().length > 0) {
    return body.output_text;
  }

  const fragments: string[] = [];
  for (const block of body.output ?? []) {
    for (const content of block.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        fragments.push(content.text);
      }
    }
  }

  return fragments.join("\n");
}

function resolveEndpoint(input: AiSelectorInput): string {
  const baseUrl = input.baseUrl?.trim();
  if (baseUrl) {
    return `${baseUrl.replace(/\/+$/, "")}/${input.provider === "openai" ? "responses" : "chat/completions"}`;
  }

  if (input.provider === "aliyun-bailian") {
    return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
  }

  if (input.provider === "openai-compatible") {
    throw new Error("openai-compatible provider requires baseUrl");
  }

  return "https://api.openai.com/v1/responses";
}

function defaultModelForProvider(provider: AiSelectorInput["provider"]): string {
  if (provider === "aliyun-bailian") {
    return "qwen-plus-latest";
  }
  return "gpt-4.1-mini";
}

function buildRequestBody(input: AiSelectorInput, prompt: string): Record<string, unknown> {
  if (input.provider === "openai") {
    return {
      model: input.model,
      input: prompt,
      temperature: 0.8
    };
  }

  return {
    model: input.model,
    temperature: 0.8,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ]
  };
}

async function extractModelText(response: Response, provider: AiSelectorInput["provider"]): Promise<string> {
  if (provider === "openai") {
    const body = (await response.json()) as ResponsesApiOutput;
    return extractResponseText(body);
  }

  const body = (await response.json()) as ChatCompletionsOutput;
  return body.choices?.[0]?.message?.content?.trim() ?? "";
}

function tryParseJson(text: string): unknown | null {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function normalizeWorkKey(title: string, artist: string): string {
  return `${title}\n${artist}`.trim().toLowerCase();
}

function normalizeReason(reason: string | undefined): string | undefined {
  if (!reason) {
    return undefined;
  }
  const compact = reason.replace(/\s+/g, " ").trim();
  if (countReasonUnits(compact) <= 40) {
    return compact;
  }

  return trimReasonToUnits(compact, 40);
}

function countReasonUnits(input: string): number {
  let count = 0;
  const tokens = input.match(/[\u4e00-\u9fff]|[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
  for (const token of tokens) {
    if (/^[\u4e00-\u9fff]$/.test(token)) {
      count += 1;
      continue;
    }
    if (/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(token)) {
      count += 1;
    }
  }
  return count;
}

function trimReasonToUnits(input: string, maxUnits: number): string {
  const tokens = input.match(/[\u4e00-\u9fff]|[A-Za-z]+(?:'[A-Za-z]+)?|[^A-Za-z\u4e00-\u9fff]+/g) ?? [];
  let used = 0;
  let output = "";
  for (const token of tokens) {
    if (/^[\u4e00-\u9fff]$/.test(token)) {
      if (used + 1 > maxUnits) break;
      output += token;
      used += 1;
      continue;
    }
    if (/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(token)) {
      if (used + 1 > maxUnits) break;
      output += token;
      used += 1;
      continue;
    }
    output += token;
  }
  return output.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
