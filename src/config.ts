import { resolve } from 'node:path';

export type Config = {
  paypalClientId: string;
  paypalClientSecret: string;
  anthropicApiKey: string;
  passcode: string;
  port: number;
  dataDir: string;
  seedPath: string;
  snapshotPath: string | null;
  mode: 'live' | 'replay';
  publicReplay: boolean;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port)) throw new Error('PORT must be a number');
  const mode = env.KEPT_FAKE_PAYPAL === '1' ? 'replay' : 'live';
  const replay = mode === 'replay';
  const publicReplay = env.KEPT_PUBLIC_REPLAY === '1';
  if (publicReplay && !replay) throw new Error('KEPT_PUBLIC_REPLAY=1 needs KEPT_FAKE_PAYPAL=1');
  return {
    paypalClientId: publicReplay ? '' : replay ? env.PAYPAL_CLIENT_ID ?? '' : required(env, 'PAYPAL_CLIENT_ID'),
    paypalClientSecret: publicReplay ? '' : replay ? env.PAYPAL_CLIENT_SECRET ?? '' : required(env, 'PAYPAL_CLIENT_SECRET'),
    anthropicApiKey: publicReplay ? '' : replay ? env.ANTHROPIC_API_KEY ?? '' : required(env, 'ANTHROPIC_API_KEY'),
    passcode: publicReplay ? '' : required(env, 'KEPT_PASSCODE'),
    port,
    dataDir: env.KEPT_DATA_DIR ?? (replay ? './data/replay' : './data'),
    seedPath: env.KEPT_SEED_PATH ? resolve(env.KEPT_SEED_PATH) : resolve(process.cwd(), replay ? 'seed/replay/cases.json' : 'seed/cases.json'),
    snapshotPath: publicReplay ? resolve(process.cwd(), 'seed/replay/snapshot.json') : replay ? null : resolve(process.cwd(), 'seed/snapshot.json'),
    mode,
    publicReplay,
  };
}
