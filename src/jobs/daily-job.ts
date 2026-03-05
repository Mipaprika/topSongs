import type { NeteaseAuthClient } from "../providers/netease/auth-client";
import type { Notifier } from "../notify/notifier";

export interface DailyPublisher {
  publish(): Promise<void>;
}

export interface RunDailyJobInput {
  cookie: string;
  authClient: Pick<NeteaseAuthClient, "refresh">;
  notifier: Pick<Notifier, "sendReloginRequired">;
  publisher: DailyPublisher;
}

export type DailyJobResult =
  | { status: "AUTH_EXPIRED" }
  | { status: "PUBLISHED" };

export async function runDailyJob(input: RunDailyJobInput): Promise<DailyJobResult> {
  const authResult = await input.authClient.refresh(input.cookie);

  if (!authResult.ok) {
    await input.notifier.sendReloginRequired();
    return { status: "AUTH_EXPIRED" };
  }

  await input.publisher.publish();
  return { status: "PUBLISHED" };
}
