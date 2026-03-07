import { describe, expect, it, vi } from "vitest";

import { WebhookNotifier } from "../src/notify/notifier";

describe("notifier", () => {
  it("includes qrurl + unikey by default", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const notifier = new WebhookNotifier("https://example.com/hook", "generic", fetchFn);

    await notifier.sendReloginRequired({ unikey: "u1", qrurl: "https://music.163.com/login?codekey=u1" });

    const [, init] = fetchFn.mock.calls[0];
    const payload = JSON.parse(String(init?.body)) as { text: string };
    expect(payload.text).toContain("unikey: u1");
    expect(payload.text).toContain("qrurl: https://music.163.com/login?codekey=u1");
  });

  it("hides qrurl + unikey when includeQrUrl is disabled", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const notifier = new WebhookNotifier("https://example.com/hook", "generic", fetchFn, undefined, false);

    await notifier.sendReloginRequired({ unikey: "u1", qrurl: "https://music.163.com/login?codekey=u1" });

    const [, init] = fetchFn.mock.calls[0];
    const payload = JSON.parse(String(init?.body)) as { text: string };
    expect(payload.text).not.toContain("unikey: u1");
    expect(payload.text).not.toContain("qrurl:");
    expect(payload.text).toContain("已出于安全策略隐藏二维码链接");
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

  it("posts telegram payload with chat_id", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const notifier = new WebhookNotifier("https://api.telegram.org/botx/sendMessage", "telegram", fetchFn, "10001");

    await notifier.sendJobSuccess?.("ok");

    const [, init] = fetchFn.mock.calls[0];
    const payload = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
    expect(payload.chat_id).toBe("10001");
    expect(payload.text).toBe("ok");
  });
});
