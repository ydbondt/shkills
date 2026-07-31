import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachUser } from './auth.js';
import { errorHandler } from './http.js';
import { authRouter } from './routes/auth.js';
import { skillsRouter } from './routes/skills.js';
import { collectionsRouter } from './routes/collections.js';
import { subscriptionsRouter } from './routes/subscriptions.js';
import { syncRouter } from './routes/sync.js';
import { deviceRouter, tokensRouter } from './routes/device.js';
import { adminRouter } from './routes/admin.js';
import { installRouter } from './routes/install.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(attachUser);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'shkills' });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/skills', skillsRouter);
  app.use('/api/v1/collections', collectionsRouter);
  app.use('/api/v1/subscriptions', subscriptionsRouter);
  app.use('/api/v1/sync', syncRouter);
  app.use('/api/v1/device', deviceRouter);
  app.use('/api/v1/tokens', tokensRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/', installRouter);

  // The built single-page app, when it exists. Any unknown non-API path is the
  // router's problem, not a 404.
  const webRoot = [
    path.resolve(here, '../public'),
    path.resolve(here, '../../web/dist'),
    path.resolve(process.cwd(), 'packages/web/dist'),
  ].find((p) => fs.existsSync(path.join(p, 'index.html')));

  if (webRoot) {
    app.use(express.static(webRoot, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(webRoot, 'index.html'));
    });
  }

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'no such endpoint' });
      return;
    }
    next();
  });

  app.use(errorHandler);
  return app;
}
