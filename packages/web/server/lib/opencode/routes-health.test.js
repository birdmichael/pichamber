import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerOpenCodeRoutes } from './routes.js';

const createApp = (overrides = {}) => {
  const app = express();
  app.use(express.json());
  registerOpenCodeRoutes(app, {
    getOpenCodeUpgradeCapability: () => ({
      supported: false,
      manager: 'openchamber',
      reason: 'bundled',
    }),
    buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
    getOpenCodeAuthHeaders: () => ({}),
    refreshOpenCodeAfterConfigChange: async () => {},
    ...overrides,
  });
  return app;
};

describe('GET /api/opencode/health on Pi kernel', () => {
  it('returns 503 when the Pi host is not ready', async () => {
    const app = createApp({
      getPiHost: () => ({ isReady: () => false }),
    });
    await request(app)
      .get('/api/opencode/health')
      .expect(503, { healthy: false, kernel: 'pi' });
  });

  it('returns 200 when the Pi host is ready', async () => {
    const app = createApp({
      getPiHost: () => ({ isReady: () => true }),
    });
    await request(app)
      .get('/api/opencode/health')
      .expect(200, { healthy: true, kernel: 'pi' });
  });

  it('returns 503 when getPiHost is missing', async () => {
    const app = createApp();
    await request(app)
      .get('/api/opencode/health')
      .expect(503, { healthy: false, kernel: 'pi' });
  });
});
