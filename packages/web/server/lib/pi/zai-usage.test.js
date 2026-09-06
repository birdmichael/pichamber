import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getPiZaiUsage, mapZaiLimitsToWindows } from './zai-usage.js';
import { BUILTIN_FEATURE_PLUGIN_SOURCES } from './feature-plugins.js';

const homes = [];
afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });
const makeTemp = () => { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-zai-usage-')); homes.push(home); return home; };
const writeJson = (filePath, value) => { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n'); };
const installSlot = (home, region = 'domestic') => writeJson(path.join(home, '.pi', 'agent', 'pichamber.json'), { zaiRegion: region, featurePlugins: { zai: { source: BUILTIN_FEATURE_PLUGIN_SOURCES.zai, enabled: true } } });
const writeAuth = (home) => writeJson(path.join(home, '.pi', 'agent', 'auth.json'), { zai: { type: 'api_key', key: 'zai-secret' } });

describe('mapZaiLimitsToWindows', () => {
  it('maps token and MCP limits without inventing percentages', () => {
    const windows = mapZaiLimitsToWindows({ data: { limits: [
      { type: 'TOKENS_LIMIT', percentage: 37, nextResetTime: 2_000_000_000, unit: 3, number: 5 },
      { type: 'TIME_LIMIT', percentage: 12, nextResetTime: 2_000_000_000 },
    ] } });
    expect(windows['5h'].usedPercent).toBe(37);
    expect(windows['5h'].windowSeconds).toBe(5 * 60 * 60);
    expect(windows['MCP Tools'].usedPercent).toBe(12);
    expect(mapZaiLimitsToWindows({ data: { limits: [{ type: 'TOKENS_LIMIT' }] } })['5h'].usedPercent).toBeNull();
  });
});

describe('getPiZaiUsage', () => {
  it('does not fetch while the builtin slot is off', async () => {
    const home = makeTemp(); writeAuth(home); let called = false;
    const result = await getPiZaiUsage({ home, fetchImpl: async () => { called = true; } });
    expect(result).toEqual({ ok: false, configured: false, slotActive: false }); expect(called).toBe(false);
  });
  it('uses the domestic quota API and maps both windows', async () => {
    const home = makeTemp(); installSlot(home); writeAuth(home); const requests = [];
    const result = await getPiZaiUsage({ home, fetchImpl: async (url, init) => { requests.push([url, init]); return { ok: true, status: 200, text: async () => JSON.stringify({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 44, nextResetTime: 2_000_000_000 }, { type: 'TIME_LIMIT', percentage: 8, nextResetTime: 2_000_000_000 }] } }) }; } });
    expect(result.ok).toBe(true); expect(result.region).toBe('domestic'); expect(Object.keys(result.usage.windows).sort()).toEqual(['5h', 'MCP Tools']);
    expect(requests[0][0]).toBe('https://open.bigmodel.cn/api/monitor/usage/quota/limit'); expect(requests[0][1].headers.Authorization).toBe('Bearer zai-secret');
    expect(JSON.stringify(result)).not.toContain('zai-secret');
  });
  it('reports international usage as unavailable instead of zero', async () => {
    const home = makeTemp(); installSlot(home, 'international'); writeAuth(home); let called = false;
    const result = await getPiZaiUsage({ home, fetchImpl: async () => { called = true; } });
    expect(result.ok).toBe(false); expect(result.region).toBe('international'); expect(result.usageUnavailable).toBe(true); expect(result.usage).toBeNull(); expect(called).toBe(false); expect(JSON.stringify(result)).not.toMatch(/usedPercent.*0/);
  });
  it('keeps usage null when the domestic request fails', async () => {
    const home = makeTemp(); installSlot(home); writeAuth(home);
    const result = await getPiZaiUsage({ home, fetchImpl: async () => { throw new Error('network down'); } });
    expect(result.ok).toBe(false); expect(result.configured).toBe(true); expect(result.usage).toBeNull(); expect(result.error).toContain('network down');
  });
});
