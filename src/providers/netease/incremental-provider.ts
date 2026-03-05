import type { NeteaseIncrementalProvider as IncrementalProviderInterface } from "../../ingest/netease-incremental";
import type { FetchEventsResult } from "./types";

export interface NeteaseEventFetcher {
  fetchEvents(cursor: string): Promise<FetchEventsResult>;
}

export class NeteaseIncrementalProvider implements IncrementalProviderInterface {
  constructor(private readonly fetcher: NeteaseEventFetcher) {}

  async fetchSince(cursor: string) {
    const { nextCursor, rawEvents } = await this.fetcher.fetchEvents(cursor);

    return {
      nextCursor,
      events: rawEvents
        .map((event) => parseRawEvent(event))
        .filter(
          (event): event is { eventId: string; songId: string; actionType: "LIKE" | "FAVORITE"; actionTime: number } =>
            event !== null
        )
    };
  }
}

function parseRawEvent(rawEvent: { id: string; eventTime: number; json: string }) {
  let payload: unknown;
  try {
    payload = JSON.parse(rawEvent.json);
  } catch {
    return null;
  }

  const songId = findSongId(payload);
  if (!songId) {
    return null;
  }

  return {
    eventId: rawEvent.id,
    songId,
    actionType: inferActionType(payload),
    actionTime: rawEvent.eventTime
  };
}

function findSongId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const obj = payload as Record<string, unknown>;
  const directSong = obj.song as Record<string, unknown> | undefined;
  if (directSong && (typeof directSong.id === "string" || typeof directSong.id === "number")) {
    return String(directSong.id);
  }

  const resource = obj.resource as Record<string, unknown> | undefined;
  const resourceSong = resource?.song as Record<string, unknown> | undefined;
  if (resourceSong && (typeof resourceSong.id === "string" || typeof resourceSong.id === "number")) {
    return String(resourceSong.id);
  }

  return null;
}

function inferActionType(payload: unknown): "LIKE" | "FAVORITE" {
  if (typeof payload !== "object" || payload === null) {
    return "LIKE";
  }

  const obj = payload as Record<string, unknown>;
  const textCandidates = [obj.msg, obj.actName, obj.title, obj.reason]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (/收藏|歌单|playlist/i.test(textCandidates)) {
    return "FAVORITE";
  }

  return "LIKE";
}
