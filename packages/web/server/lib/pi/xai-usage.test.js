import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getPiXaiUsage, mapXaiBillingToWindows } from './xai-usage.js';

const tempHomes = [];
afterEach(() => {
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const makeTemp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-xai-usage-'));
  tempHomes.push(dir);
  return dir;
};

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

describe('mapXaiBillingToWindows', () => {
  it('maps included percent and reset time onto a billing cycle window', () => {
    const windows = mapXaiBillingToWindows({
      includedUsagePercent: 42,
      resetTime: '2030-01-15T00:00:00.000Z',
      includedUsed: 42,
      includedLimit: 100,
    });
    expect(windows.billing_cycle.usedPercent).toBe(42);
    expect(windows.billing_cycle.remainingPercent).toBe(58);
    expect(windows.billing_cycle.resetAt).toBe(Date.parse('2030-01-15T00:00:00.000Z'));
    expect(windows.billing_cycle.valueLabel).toBe('42 / 100');
  });

  it('maps the grok credits envelope without inventing 0%', () => {
    const windows = mapXaiBillingToWindows({
      config: {
        creditUsagePercent: 42.5,
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          end: '2030-07-20T00:00:00Z',
        },
        onDemandCap: { val: 0 },
        onDemandUsed: { val: 0 },
      },
    });
    expect(windows.billing_cycle.usedPercent).toBe(42.5);
    expect(windows.billing_cycle.remainingPercent).toBe(57.5);
    expect(windows.billing_cycle.resetAt).toBe(Date.parse('2030-07-20T00:00:00Z'));
    expect(windows.billing_cycle.valueLabel).toBeUndefined();
  });

  it('maps legacy monthly cents wrappers and product usage percent', () => {
    expect(mapXaiBillingToWindows({
      config: {
        monthlyLimit: { val: 2000 },
        used: { val: 500 },
        billingPeriodEnd: '2030-08-01T00:00:00Z',
      },
    }).billing_cycle).toMatchObject({
      usedPercent: 25,
      valueLabel: '500 / 2000',
      resetAt: Date.parse('2030-08-01T00:00:00Z'),
    });
    expect(mapXaiBillingToWindows({
      config: {
        productUsage: [
          { product: 'GrokBuild', usagePercent: 10 },
          { product: 'GrokChat', usagePercent: 33 },
        ],
      },
    }).billing_cycle.usedPercent).toBe(33);
  });

  it('returns null when billing has no usable fields instead of a 0% window', () => {
    expect(mapXaiBillingToWindows({})).toBeNull();
    expect(mapXaiBillingToWindows({ config: {} })).toBeNull();
    expect(mapXaiBillingToWindows(null)).toBeNull();
  });
});

describe('getPiXaiUsage', () => {
  it('reports slot-off without pretending usage is empty success', async () => {
    const home = makeTemp();
    const result = await getPiXaiUsage({ home, fetchImpl: async () => {
      throw new Error('should not fetch');
    } });
    expect(result).toEqual({ ok: false, configured: false, slotActive: false });
  });

  it('treats npm:pi-xai as the Grok Usage slot', async () => {
    const home = makeTemp();
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
      packages: ['npm:pi-xai'],
    });
    const result = await getPiXaiUsage({ home, fetchImpl: async () => {
      throw new Error('should not fetch');
    } });
    expect(result).toEqual({ ok: false, configured: false, slotActive: true });
  });

  it('reports not configured when the slot is on but there is no oauth', async () => {
    const home = makeTemp();
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
      packages: ['npm:pi-xai-oauth'],
    });
    const result = await getPiXaiUsage({ home, fetchImpl: async () => {
      throw new Error('should not fetch');
    } });
    expect(result).toEqual({ ok: false, configured: false, slotActive: true });
  });

  it('keeps configured true and omits a 0% window when billing fetch fails', async () => {
    const home = makeTemp();
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
      packages: ['npm:pi-xai-oauth'],
    });
    writeJson(path.join(home, '.pi', 'agent', 'auth.json'), {
      xai: {
        type: 'oauth',
        access: 'access-secret',
        refresh: 'refresh-secret',
        expires: 1_900_000_000_000,
      },
    });
    const result = await getPiXaiUsage({
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
    expect(result.expires).toBe(1_900_000_000_000);
  });

  it('returns a billing window when the documented REST surface succeeds', async () => {
    const home = makeTemp();
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
      packages: ['npm:pi-xai-oauth'],
    });
    writeJson(path.join(home, '.pi', 'agent', 'auth.json'), {
      xai: {
        type: 'oauth',
        access: 'access-secret',
        refresh: 'refresh-secret',
        expires: 1_900_000_000_000,
      },
    });
    const requested = [];
    const result = await getPiXaiUsage({
      home,
      fetchImpl: async (url) => {
        requested.push(String(url));
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            includedUsagePercent: 10,
            resetTime: '2030-02-01T00:00:00.000Z',
          }),
        };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.usage.windows.billing_cycle.usedPercent).toBe(10);
    expect(requested.some((url) => url.includes('/v1/user'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('access-secret');
    expect(JSON.stringify(result)).not.toContain('refresh-secret');
  });

  it('refreshes an expired oauth token through Pi before billing', async () => {
    const home = makeTemp();
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
      packages: ['npm:pi-xai-oauth'],
    });
    writeJson(path.join(home, '.pi', 'agent', 'auth.json'), {
      xai: {
        type: 'oauth',
        access: 'access-expired',
        refresh: 'refresh-secret',
        expires: 1,
      },
    });
    const tokens = [];
    const result = await getPiXaiUsage({
      home,
      now: 1_700_000_000_000,
      refreshOAuth: async () => ({
        type: 'oauth',
        access: 'access-fresh',
        refresh: 'refresh-rotated',
        expires: 1_900_000_000_000,
      }),
      fetchImpl: async (_url, init) => {
        tokens.push(init.headers.Authorization);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ includedUsagePercent: 8 }),
        };
      },
    });
    expect(result.ok).toBe(true);
    expect(tokens).toEqual(['Bearer access-fresh']);
    expect(JSON.stringify(result)).not.toContain('access-expired');
    expect(JSON.stringify(result)).not.toContain('refresh-secret');
    const stored = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'auth.json'), 'utf8'));
    expect(stored.xai.access).toBe('access-fresh');
  });

  it('retries billing once after 401 by refreshing oauth', async () => {
    const home = makeTemp();
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
      packages: ['npm:pi-xai-oauth'],
    });
    writeJson(path.join(home, '.pi', 'agent', 'auth.json'), {
      xai: {
        type: 'oauth',
        access: 'access-stale',
        refresh: 'refresh-secret',
        expires: 1_900_000_000_000,
      },
    });
    let calls = 0;
    const result = await getPiXaiUsage({
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
          text: async () => JSON.stringify({ includedUsagePercent: 3 }),
        };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.usage.windows.billing_cycle.usedPercent).toBe(3);
    expect(calls).toBe(2);
  });
});
