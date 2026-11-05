import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { decideCase } from './ai/decide.js';
import { createSettleModel } from './ai/provider.js';
import { modelToolset, submitDecisionTool } from './ai/tools.js';
import { PayPalClient } from './paypal/client.js';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { createApp } from './http/app.js';
import { performAction } from './actions.js';

const config = loadConfig(process.env);
const store = await Store.open({ dataDir: config.dataDir, seedPath: config.seedPath });
const paypal = new PayPalClient({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret });
const toolkit = new PayPalAgentToolkit({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret, configuration: { actions: { disputes: { list: true, get: true, create: true } }, context: { sandbox: true } } });
const model = createSettleModel(config.anthropicApiKey);
const tools = { ...modelToolset(toolkit), submit_decision: submitDecisionTool() };
const app = createApp({ config, paypal, store, toolkit, now: () => new Date(), decide: (input) => decideCase(input, { model, tools }), act: performAction });
app.listen(config.port, () => console.log(`Settle listening on ${config.port}`));
