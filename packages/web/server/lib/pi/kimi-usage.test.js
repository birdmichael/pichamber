import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getPiKimiUsage, mapKimiUsagesToWindows } from './kimi-usage.js';

const tempHomes = [];
afterEach(() => {
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const makeTemp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-kimi-usage-'));
  tempHomes.push(dir);
  return dir;
};

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const installKimiSlot = (home) => {
  writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
    packages: ['npm:pi-kimi-code-console-usage'],
  });
};

const writeOauth = (home, extra = {}) => {
  writeJson(path.join(home, '.pi', 'agent', 'auth.json'), {
    'kimi-coding': {
      type: 'oauth',
      access: 'access-secret',
      refresh: 'refresh-secret',
      expires: 1_900_000_000_000,
      ...extra,
    },
  });
};

describe('mapKimiUsagesToWindows', () => {
  it('maps string used/remaining onto weekly and 5h windows', () => {
    const windows = mapKimiUsagesToWindows({
      usage: { limit: '100', used: '40', resetTime: '2030-01-15T00:00:00.000Z' },
      limits: [{
        window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
        detail: { limit: '100', remaining: '25', resetTime: '2030-01-08T00:00:00.000Z' },
      }],
    });
    expect(windows.weekly.usedPercent).toBe(40);
    expect(windows.weekly.windowSeconds).toBe(7 * 24 * 3600);
    expect(windows.weekly.resetAt).toBe(Date.parse('2030-01-15T00:00:00.000Z'));
    expect(windows['5h'].usedPercent).toBe(75);
    expect(windows['5h'].windowSeconds).toBe(5 * 60 * 60);
  });

  it('computes weekly usedPercent from remaining when used is missing', () => {
    const windows = mapKimiUsagesToWindows({
      usage: { limit: '2048', remaining: '512', resetTime: '2030-01-15T00:00:00.000Z' },
      limits: [],
    });
    expect(windows.weekly.usedPercent).toBe(75);
  });

  it('renders a freshly reset 5h window with no detail as 0%', () => {
    const windows = mapKimiUsagesToWindows({
      usage: { limit: '100', used: '10' },
      limits: [{
        window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
      }],
    });
    expect(windows['5h'].usedPercent).toBe(0);
    expect(windows['5h'].remainingPercent).toBe(100);
  });

  it('treats a limit of 100 as already-normalized percent', () => {
    expect(mapKimiUsagesToWindows({
      usage: { limit: 100, used: 33 },
    }).weekly.usedPercent).toBe(33);
  });

  it('keeps only weekly and 5h and does not put membership on valueLabel', () => {
    const windows = mapKimiUsagesToWindows({
      user: { membership: { level: 'LEVEL_INTERMEDIATE' } },
      parallel: { limit: 3 },
      extra: { used: 1, limit: 10 },
      usage: { limit: '100', used: '10' },
      limits: [
        { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' } },
        { window: { duration: 7, timeUnit: 'TIME_UNIT_DAY' }, detail: { limit: '100', used: '50' } },
      ],
    });
    expect(Object.keys(windows).sort()).toEqual(['5h', 'weekly']);
    expect(windows.weekly.valueLabel).toBeUndefined();
    expect(windows['5h'].usedPercent).toBe(0);
    expect(windows['5h'].valueLabel).toBeUndefined();
  });
});

describe('getPiKimiUsage', () => {
  it('reports slot-off without outbound fetch even when logged in', async () => {
    const home = makeTemp();
    writeOauth(home);
    let fetched = false;
    const result = await getPiKimiUsage({
      home,
      fetchImpl: async () => {
        fetched = true;
        throw new Error('should not fetch');
      },
    });
    expect(result).toEqual({ ok: false, configured: false, slotActive: false });
    expect(fetched).toBe(false);
  });

  it('reports not configured when the slot is on but there are no credentials', async () => {
    const home = makeTemp();
    installKimiSlot(home);
    const result = await getPiKimiUsage({ home, fetchImpl: async () => {
      throw new Error('should not fetch');
    } });
    expect(result).toEqual({ ok: false, configured: false, slotActive: true });
  });

  it('keeps configured true and omits a 0% window when usage fetch fails', async () => {
    const home = makeTemp();
    installKimiSlot(home);
    writeOauth(home);
    const result = await getPiKimiUsage({
      home,
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.slotActive).toBe(true);
    expect(result.usage).toBeNull();
    expect(result.error).toContain('network down');
    expect(JSON.stringify(result)).not.toContain('access-secret');
    expect(JSON.stringify(result)).not.toMatch(/"usedPercent"\s*:\s*0/);
  });

  it('returns weekly and 5h windows when usages succeeds', async () => {
    const home = makeTemp();
    installKimiSlot(home);
    writeOauth(home);
    const requested = [];
    const result = await getPiKimiUsage({
      home,
      fetchImpl: async (url) => {
        requested.push(String(url));
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            user: { membership: { level: 'LEVEL_INTERMEDIATE' } },
            usage: { limit: '100', used: '20', resetTime: '2030-02-01T00:00:00.000Z' },
            limits: [{
              window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
              detail: { limit: '100', remaining: '80' },
            }],
          }),
        };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.providerId).toBe('kimi-coding');
    expect(result.providerName).toBe('Kimi Code');
    expect(result.membershipLevel).toBe('LEVEL_INTERMEDIATE');
    expect(Object.keys(result.usage.windows).sort()).toEqual(['5h', 'weekly']);
    expect(result.usage.windows.weekly.usedPercent).toBe(20);
    expect(result.usage.windows.weekly.valueLabel).toBeUndefined();
    expect(result.usage.windows['5h'].usedPercent).toBe(20);
    expect(result.parallel).toBeUndefined();
    expect(result.extra).toBeUndefined();
    expect(result.totalQuota).toBeUndefined();
    expect(requested.some((url) => url.includes('/coding/v1/usages'))).toBe(true);
    expect(requested.some((url) => url.includes('moonshot.ai'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('access-secret');
    expect(JSON.stringify(result)).not.toContain('refresh-secret');
  });

  it('retries usages once after 401 by refreshing oauth', async () => {
    const home = makeTemp();
    installKimiSlot(home);
    writeOauth(home);
    let calls = 0;
    const result = await getPiKimiUsage({
      home,
      refreshOAuth: async () => ({
        type: 'oauth',
        access: 'access-fresh',
        refresh: 'refresh-secret',
        expires: 1_900_000_000_000,
      }),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return { ok: false, status: 401, text: async () => 'unauthorized' };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            usage: { limit: '100', used: '3' },
          }),
        };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.usage.windows.weekly.usedPercent).toBe(3);
    expect(calls).toBe(2);
  });

  it('uses an api_key when oauth is absent', async () => {
    const home = makeTemp();
    installKimiSlot(home);
    writeJson(path.join(home, '.pi', 'agent', 'auth.json'), {
      'kimi-coding': { type: 'api_key', key: 'api-secret' },
    });
    const tokens = [];
    const result = await getPiKimiUsage({
      home,
      fetchImpl: async (_url, init) => {
        tokens.push(init.headers.Authorization);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ usage: { limit: '100', used: '8' } }),
        };
      },
    });
    expect(result.ok).toBe(true);
    expect(tokens).toEqual(['Bearer api-secret']);
    expect(JSON.stringify(result)).not.toContain('api-secret');
  });
});
