import { runCli } from "./cli";

async function main(): Promise<void> {
  const output = await runCli(process.argv.slice(2));
  console.log(output);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
