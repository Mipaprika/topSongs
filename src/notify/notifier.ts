export interface Notifier {
  sendReloginRequired(): Promise<void>;
  sendJobFailure?(message: string): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  async sendReloginRequired(): Promise<void> {
    console.error("[notify] Netease auth expired, relogin required.");
  }

  async sendJobFailure(message: string): Promise<void> {
    console.error(`[notify] Daily job failed: ${message}`);
  }
}
