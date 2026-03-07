import { URL } from "node:url";

export interface ReloginPayload {
  unikey?: string;
  qrurl?: string;
  qrimg?: string;
}

export interface Notifier {
  sendReloginRequired(payload?: ReloginPayload): Promise<void>;
  sendJobFailure?(message: string): Promise<void>;
  sendJobWarning?(message: string): Promise<void>;
  sendJobSuccess?(message: string): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  async sendReloginRequired(payload?: ReloginPayload): Promise<void> {
    console.error("[notify] Netease auth expired, relogin required.");
    if (payload?.unikey) {
      console.error(`[notify] unikey=${payload.unikey}`);
    }
    if (payload?.qrurl) {
      console.error(`[notify] qrurl=${payload.qrurl}`);
    }
    if (payload?.qrimg) {
      console.error(`[notify] qrimg=${payload.qrimg}`);
    }
  }

  async sendJobFailure(message: string): Promise<void> {
    console.error(`[notify] Daily job failed: ${message}`);
  }

  async sendJobWarning(message: string): Promise<void> {
    console.error(`[notify] Daily job warning: ${message}`);
  }

  async sendJobSuccess(message: string): Promise<void> {
    console.error(`[notify] Daily job success: ${message}`);
  }
}

type WebhookFormat = "generic" | "feishu" | "dingtalk" | "wecom";

export class WebhookNotifier implements Notifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly format: WebhookFormat = "generic",
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async sendReloginRequired(payload?: ReloginPayload): Promise<void> {
    const lines = ["网易云登录已失效，请重新扫码登录。"];
    if (payload?.unikey) {
      lines.push(`unikey: ${payload.unikey}`);
    }
    if (payload?.qrurl) {
      lines.push(`qrurl: ${payload.qrurl}`);
      lines.push(`qrimg: ${payload.qrimg ?? buildQrImageUrl(payload.qrurl, payload.unikey)}`);
    }
    await this.postText(lines.join("\n"));
  }

  async sendJobFailure(message: string): Promise<void> {
    await this.postText(`每日推荐任务失败\n${message}`);
  }

  async sendJobWarning(message: string): Promise<void> {
    await this.postText(`每日推荐任务告警\n${message}`);
  }

  async sendJobSuccess(message: string): Promise<void> {
    await this.postText(message);
  }

  private async postText(text: string): Promise<void> {
    const response = await this.fetchFn(this.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(buildWebhookBody(this.format, text))
    });

    if (!response.ok) {
      throw new Error(`webhook notify failed: ${response.status} ${response.statusText}`);
    }
  }
}

export function createNotifierFromEnv(env: NodeJS.ProcessEnv): Notifier {
  const webhookUrl = (env.NOTIFY_WEBHOOK_URL ?? "").trim();
  if (!webhookUrl) {
    return new ConsoleNotifier();
  }
  const format = normalizeFormat(env.NOTIFY_WEBHOOK_FORMAT);
  return new WebhookNotifier(webhookUrl, format);
}

export function buildQrImageUrl(qrurl: string, unikey?: string): string {
  const url = new URL("https://api.qrserver.com/v1/create-qr-code/");
  url.searchParams.set("size", "320x320");
  url.searchParams.set("data", qrurl);
  if (unikey) {
    url.searchParams.set("t", unikey);
  }
  return url.toString();
}

function normalizeFormat(value: string | undefined): WebhookFormat {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "feishu" || normalized === "dingtalk" || normalized === "wecom") {
    return normalized;
  }
  return "generic";
}

function buildWebhookBody(format: WebhookFormat, text: string): Record<string, unknown> {
  if (format === "feishu") {
    return {
      msg_type: "text",
      content: { text }
    };
  }
  if (format === "dingtalk" || format === "wecom") {
    return {
      msgtype: "text",
      text: { content: text }
    };
  }
  return { text };
}
