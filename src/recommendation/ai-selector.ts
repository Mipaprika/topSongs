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
  longTermHints: string[];
  preferenceTags?: string[];
  excludedWorks: Array<{ title: string; artist: string }>;
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

  const response = await fetchFn(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`AI selector failed: ${response.status} ${response.statusText}`);
  }

  const text = await extractModelText(response, input.provider);
  const parsed = parseWorksFromText(text);
  return sanitizeWorks(parsed, input.excludedWorks, input.limit);
}

export function parseWorksFromText(text: string): AiRecommendedWork[] {
  const raw = text.trim();
  if (!raw) return [];

  const parsed = tryParseObject(raw) ?? tryParseObject(raw.match(/\{[\s\S]*\}/)?.[0] ?? "");
  if (!parsed || !Array.isArray(parsed.recommendations)) {
    return [];
  }

  const works: AiRecommendedWork[] = [];
  for (const item of parsed.recommendations) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title.trim() : "";
    const artist = typeof (item as { artist?: unknown }).artist === "string" ? (item as { artist: string }).artist.trim() : "";
    const reason =
      typeof (item as { reason?: unknown }).reason === "string" ? (item as { reason: string }).reason.trim() : undefined;
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
  const longTermHints = input.longTermHints.slice(0, 60).join(", ") || "none";
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
    "Important: recommendations must avoid the excluded works list.",
    'Output JSON only: {"recommendations":[{"title":"...","artist":"...","reason":"...","exploration":false}]}',
    "",
    `Need ${input.limit} recommendations.`,
    `Recent taste hints: ${recentHints}`,
    `Long-term taste hints: ${longTermHints}`,
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

function tryParseObject(text: string): { recommendations?: unknown } | null {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as { recommendations?: unknown };
  } catch {
    return null;
  }
}

function normalizeWorkKey(title: string, artist: string): string {
  return `${title}\n${artist}`.trim().toLowerCase();
}
