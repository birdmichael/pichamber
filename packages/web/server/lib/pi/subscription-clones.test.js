import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  nextSubscriptionCloneId,
  subscriptionFamilyOf,
  writePiProviderAuth,
} from './pi-resources.js';
import {
  createSubscriptionClone,
  listSubscriptionCloneIds,
  patchSubscriptionClone,
} from './subscription-clones.js';

const temps = [];

const makeTemp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pichamber-clones-'));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, '.pi', 'agent'), { recursive: true });
  return dir;
};

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('subscriptionFamilyOf', () => {
  it('matches builtin and numeric clones, not dual-auth siblings', () => {
    expect(subscriptionFamilyOf('xai')).toBe('xai');
    expect(subscriptionFamilyOf('xai-2')).toBe('xai');
    expect(subscriptionFamilyOf('xai-10')).toBe('xai');
    expect(subscriptionFamilyOf('xai-api')).toBe(null);
    expect(subscriptionFamilyOf('kimi-coding')).toBe('kimi-coding');
    expect(subscriptionFamilyOf('kimi-coding-2')).toBe('kimi-coding');
    expect(subscriptionFamilyOf('kimi-coding-api')).toBe(null);
    expect(nextSubscriptionCloneId('xai', ['xai', 'xai-2'])).toBe('xai-3');
    expect(nextSubscriptionCloneId('kimi-coding', ['kimi-coding'])).toBe('kimi-coding-2');
  });
});

describe('createSubscriptionClone', () => {
  it('writes xai-2 without replacing xai oauth', () => {
    const home = makeTemp();
    writePiProviderAuth('xai', {
      type: 'oauth',
      access: 'access-one',
      refresh: 'refresh-one',
      expires: Date.now() + 60_000,
    }, { home });
    const created = createSubscriptionClone({ home, family: 'xai', displayName: 'Work' });
    expect(created.providerId).toBe('xai-2');
    expect(created.name).toBe('Work');
    const auth = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'auth.json'), 'utf8'));
    expect(auth.xai.access).toBe('access-one');
    expect(auth['xai-2']).toBeUndefined();
    const models = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'models.json'), 'utf8'));
    expect(models.providers['xai-2'].name).toBe('Work');
    expect(models.providers['xai-2'].baseUrl).toBe('https://api.x.ai/v1');
    expect(listSubscriptionCloneIds(home)).toEqual(['xai-2']);
  });

  it('rejects clone before the first subscription exists', () => {
    const home = makeTemp();
    expect(() => createSubscriptionClone({ home, family: 'xai' })).toThrow(/before adding another/);
  });

  it('renames without wiping models', () => {
    const home = makeTemp();
    writePiProviderAuth('xai', {
      type: 'oauth',
      access: 'access-one',
      refresh: 'refresh-one',
      expires: Date.now() + 60_000,
    }, { home });
    createSubscriptionClone({ home, family: 'xai', displayName: 'Work' });
    const patched = patchSubscriptionClone({ home, providerId: 'xai-2', displayName: 'Home' });
    expect(patched.config.name).toBe('Home');
    const models = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'models.json'), 'utf8'));
    expect(models.providers['xai-2'].baseUrl).toBe('https://api.x.ai/v1');
    expect(JSON.stringify(models)).not.toContain('access-one');
  });
});
