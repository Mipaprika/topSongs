import { runOnceDryRun } from "./jobs/run-once";

const HELP_TEXT = `
Usage: top-songs <command>

Commands:
  bootstrap-login   Start Netease QR login bootstrap
  douban-sync       Run one-time Douban baseline import
  run-once          Execute one daily recommendation run
`;

export async function runCli(args: string[]): Promise<string> {
  const [command, ...flags] = args;

  if (!command || command === "--help" || command === "-h") {
    return HELP_TEXT.trim();
  }

  switch (command) {
    case "bootstrap-login":
      return "bootstrap-login started";
    case "douban-sync":
      return "douban-sync started";
    case "run-once":
      if (flags.includes("--dry-run")) {
        const result = runOnceDryRun();
        return `run-once dry-run completed: selectedCount=${result.selectedCount}`;
      }
      return "run-once started";
    default:
      return `Unknown command: ${command}\n\n${HELP_TEXT.trim()}`;
  }
}
