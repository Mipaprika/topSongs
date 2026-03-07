import { describe, expect, it, vi } from "vitest";

import { buildQrImageUrl, WebhookNotifier } from "../src/notify/notifier";

describe("notifier", () => {
  it("builds qr image url from qrurl + unikey", () => {
    const output = buildQrImageUrl("https://music.163.com/login?codekey=u1", "u1");
    expect(output).toContain("api.qrserver.com");
    expect(output).toContain("size=320x320");
    expect(output).toContain("codekey%3Du1");
    expect(output).toContain("t=u1");
  });

  it("posts feishu text payload", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const notifier = new WebhookNotifier("https://example.com/hook", "feishu", fetchFn);

    await notifier.sendJobFailure("boom");

    const [, init] = fetchFn.mock.calls[0];
    const payload = JSON.parse(String(init?.body)) as { msg_type: string; content: { text: string } };
    expect(payload.msg_type).toBe("text");
    expect(payload.content.text).toContain("boom");
  });

  it("posts dingtalk text payload", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const notifier = new WebhookNotifier("https://example.com/hook", "dingtalk", fetchFn);

    await notifier.sendJobWarning("warn");

    const [, init] = fetchFn.mock.calls[0];
    const payload = JSON.parse(String(init?.body)) as { msgtype: string; text: { content: string } };
    expect(payload.msgtype).toBe("text");
    expect(payload.text.content).toContain("warn");
  });
});

