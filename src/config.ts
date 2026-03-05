export interface AppConfig {
  masterKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  if (!env.MASTER_KEY || env.MASTER_KEY.trim() === "") {
    throw new Error("MASTER_KEY is required");
  }

  return {
    masterKey: env.MASTER_KEY
  };
}
