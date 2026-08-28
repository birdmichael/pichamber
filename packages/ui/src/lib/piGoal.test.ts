import { describe, expect, test } from 'bun:test';

import { emptyFeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';
import {
  buildPiGoalStartCommand,
  canSubmitPiGoalObjective,
  getPiGoalCommand,
  isPiGoalBlockedByPlan,
  isPiGoalComposerButtonVisible,
  isPiGoalPluginAvailable,
  readPiGoalObjectiveFromMessages,
  readPiGoalObjectiveFromSession,
  resolvePiGoalSession,
  readPiGoalRouteSessionID,
  resolvePiGoalDirectory,
  resolvePiGoalTargetSession,
  startPiGoalCommand,
  submitPiGoalFromDialog,
} from './piGoal';

const enabledGoalPayload = () => {
  const payload = emptyFeaturePluginsPayload();
  payload.slots.goal.enabled = true;
  payload.slots.goal.installed = true;
  payload.slots.goal.command = 'goal';
  return payload;
};

describe('Pi Goal composer visibility', () => {
  test('hides the button when the slot is off or the package is missing', () => {
    const payload = emptyFeaturePluginsPayload();
    expect(isPiGoalPluginAvailable(payload)).toBe(false);
    expect(isPiGoalComposerButtonVisible({ isPiKernel: true, payload })).toBe(false);

    payload.slots.goal.installed = true;
    expect(isPiGoalComposerButtonVisible({ isPiKernel: true, payload })).toBe(false);

    payload.slots.goal.enabled = true;
    payload.slots.goal.installed = false;
    expect(isPiGoalComposerButtonVisible({ isPiKernel: true, payload })).toBe(false);

    expect(isPiGoalComposerButtonVisible({ isPiKernel: false, payload: enabledGoalPayload() })).toBe(false);
  });

  test('shows the button only when the Goal slot is installed and enabled on Pi', () => {
    expect(isPiGoalComposerButtonVisible({
      isPiKernel: true,
      payload: enabledGoalPayload(),
    })).toBe(true);
  });
});

describe('Pi Goal start command', () => {
  test('requires a non-empty objective and rejects bare /goal', () => {
    expect(canSubmitPiGoalObjective('')).toBe(false);
    expect(canSubmitPiGoalObjective('   ')).toBe(false);
    expect(canSubmitPiGoalObjective('implement snake game')).toBe(true);
    expect(buildPiGoalStartCommand('goal', '')).toEqual({ error: 'empty' });
    expect(buildPiGoalStartCommand('goal', 'implement snake game')).toEqual({
      command: 'goal',
      arguments: 'implement snake game',
    });
    expect(getPiGoalCommand(enabledGoalPayload())).toBe('goal');
  });

  test('submit uses the command channel and never promptAsync / sendMessage', async () => {
    const sendCommandCalls: Array<{ id: string; command: string; arguments: string }> = [];
    const sendMessageCalls: Array<{ id: string; text: string }> = [];

    const result = await startPiGoalCommand({
      request: {
        sessionID: 'ses_1',
        command: 'goal',
        objective: 'implement snake game',
      },
      sendCommand: async (params) => {
        sendCommandCalls.push(params);
      },
      sendMessage: async (params) => {
        sendMessageCalls.push(params);
      },
    });

    expect(result).toEqual({
      ok: true,
      command: 'goal',
      arguments: 'implement snake game',
    });
    expect(sendCommandCalls).toEqual([{
      id: 'ses_1',
      command: 'goal',
      arguments: 'implement snake game',
    }]);
    expect(sendMessageCalls).toEqual([]);
  });

  test('empty objective cannot submit and does not send chat', async () => {
    const sendCommandCalls: unknown[] = [];
    const sendMessageCalls: unknown[] = [];
    const result = await startPiGoalCommand({
      request: { sessionID: 'ses_1', command: 'goal', objective: '   ' },
      sendCommand: async (params) => { sendCommandCalls.push(params); },
      sendMessage: async (params) => { sendMessageCalls.push(params); },
    });
    expect(result).toEqual({ ok: false, reason: 'empty' });
    expect(sendCommandCalls).toEqual([]);
    expect(sendMessageCalls).toEqual([]);
  });

  test('never mints when the store already has a current session', async () => {
    expect(resolvePiGoalTargetSession({
      sessionID: null,
      currentSessionID: 'ses_open',
      mintedSessionID: 'ses_minted',
    })).toBe('ses_open');
    expect(await resolvePiGoalSession({
      sessionID: null,
      currentSessionID: 'ses_open',
      draftOpen: true,
      createSession: async () => {
        throw new Error('must not mint over an open session');
      },
    })).toEqual({ ok: true, sessionID: 'ses_open', minted: false });
  });

  test('never mints when the URL or last-active session still names an open chat', async () => {
    expect(readPiGoalRouteSessionID('?session=ses_route&tab=chat')).toBe('ses_route');
    expect(resolvePiGoalTargetSession({
      sessionID: null,
      currentSessionID: null,
      routeSessionID: 'ses_route',
      lastActiveSessionID: 'ses_last',
      mintedSessionID: 'ses_minted',
    })).toBe('ses_route');
    expect(resolvePiGoalTargetSession({
      sessionID: null,
      lastActiveSessionID: 'ses_last',
      mintedSessionID: 'ses_minted',
    })).toBe('ses_last');
    expect(resolvePiGoalDirectory({
      sessionDirectory: '/repo',
      lastActiveDirectory: '/chats/old',
      composerDirectory: '/chats/draft',
    })).toBe('/repo');
    expect(await resolvePiGoalSession({
      sessionID: null,
      routeSessionID: 'ses_route',
      draftOpen: true,
      createSession: async () => {
        throw new Error('must not mint over a routed session');
      },
    })).toEqual({ ok: true, sessionID: 'ses_route', minted: false });
  });

  test('reads the latest /goal user bubble as the visible objective', () => {
    expect(readPiGoalObjectiveFromMessages([
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'ok' }] },
      { info: { role: 'user' }, parts: [{ type: 'text', text: '/goal say bye' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'Goal mode is active.' }] },
    ])).toBe('say bye');
    expect(readPiGoalObjectiveFromMessages([
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'ok' }] },
    ])).toBeNull();
    expect(readPiGoalObjectiveFromSession(
      [
        { id: 'msg_ok', role: 'user' },
        { id: 'msg_goal', role: 'user' },
      ],
      {
        msg_ok: [{ type: 'text', text: 'ok' }],
        msg_goal: [{ type: 'text', text: '/goal say bye' }],
      },
    )).toBe('say bye');
  });

  test('mints a draft session instead of treating an empty composer as no-session', async () => {
    let created = 0;
    expect(await resolvePiGoalSession({
      sessionID: 'ses_existing',
      draftOpen: true,
      createSession: async () => {
        created += 1;
        return { id: 'ses_minted' };
      },
    })).toEqual({ ok: true, sessionID: 'ses_existing', minted: false });
    expect(created).toBe(0);

    expect(await resolvePiGoalSession({
      sessionID: null,
      draftOpen: true,
      createSession: async () => ({ id: 'ses_minted' }),
    })).toEqual({ ok: true, sessionID: 'ses_minted', minted: true });
    expect(await resolvePiGoalSession({ sessionID: '  ', draftOpen: false })).toEqual({
      ok: false,
      reason: 'no-session',
    });
  });

  test('refuses Start Goal while Plan is on without minting or sending', async () => {
    expect(isPiGoalBlockedByPlan({ draftPlanSelected: true, planStatus: 'off' })).toBe(true);
    expect(isPiGoalBlockedByPlan({ draftPlanSelected: false, planStatus: 'active' })).toBe(true);
    expect(isPiGoalBlockedByPlan({ draftPlanSelected: false, planStatus: 'ready' })).toBe(true);
    expect(isPiGoalBlockedByPlan({ draftPlanSelected: false, planStatus: 'off' })).toBe(false);

    const result = await submitPiGoalFromDialog({
      sessionID: null,
      draftOpen: true,
      draftPlanSelected: true,
      planStatus: 'off',
      directory: '/tmp/project',
      command: 'goal',
      objective: 'say bye',
      createSession: async () => {
        throw new Error('must not mint while Plan is on');
      },
      sendCommand: async () => {
        throw new Error('must not send /goal while Plan is on');
      },
    });
    expect(result).toEqual({ ok: false, reason: 'plan-mutex' });
  });

  test('maps a host Plan mutex 409 to plan-mutex', async () => {
    const result = await startPiGoalCommand({
      request: { sessionID: 'ses_plan', command: 'goal', objective: 'say bye' },
      sendCommand: async () => {
        throw Object.assign(new Error('Plan mode is active. Exit Plan before starting a Goal.'), { status: 409 });
      },
    });
    expect(result).toEqual({
      ok: false,
      reason: 'plan-mutex',
      command: 'goal',
      status: 409,
    });
  });

  test('missing live command errors without a chat send', async () => {
    const sendMessageCalls: unknown[] = [];
    const missing = Object.assign(new Error('Command /goal is not available on this session'), { status: 404 });
    const result = await startPiGoalCommand({
      request: { sessionID: 'ses_1', command: 'broken-goal', objective: 'implement snake game' },
      sendCommand: async () => {
        throw missing;
      },
      sendMessage: async (params) => { sendMessageCalls.push(params); },
    });
    expect(result).toEqual({ ok: false, reason: 'missing-command', command: 'broken-goal' });
    expect(sendMessageCalls).toEqual([]);
  });
});

