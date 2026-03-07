export interface AiSongCandidate {
  songId: string;
  title: string;
  artist: string;
  source: "recent" | "longterm" | "mixed";
}

export interface AiSelectorInput {
  provider: "openai" | "openai-compatible" | "aliyun-bailian";
  apiKey: string;
  model: string;
  baseUrl?: string;
  limit: number;
  candidates: AiSongCandidate[];
  recentHints: string[];
  longTermHints: string[];
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

export async function selectSongIdsWithAi(input: AiSelectorInput): Promise<string[]> {
  if (input.candidates.length === 0 || input.limit <= 0) {
    return [];
  }

  const fetchFn = input.fetchFn ?? fetch;
  const prompt = buildPrompt(input);
  const endpoint = resolveEndpoint(input);
  const requestBody = buildRequestBody(input, prompt);

  const response = await fetchFn(endpoint, {
    method: "POST",
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
  const parsed = parseSongIdsFromText(text);
  return sanitizeSongIds(parsed, input.candidates.map((item) => item.songId), input.limit);
}

export function parseSongIdsFromText(text: string): string[] {
  const raw = text.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as { songIds?: unknown };
    if (Array.isArray(parsed.songIds)) {
      return parsed.songIds
        .map((item) => (typeof item === "string" || typeof item === "number" ? String(item) : null))
        .filter((item): item is string => item !== null);
    }
  } catch {
    // ignore and try object extraction
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]) as { songIds?: unknown };
    if (!Array.isArray(parsed.songIds)) {
      return [];
    }
    return parsed.songIds
      .map((item) => (typeof item === "string" || typeof item === "number" ? String(item) : null))
      .filter((item): item is string => item !== null);
  } catch {
    return [];
  }
}

export function sanitizeSongIds(songIds: string[], validIds: string[], limit: number): string[] {
  const validSet = new Set(validIds);
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const id of songIds) {
    if (!validSet.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(id);
    if (deduped.length >= limit) {
      return deduped;
    }
  }

  for (const id of validIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(id);
    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
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
  const candidatesJson = JSON.stringify(input.candidates, null, 2);
  const recentHints = input.recentHints.slice(0, 20).join(", ") || "none";
  const longTermHints = input.longTermHints.slice(0, 40).join(", ") || "none";

  return [
    "You are a music recommender.",
    "Goal: choose songs user is likely to like now.",
    "Policy: mostly similarity-driven, plus a smaller exploration portion.",
    "Exploration target: around 20%-30% of final picks.",
    `Return exactly ${input.limit} unique songIds from the candidate list.`,
    "Do not output explanations.",
    'Output JSON only: {"songIds":["id1","id2",...]}',
    "",
    `Recent hints: ${recentHints}`,
    `Long-term hints: ${longTermHints}`,
    "",
    "Candidates:",
    candidatesJson
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
      temperature: 0.6
    };
  }

  return {
    model: input.model,
    temperature: 0.6,
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
