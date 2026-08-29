import { describe, expect, test } from 'bun:test';

import { buildDeepLink, intentFromPushAction, parseDeepLink } from './deepLinks';

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

  test('parses prompt focus on a session link and ignores URL action=', () => {
    expect(parseDeepLink('pichamber://session/ses_1?prompt=pui_1')).toEqual({
      type: 'session',
      sessionId: 'ses_1',
      promptId: 'pui_1',
    });
    expect(parseDeepLink('pichamber://session/ses_1?prompt=pui_1&action=confirm')).toEqual({
      type: 'session',
      sessionId: 'ses_1',
      promptId: 'pui_1',
    });
    expect(buildDeepLink({
      type: 'session',
      sessionId: 'ses_1',
      promptId: 'pui_1',
    })).toBe('pichamber://session/ses_1?prompt=pui_1');
  });

  test('maps a confirm notification action onto the session intent', () => {
    expect(intentFromPushAction({
      actionId: 'confirm',
      notification: {
        data: {
          sessionId: 'ses_1',
          promptId: 'pui_1',
          kind: 'confirm',
          url: '/?session=ses_1',
          deeplink: 'pichamber://session/ses_1?prompt=pui_1&kind=confirm',
        },
      },
    })).toEqual({
      type: 'session',
      sessionId: 'ses_1',
      promptId: 'pui_1',
      action: 'confirm',
    });
    expect(intentFromPushAction({
      actionId: 'tap',
      notification: {
        data: {
          sessionId: 'ses_1',
          promptId: 'pui_1',
          deeplink: 'pichamber://session/ses_1?prompt=pui_1&action=confirm',
        },
      },
    })).toEqual({
      type: 'session',
      sessionId: 'ses_1',
      promptId: 'pui_1',
    });
  });
});
