import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DoubanSongRow } from "./douban-parser";

const PAGE_SIZE = 15;

export interface FetchDoubanBaselineOptions {
  userId: string;
  fetchFn?: typeof fetch;
}

type DoubanStatus = "do" | "wish" | "collect";

export async function fetchDoubanBaselineFromPublicPages(
  options: FetchDoubanBaselineOptions
): Promise<DoubanSongRow[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const statuses: DoubanStatus[] = ["do", "wish", "collect"];
  const allRows: DoubanSongRow[] = [];

  for (const status of statuses) {
    let start = 0;

    while (true) {
      const url = buildDoubanMusicUrl(options.userId, status, start);
      const response = await fetchFn(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
        }
      });

      if (!response.ok) {
        throw new Error(`Douban request failed: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const pageRows = parseDoubanMusicPage(html, status);
      if (pageRows.length === 0) {
        break;
      }

      allRows.push(...pageRows);
      if (!hasNextPage(html)) {
        break;
      }
      start += PAGE_SIZE;
    }
  }

  return dedupeRows(allRows);
}

export function parseDoubanMusicPage(html: string, status: DoubanStatus): DoubanSongRow[] {
  const rows: DoubanSongRow[] = [];
  const itemBlocks = html.split('<div class="item comment-item"').slice(1);

  for (const block of itemBlocks) {
    const titleMatch = block.match(/<li class="title">[\s\S]*?<em>(.*?)<\/em>/i);
    const introMatch = block.match(/<li class="intro">(.*?)<\/li>/i);
    if (!titleMatch || !introMatch) {
      continue;
    }

    const title = decodeHtml(stripTags(titleMatch[1])).trim();
    const introText = decodeHtml(stripTags(introMatch[1])).trim();
    const introParts = introText
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);

    const artist = introParts[0] ?? "";
    const genre = introParts[introParts.length - 1] ?? "";
    if (!title || !artist) {
      continue;
    }

    rows.push({
      title,
      artist,
      tags: genre ? [`douban:${status}`, genre] : [`douban:${status}`]
    });
  }

  return rows;
}

export function writeDoubanBaselineJson(rows: DoubanSongRow[], cwd: string): string {
  const outputPath = join(cwd, "data", "douban-baseline.json");
  writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  return outputPath;
}

export function resolveDoubanUserId(env: NodeJS.ProcessEnv): string | null {
  if (env.DOUBAN_USER_ID?.trim()) {
    return env.DOUBAN_USER_ID.trim();
  }

  const url = env.DOUBAN_PROFILE_URL?.trim();
  if (!url) {
    return null;
  }

  const match = url.match(/douban\.com\/people\/([^/]+)/i);
  return match?.[1] ?? null;
}

function buildDoubanMusicUrl(userId: string, status: DoubanStatus, start: number): string {
  return `https://music.douban.com/people/${userId}/${status}?start=${start}&sort=time&rating=all&filter=all&mode=grid`;
}

function hasNextPage(html: string): boolean {
  return /后页&gt;|后页>/i.test(html);
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

function dedupeRows(rows: DoubanSongRow[]): DoubanSongRow[] {
  const seen = new Set<string>();
  const deduped: DoubanSongRow[] = [];

  for (const row of rows) {
    const key = `${row.artist}\n${row.title}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function decodeHtml(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
