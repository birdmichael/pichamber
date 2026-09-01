import { describe, expect, test } from 'bun:test';

import { parseRoute } from './parseRoute';

describe('parseRoute session', () => {
  test('reads a session id including underscores', () => {
    const route = parseRoute(new URLSearchParams('session=ses_abc123'));
    expect(route.sessionId).toBe('ses_abc123');
  });

  test('decodes a percent-encoded session id', () => {
    const route = parseRoute(new URLSearchParams('session=ses%5Fabc123'));
    expect(route.sessionId).toBe('ses_abc123');
  });

  test('ignores a blank session param', () => {
    const route = parseRoute(new URLSearchParams('session='));
    expect(route.sessionId).toBeNull();
  });

  test('still parses the main-view tab independently of session tabs', () => {
    const route = parseRoute(new URLSearchParams('session=ses_1&tab=files'));
    expect(route.sessionId).toBe('ses_1');
    expect(route.tab).toBe('files');
  });
});
