import type { DbClient } from "../db/client";

export interface NeteaseIncrementalState {
  cursor: string;
}

export interface NeteaseIncrementalEvent {
  eventId: string;
  songId: string;
  actionType: string;
  actionTime: number;
}

export interface NeteaseIncrementalProvider {
  fetchSince(cursor: string): Promise<{
    nextCursor: string;
    events: NeteaseIncrementalEvent[];
  }>;
}

export interface IncrementalIngestResult {
  inserted: number;
  nextCursor: string;
}

export async function ingestIncremental(
  state: NeteaseIncrementalState,
  db: DbClient,
  provider: NeteaseIncrementalProvider
): Promise<IncrementalIngestResult> {
  const response = await provider.fetchSince(state.cursor);
  let inserted = 0;

  for (const event of response.events) {
    const insertedNow = db.insertNeteaseEvent({
      idempotencyKey: `${event.eventId}:${event.actionType}:${event.actionTime}`,
      eventId: event.eventId,
      songId: event.songId,
      actionType: event.actionType,
      actionTime: event.actionTime
    });
    if (insertedNow) {
      inserted += 1;
    }
  }

  return {
    inserted,
    nextCursor: response.nextCursor
  };
}
