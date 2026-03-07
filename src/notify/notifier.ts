export interface ReloginPayload {
  unikey?: string;
  qrurl?: string;
}

export interface Notifier {
  sendReloginRequired(payload?: ReloginPayload): Promise<void>;
  sendJobFailure?(message: string): Promise<void>;
  sendJobWarning?(message: string): Promise<void>;
  sendJobSuccess?(message: string): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  constructor(private readonly includeQrUrl = true) {}

  async sendReloginRequired(payload?: ReloginPayload): Promise<void> {
    console.error("[notify] Netease auth expired, relogin required.");
    if (this.includeQrUrl && payload?.unikey) {
      console.error(`[notify] unikey=${payload.unikey}`);
    }
    if (this.includeQrUrl && payload?.qrurl) {
      console.error(`[notify] qrurl=${payload.qrurl}`);
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

type WebhookFormat = "generic" | "feishu" | "dingtalk" | "wecom" | "telegram";

export class WebhookNotifier implements Notifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly format: WebhookFormat = "generic",
    private readonly fetchFn: typeof fetch = fetch,
    private readonly chatId?: string,
    private readonly includeQrUrl = true
  ) {}

  async sendReloginRequired(payload?: ReloginPayload): Promise<void> {
    const lines = ["网易云登录已失效，请重新登录。"];
    if (this.includeQrUrl) {
      if (payload?.unikey) {
        lines.push(`unikey: ${payload.unikey}`);
      }
      if (payload?.qrurl) {
        lines.push(`qrurl: ${payload.qrurl}`);
      }
    } else {
      lines.push("已出于安全策略隐藏二维码链接。请在服务器上执行 bootstrap-login 获取二维码。");
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
      body: JSON.stringify(buildWebhookBody(this.format, text, this.chatId))
    });

    if (!response.ok) {
      throw new Error(`webhook notify failed: ${response.status} ${response.statusText}`);
    }
  }
}

export function createNotifierFromEnv(env: NodeJS.ProcessEnv): Notifier {
  const includeQrUrl = resolveIncludeQrUrl(env);
  const format = normalizeFormat(env.NOTIFY_WEBHOOK_FORMAT);
  if (format === "telegram") {
    const token = (env.NOTIFY_TELEGRAM_BOT_TOKEN ?? "").trim();
    const chatId = (env.NOTIFY_TELEGRAM_CHAT_ID ?? env.TELEGRAM_CHAT_ID ?? "").trim();
    if (!token || !chatId) {
      return new ConsoleNotifier(includeQrUrl);
    }
    return new WebhookNotifier(`https://api.telegram.org/bot${token}/sendMessage`, "telegram", fetch, chatId, includeQrUrl);
  }

  const webhookUrl = (env.NOTIFY_WEBHOOK_URL ?? "").trim();
  if (!webhookUrl) {
    return new ConsoleNotifier(includeQrUrl);
  }
  return new WebhookNotifier(webhookUrl, format, fetch, undefined, includeQrUrl);
}

function resolveIncludeQrUrl(env: NodeJS.ProcessEnv): boolean {
  const raw = (env.NOTIFY_INCLUDE_QRURL ?? "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") {
    return false;
  }
  return true;
}

function normalizeFormat(value: string | undefined): WebhookFormat {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "feishu" || normalized === "dingtalk" || normalized === "wecom" || normalized === "telegram") {
    return normalized;
  }
  return "generic";
}

function buildWebhookBody(format: WebhookFormat, text: string, chatId?: string): Record<string, unknown> {
  if (format === "feishu") {
    return {
      msg_type: "text",
      content: { text }
    };
  }
  if (format === "telegram") {
    if (!chatId) {
      throw new Error("telegram chat_id is required");
    }
    return {
      chat_id: chatId,
      text
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
