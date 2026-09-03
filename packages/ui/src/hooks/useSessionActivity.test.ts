import { describe, expect, test } from 'bun:test';

import { idleLeftoverBusyAfterSettledAssistant } from '@/sync/event-reducer';
import {
  isSettledAssistantMessage,
  resolveSessionActivity,
} from './useSessionActivity';

describe('resolveSessionActivity', () => {
  test('keeps busy while status is busy even if the trailing assistant is finished', () => {
    expect(isSettledAssistantMessage({
      role: 'assistant',
      time: { completed: 1_500 },
    })).toBe(true);

    expect(resolveSessionActivity({
      sessionId: 'ses_1',
      status: { type: 'busy' },
      lastMessage: { role: 'assistant', time: { completed: 1_500 } },
    })).toMatchObject({
      phase: 'busy',
      isWorking: true,
      isBusy: true,
    });
  });

  test('idles a settled assistant when status is already idle', () => {
    expect(resolveSessionActivity({
      sessionId: 'ses_1',
      status: { type: 'idle' },
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

  test('does not idle leftover busy after the first settled assistant while tools remain', () => {
    expect(idleLeftoverBusyAfterSettledAssistant({
      status: { type: 'busy' },
      lastMessage: { role: 'assistant', time: { completed: 1_500 } },
    })).toBe(false);

    expect(resolveSessionActivity({
      sessionId: 'ses_1',
      status: { type: 'busy' },
      lastMessage: { role: 'assistant', time: { created: 1_000, completed: 1_500 } },
    })).toMatchObject({
      phase: 'busy',
      isWorking: true,
      isBusy: true,
    });
  });
});