describe('Pi Goal dialog submit', () => {
  test('does not switch session when a minted draft command 404s', async () => {
    const order: string[] = [];
    const result = await submitPiGoalFromDialog({
      sessionID: null,
      draftOpen: true,
      directory: '/tmp/project',
      command: 'goal',
      objective: 'ship the footer',
      createSession: async () => {
        order.push('mint');
        return { id: 'ses_minted', directory: '/tmp/minted' };
      },
      sendCommand: async (params) => {
        order.push(`command:${params.id}:${params.directory}`);
        throw Object.assign(new Error('Command /goal is not available on this session'), { status: 404 });
      },
    });
    expect(result).toEqual({
      ok: false,
      reason: 'missing-command',
      command: 'goal',
      sessionID: 'ses_minted',
      directory: '/tmp/minted',
    });
    expect(order).toEqual(['mint', 'command:ses_minted:/tmp/minted']);
  });

  test('retries a minted session instead of creating another draft', async () => {
    let created = 0;
    const first = await submitPiGoalFromDialog({
      sessionID: null,
      draftOpen: true,
      directory: '/tmp/project',
      command: 'goal',
      objective: 'ship the footer',
      createSession: async () => {
        created += 1;
        return { id: 'ses_minted', directory: '/tmp/minted' };
      },
      sendCommand: async () => {
        throw Object.assign(new Error('Command /goal is not available on this session'), { status: 404 });
      },
    });
    expect(first).toMatchObject({ ok: false, sessionID: 'ses_minted' });

    const second = await submitPiGoalFromDialog({
      sessionID: first.sessionID,
      draftOpen: false,
      directory: first.directory,
      command: 'goal',
      objective: 'ship the footer',
      createSession: async () => {
        created += 1;
        return { id: 'ses_other' };
      },
      sendCommand: async () => undefined,
    });
    expect(second).toEqual({
      ok: true,
      sessionID: 'ses_minted',
      directory: '/tmp/minted',
    });
    expect(created).toBe(1);
  });

  test('does not mint when the open chat already has a current session', async () => {
    const result = await submitPiGoalFromDialog({
      sessionID: null,
      currentSessionID: 'ses_open',
      draftOpen: true,
      directory: '/tmp/project',
      command: 'goal',
      objective: 'say bye',
      createSession: async () => {
        throw new Error('must not mint over an open session');
      },
      sendCommand: async (params) => {
        expect(params.id).toBe('ses_open');
      },
    });
    expect(result).toEqual({
      ok: true,
      sessionID: 'ses_open',
      directory: '/tmp/project',
    });
  });

  test('does not mint when a draft welcome still has a routed session', async () => {
    const result = await submitPiGoalFromDialog({
      sessionID: null,
      currentSessionID: null,
      routeSessionID: 'ses_route',
      draftOpen: true,
      directory: '/tmp/chats/draft',
      command: 'goal',
      objective: 'say bye',
      createSession: async () => {
        throw new Error('must not mint over a routed session');
      },
      sendCommand: async (params) => {
        expect(params.id).toBe('ses_route');
      },
    });
    expect(result).toEqual({
      ok: true,
      sessionID: 'ses_route',
      directory: '/tmp/chats/draft',
    });
  });

  test('reports the minted session only after /goal is accepted', async () => {
    const result = await submitPiGoalFromDialog({
      sessionID: 'ses_existing',
      draftOpen: false,
      directory: '/tmp/project',
      command: 'goal',
      objective: 'ship the footer',
      createSession: async () => {
        throw new Error('must not mint an existing session');
      },
      sendCommand: async () => undefined,
    });
    expect(result).toEqual({
      ok: true,
      sessionID: 'ses_existing',
      directory: '/tmp/project',
    });
  });
});
