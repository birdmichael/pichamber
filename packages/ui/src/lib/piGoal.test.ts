import { describe, expect, test } from 'bun:test';

import { emptyFeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';
import {
  buildPiGoalStartCommand,
  canSubmitPiGoalObjective,
  getPiGoalCommand,
  isPiGoalComposerButtonVisible,
  isPiGoalPluginAvailable,
  startPiGoalCommand,
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
