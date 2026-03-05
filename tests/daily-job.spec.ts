import { describe, expect, it } from "vitest";

import { runDailyJob } from "../src/jobs/daily-job";

describe("runDailyJob", () => {
  it("sends relogin notification and aborts publish when auth refresh fails", async () => {
    const state = {
      notified: false,
      published: false
    };

    const result = await runDailyJob({
      cookie: "expired-cookie",
      authClient: {
        async refresh() {
          return { ok: false as const, reason: "RELOGIN_REQUIRED" as const };
        }
      },
      notifier: {
        async sendReloginRequired() {
          state.notified = true;
        }
      },
      publisher: {
        async publish() {
          state.published = true;
        }
      }
    });

    expect(result.status).toBe("AUTH_EXPIRED");
    expect(state.notified).toBe(true);
    expect(state.published).toBe(false);
  });
});
