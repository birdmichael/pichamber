import { describe, expect, test } from 'bun:test';

import { composerInstanceKey } from '../composerInstanceKey';

describe('composerInstanceKey', () => {
  test('keys an existing session separately from a new-session draft', () => {
    expect(composerInstanceKey({ sessionId: 'ses_a' })).toBe('session:ses_a');
    expect(composerInstanceKey({ sessionId: 'ses_b' })).toBe('session:ses_b');
    expect(composerInstanceKey({ sessionId: null, draftId: 3 })).toBe('draft:3');
    expect(composerInstanceKey({ sessionId: 'ses_a' }))
      .not.toBe(composerInstanceKey({ sessionId: null, draftId: 3 }));
  });

  test('does not reuse a previous new-session draft key', () => {
    expect(composerInstanceKey({ sessionId: null, draftId: 1 }))
      .not.toBe(composerInstanceKey({ sessionId: null, draftId: 2 }));
  });
});
