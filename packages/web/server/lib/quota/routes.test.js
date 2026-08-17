import { describe, expect, it } from 'vitest';

import { shouldRegisterQuotaRoutes } from './routes.js';

describe('shouldRegisterQuotaRoutes', () => {
  it('skips leftover quota routes on the default Pi kernel', () => {
    expect(shouldRegisterQuotaRoutes({})).toBe(false);
    expect(shouldRegisterQuotaRoutes({ OPENCHAMBER_KERNEL: 'pi' })).toBe(false);
  });

  it('registers leftover quota routes on the OpenCode kernel', () => {
    expect(shouldRegisterQuotaRoutes({ OPENCHAMBER_KERNEL: 'opencode' })).toBe(true);
  });
});
