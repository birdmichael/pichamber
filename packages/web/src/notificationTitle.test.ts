import { describe, expect, test } from 'bun:test';

import { notificationTitleFromPayload } from './notificationTitle';

describe('notificationTitleFromPayload', () => {
  test('names Pichamber when the payload has no title', () => {
    expect(notificationTitleFromPayload({})).toBe('Pichamber');
  });

  test('keeps an explicit payload title', () => {
    expect(notificationTitleFromPayload({ title: 'Session ready' })).toBe('Session ready');
  });
});

