import { describe, expect, test } from 'bun:test';

import { dict as enDict } from '@/lib/i18n/messages/en';
import { dict as zhCnDict } from '@/lib/i18n/messages/zh-CN';
import {
  getSessionTitleReloadBlockReason,
  isSessionTitleReloadVisible,
  requestPiConfigReload,
  sessionTitleReloadAriaKey,
  sessionTitleReloadTooltipKey,
} from './headerSessionReload';

describe('isSessionTitleReloadVisible', () => {
  const visible = {
    isPiKernel: true,
    hasCurrentSession: true,
    isNewSessionDraftOpen: false,
    isRenamingSession: false,
  };

  test('shows on Pi when a real session is selected', () => {
    expect(isSessionTitleReloadVisible(visible)).toBe(true);
  });

  test('hides on the OpenCode kernel', () => {
    expect(isSessionTitleReloadVisible({ ...visible, isPiKernel: false })).toBe(false);
  });

  test('hides on the new-session draft', () => {
    expect(isSessionTitleReloadVisible({ ...visible, isNewSessionDraftOpen: true })).toBe(false);
  });

  test('hides when no session is selected', () => {
    expect(isSessionTitleReloadVisible({ ...visible, hasCurrentSession: false })).toBe(false);
  });

  test('hides while the session title is being renamed', () => {
    expect(isSessionTitleReloadVisible({ ...visible, isRenamingSession: true })).toBe(false);
  });
});

describe('getSessionTitleReloadBlockReason', () => {
  test('blocks while a reload is already in flight', () => {
    expect(getSessionTitleReloadBlockReason({
      isCurrentSessionActive: true,
      isReloadInFlight: true,
    })).toBe('inFlight');
  });

  test('blocks while the session is busy or retrying', () => {
    expect(getSessionTitleReloadBlockReason({
      isCurrentSessionActive: true,
      isReloadInFlight: false,
    })).toBe('busy');
  });

  test('is clickable when idle', () => {
    expect(getSessionTitleReloadBlockReason({
      isCurrentSessionActive: false,
      isReloadInFlight: false,
    })).toBeNull();
  });
});

describe('session title reload copy', () => {
  test('keeps English and Simplified Chinese action and disabled reasons', () => {
    expect(enDict['header.sessionReload.tooltip']).toBe('Reload skills, prompts, and extensions');
    expect(enDict['header.sessionReload.aria']).toBe('Reload skills, prompts, and extensions');
    expect(enDict['header.sessionReload.disabledBusy']).toBe('Reload unavailable while the session is responding');
    expect(enDict['header.sessionReload.disabledInFlight']).toBe('Reloading skills, prompts, and extensions');
    expect(zhCnDict['header.sessionReload.tooltip']).toBe('重新加载技能、提示词和扩展');
    expect(zhCnDict['header.sessionReload.disabledBusy']).toBe('会话正在回复，无法重新加载');
    expect(zhCnDict['header.sessionReload.tooltip']).not.toBe(enDict['header.sessionReload.tooltip']);
  });
});

describe('session title reload copy keys', () => {
  test('uses the idle tooltip and aria when the control is available', () => {
    expect(sessionTitleReloadTooltipKey(null)).toBe('header.sessionReload.tooltip');
    expect(sessionTitleReloadAriaKey(null)).toBe('header.sessionReload.aria');
  });

  test('explains why reload is unavailable while the session is responding', () => {
    expect(sessionTitleReloadAriaKey('busy')).toBe('header.sessionReload.disabledBusy');
    expect(sessionTitleReloadTooltipKey('busy')).toBe('header.sessionReload.disabledBusy');
  });

  test('explains why reload is unavailable while a request is in flight', () => {
    expect(sessionTitleReloadAriaKey('inFlight')).toBe('header.sessionReload.disabledInFlight');
    expect(sessionTitleReloadTooltipKey('inFlight')).toBe('header.sessionReload.disabledInFlight');
  });
});

describe('requestPiConfigReload', () => {
  test('POSTs /api/config/reload and resolves on success', async () => {
    const calls: Array<{ path: string; method?: string }> = [];
    await requestPiConfigReload({
      fetchImpl: async (path, init) => {
        calls.push({ path, method: init?.method });
        return { ok: true, json: async () => ({ reloaded: true }) };
      },
    });
    expect(calls).toEqual([{ path: '/api/config/reload', method: 'POST' }]);
  });

  test('throws the server error message on failure', async () => {
    await expect(requestPiConfigReload({
      fetchImpl: async () => ({
        ok: false,
        json: async () => ({ error: 'host reload failed' }),
      }),
    })).rejects.toThrow('host reload failed');
  });

  test('throws an empty message when the failure body has no error text', async () => {
    await expect(requestPiConfigReload({
      fetchImpl: async () => ({
        ok: false,
        json: async () => ({ kernel: 'pi' }),
      }),
    })).rejects.toThrow('');
  });
});
