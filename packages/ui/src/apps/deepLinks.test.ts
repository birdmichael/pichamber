import { describe, expect, test } from 'bun:test';

import { parseDeepLink } from './deepLinks';

describe('deep link vocabulary', () => {
  test('parses pichamber:// session and settings routes', () => {
    expect(parseDeepLink('pichamber://session/ses_123?dir=%2Ftmp%2Fdemo')).toEqual({
      type: 'session',
      sessionId: 'ses_123',
      directory: '/tmp/demo',
    });
    expect(parseDeepLink('pichamber://new?project=proj_1')).toEqual({
      type: 'new-session',
      directory: undefined,
      projectId: 'proj_1',
      agent: undefined,
      model: undefined,
    });
    expect(parseDeepLink('pichamber://sessions?filter=attention')).toEqual({
      type: 'sessions',
      filter: 'attention',
    });
    expect(parseDeepLink('pichamber://settings/providers')).toEqual({
      type: 'settings',
      section: 'providers',
    });
    expect(parseDeepLink('pichamber://view/files')).toEqual({
      type: 'view',
      target: 'files',
    });
  });

  test('parses leftover openchamber:// widget URLs and mixed case', () => {
    expect(parseDeepLink('openchamber://new')).toEqual({
      type: 'new-session',
      directory: undefined,
      projectId: undefined,
      agent: undefined,
      model: undefined,
    });
    expect(parseDeepLink('openchamber://sessions?filter=attention')).toEqual({
      type: 'sessions',
      filter: 'attention',
    });
    expect(parseDeepLink('OpenChamber://STATUS')).toEqual({ type: 'status' });
    expect(parseDeepLink('Pichamber://CHANGES')).toEqual({ type: 'changes', path: undefined, staged: false });
  });

  test('rejects unrelated schemes and empty routes', () => {
    expect(parseDeepLink('https://example.com/session/abc')).toBeNull();
    expect(parseDeepLink('pichamber://session')).toBeNull();
    expect(parseDeepLink('pichamber://unknown')).toBeNull();
  });
});
