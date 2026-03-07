export interface AiSongCandidate {
  songId: string;
  title: string;
  artist: string;
  source: "recent" | "longterm" | "mixed";
}

export interface AiSelectorInput {
  apiKey: string;
  model: string;
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

export async function selectSongIdsWithAi(input: AiSelectorInput): Promise<string[]> {
  if (input.candidates.length === 0 || input.limit <= 0) {
    return [];
  }

  const fetchFn = input.fetchFn ?? fetch;
  const prompt = buildPrompt(input);

  const response = await fetchFn("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`
    },
    body: JSON.stringify({
      model: input.model,
      input: prompt,
      temperature: 0.6
    })
  });

  if (!response.ok) {
    throw new Error(`AI selector failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as ResponsesApiOutput;
  const text = extractResponseText(body);
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
  return Boolean((env.OPENAI_API_KEY ?? "").trim());
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

