import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import type { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import type { Config } from '../config.js';
import type { PayPalClient } from '../paypal/client.js';
import type { Store } from '../store.js';
import { errorResponse, registerRoutes } from './routes.js';
import { requirePasscode } from './passcode.js';

export type Deps = {
  config: Config;
  paypal: PayPalClient;
  store: Store;
  decide: (input: never) => Promise<never>;
  act: (...args: never[]) => Promise<never>;
  now: () => Date;
  toolkit: PayPalAgentToolkit;
};

export function createApp(deps: Deps): Express {
  const app = express();
  app.use((_req, res, next) => { res.locals.requestId = randomUUID(); next(); });
  app.use('/api', requirePasscode(deps.config.passcode));
  app.use('/api/cases/:id/attachments', express.raw({ type: '*/*', limit: '5mb' }));
  app.use(express.json());
  const router = express.Router();
  registerRoutes(router, deps);
  app.use(router);
  app.use('/vendor', express.static('node_modules/ag-grid-community/dist'));
  app.use(express.static('public'));
  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => errorResponse(error, req, res));
  return app;
}
