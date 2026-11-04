import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { PayPalClient } from './paypal/client.js';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { createApp } from './http/app.js';

const config = loadConfig(process.env);
const store = await Store.open({ dataDir: config.dataDir, seedPath: config.seedPath });
const paypal = new PayPalClient({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret });
const toolkit = new PayPalAgentToolkit({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret, configuration: { actions: { disputes: { list: true, get: true, create: true } }, context: { sandbox: true } } });
const app = createApp({ config, paypal, store, toolkit, now: () => new Date(), decide: async () => { throw new Error('Not wired yet'); }, act: async () => { throw new Error('Not wired yet'); } });
app.listen(config.port, () => console.log(`Settle listening on ${config.port}`));
