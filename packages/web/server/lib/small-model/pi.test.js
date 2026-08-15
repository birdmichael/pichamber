import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  describePiSmallModel,
  listPiAuthenticatedProviders,
  providerHasPiLogin,
  resolvePiSmallModel,
} from './pi.js';

const makeHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pi-small-model-'));

const writeAgent = (home, { defaults = {}, models = {}, auth = {} } = {}) => {
  const agentDir = path.join(home, '.pi', 'agent');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'pichamber.json'), JSON.stringify(defaults));
  fs.writeFileSync(path.join(agentDir, 'models.json'), JSON.stringify(models));
  fs.writeFileSync(path.join(agentDir, 'auth.json'), JSON.stringify(auth));
};

const BMLAB_MODELS = {
  providers: {
    bmlab: {
      baseUrl: 'https://example.invalid/v1',
      api: 'openai-completions',
      apiKey: '$BMLAB_API_KEY',
      models: [
        {
          id: 'grok-4.6',
          name: 'Grok 4.6',
          contextWindow: 256000,
          maxTokens: 16384,
        },
      ],
    },
  },
};

describe('resolvePiSmallModel', () => {
  afterEach(() => {
    delete process.env.BMLAB_API_KEY;
  });

  it('uses the current Pi default when set', () => {
    const home = makeHome();
    writeAgent(home, {
      defaults: { model: 'bmlab/grok-4.6', thinking: 'high' },
      models: BMLAB_MODELS,
      auth: { bmlab: { type: 'api', key: 'secret-not-logged' } },
    });

    expect(resolvePiSmallModel({ home })).toEqual({
      providerID: 'bmlab',
      modelID: 'grok-4.6',
      source: 'pi-default',
    });
  });

  it('falls back to the first models.json entry when defaults.model is empty', () => {
    const home = makeHome();
    writeAgent(home, {
      defaults: { model: '', thinking: 'high' },
      models: BMLAB_MODELS,
      auth: { bmlab: { type: 'api', key: 'secret-not-logged' } },
    });

    expect(resolvePiSmallModel({ home })).toEqual({
      providerID: 'bmlab',
      modelID: 'grok-4.6',
      source: 'pi-default',
    });
  });

  it('lets an explicit override outrank the Pi default', () => {
    const home = makeHome();
    writeAgent(home, {
      defaults: { model: 'bmlab/grok-4.6' },
      models: BMLAB_MODELS,
    });

    expect(resolvePiSmallModel({ home, overrideModel: 'bmlab/grok-4.6' })).toMatchObject({
      providerID: 'bmlab',
      modelID: 'grok-4.6',
      source: 'request',
    });
  });

  it('returns null when no Pi models are configured', () => {
    const home = makeHome();
    writeAgent(home, { defaults: {}, models: {}, auth: {} });
    expect(resolvePiSmallModel({ home })).toBeNull();
  });
});

describe('describePiSmallModel', () => {
  it('reports the Pi context window and a usable login', () => {
    const home = makeHome();
    writeAgent(home, {
      defaults: { model: 'bmlab/grok-4.6' },
      models: BMLAB_MODELS,
      auth: { bmlab: { type: 'api', key: 'secret-not-logged' } },
    });

    const described = describePiSmallModel({ home, outputReserveTokens: 24_000 });
    expect(described).toMatchObject({
      providerID: 'bmlab',
      modelID: 'grok-4.6',
      source: 'pi-default',
      hasLogin: true,
      contextTokens: 256000,
      contextKnown: true,
      structuredOutput: null,
      outputTokens: 24_000,
    });
    expect(described.inputCharBudget).toBe((256000 - 24_000) * 4);
  });

  it('treats a models.json $ENV apiKey as a login when the env is set', () => {
    const home = makeHome();
    writeAgent(home, { defaults: { model: 'bmlab/grok-4.6' }, models: BMLAB_MODELS, auth: {} });
    process.env.BMLAB_API_KEY = 'set-for-test';
    expect(providerHasPiLogin('bmlab', home)).toBe(true);
    expect(listPiAuthenticatedProviders(home)).toEqual(['bmlab']);
    delete process.env.BMLAB_API_KEY;
  });
});
