export type Config = {
  paypalClientId: string;
  paypalClientSecret: string;
  anthropicApiKey: string;
  passcode: string;
  port: number;
  dataDir: string;
  seedPath: string;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port)) throw new Error('PORT must be a number');
  return {
    paypalClientId: required(env, 'PAYPAL_CLIENT_ID'),
    paypalClientSecret: required(env, 'PAYPAL_CLIENT_SECRET'),
    anthropicApiKey: required(env, 'ANTHROPIC_API_KEY'),
    passcode: required(env, 'SETTLE_PASSCODE'),
    port,
    dataDir: env.SETTLE_DATA_DIR ?? './data',
    seedPath: env.SETTLE_SEED_PATH ?? './seed/cases.json',
  };
}
