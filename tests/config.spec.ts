import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("throws when MASTER_KEY is missing", () => {
    expect(() =>
      loadConfig({
        MASTER_KEY: ""
      } as NodeJS.ProcessEnv)
    ).toThrow(/MASTER_KEY/);
  });
});
