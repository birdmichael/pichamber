import { describe, expect, test } from 'bun:test';

import {
  isSettledAssistantMessage,
  resolveSessionActivity,
} from './useSessionActivity';

describe('resolveSessionActivity', () => {
  test('treats a leftover busy flag as idle when the trailing assistant is finished', () => {
    expect(isSettledAssistantMessage({
      role: 'assistant',
      time: { completed: 1_500 },
    })).toBe(true);

    expect(resolveSessionActivity({
      sessionId: 'ses_1',
      status: { type: 'busy' },
      lastMessage: { role: 'assistant', time: { completed: 1_500 } },
    })).toEqual({
      phase: 'idle',
      isWorking: false,
      isBusy: false,
      isCooldown: false,
    });
  });

  test('keeps busy while the trailing assistant has not completed', () => {
    expect(resolveSessionActivity({
      sessionId: 'ses_1',
      status: { type: 'busy' },
      lastMessage: { role: 'assistant', time: { created: 1_000 } },
    })).toMatchObject({
      phase: 'busy',
      isWorking: true,
      isBusy: true,
    });
  });

  test('keeps busy when the last message is the optimistic user bubble', () => {
    expect(resolveSessionActivity({
      sessionId: 'ses_1',
      status: { type: 'busy' },
      lastMessage: { role: 'user', time: { created: 1_000 } },
    })).toMatchObject({
      phase: 'busy',
      isWorking: true,
      isBusy: true,
    });
  });
});
