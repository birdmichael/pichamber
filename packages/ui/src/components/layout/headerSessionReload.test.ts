import { describe, expect, test } from 'bun:test';

import { dict as enDict } from '@/lib/i18n/messages/en';
import { dict as zhCnDict } from '@/lib/i18n/messages/zh-CN';
import {
  getSessionTitleReloadBlockReason,
  isSessionTitleReloadBlocked,
  isSessionTitleReloadBlockedByStatus,
  isSessionTitleReloadOutputting,
  isSessionTitleReloadVisible,
  reloadPiSessionTitleConfig,
  SESSION_TITLE_RELOAD_BLOCKING_STATUS_TYPES,
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

describe('session title reload status disable', () => {
  test('blocks the same session_status types Desktop already reports: busy and retry', () => {
    expect(SESSION_TITLE_RELOAD_BLOCKING_STATUS_TYPES).toEqual(['busy', 'retry']);
    expect(isSessionTitleReloadBlockedByStatus('busy')).toBe(true);
    expect(isSessionTitleReloadBlockedByStatus('retry')).toBe(true);
    expect(isSessionTitleReloadBlockedByStatus('idle')).toBe(false);
    expect(isSessionTitleReloadBlockedByStatus(undefined)).toBe(false);
  });

  test('blocks while composing or streaming even when global status is missing', () => {
    expect(isSessionTitleReloadOutputting({
      sessionPhase: 'idle',
      assistantIsForming: true,
    })).toBe(true);
    expect(isSessionTitleReloadOutputting({
      sessionPhase: 'idle',
      assistantIsStreaming: true,
    })).toBe(true);
    expect(isSessionTitleReloadOutputting({
      sessionPhase: 'busy',
      sessionIsWorking: true,
    })).toBe(true);
    expect(isSessionTitleReloadOutputting({
      sessionPhase: 'idle',
      assistantCanAbort: true,
    })).toBe(true);
    expect(isSessionTitleReloadOutputting({
      sessionPhase: 'idle',
    })).toBe(false);
    expect(isSessionTitleReloadBlocked({
      statusType: undefined,
      isOutputting: true,
    })).toBe(true);
    expect(getSessionTitleReloadBlockReason({
      statusType: undefined,
      isOutputting: true,
      isReloadInFlight: false,
    })).toBe('busy');
  });

  test('blocks while compacting even when the session looks idle', () => {
    expect(isSessionTitleReloadBlocked({
      statusType: 'idle',
      isCompacting: true,
    })).toBe(true);
    expect(getSessionTitleReloadBlockReason({
      statusType: 'idle',
      isCompacting: true,
      isReloadInFlight: false,
    })).toBe('compacting');
  });

  test('blocks while a reload is already in flight', () => {
    expect(getSessionTitleReloadBlockReason({
      statusType: 'busy',
      isReloadInFlight: true,
    })).toBe('inFlight');
  });

  test('is clickable when idle', () => {
    expect(getSessionTitleReloadBlockReason({
      statusType: 'idle',
      isReloadInFlight: false,
    })).toBeNull();
  });
});

describe('session title reload copy', () => {
  test('keeps English and Simplified Chinese action, disabled, and success reasons', () => {
    expect(enDict['header.sessionReload.tooltip']).toBe('Reload skills, prompts, and extensions');
    expect(enDict['header.sessionReload.aria']).toBe('Reload skills, prompts, and extensions');
    expect(enDict['header.sessionReload.disabledBusy']).toBe('Reload unavailable while the session is responding');
    expect(enDict['header.sessionReload.disabledCompacting']).toBe('Reload unavailable while compaction is running');
    expect(enDict['header.sessionReload.disabledInFlight']).toBe('Reloading skills, prompts, and extensions');
    expect(enDict['header.sessionReload.success']).toBe('Reloaded skills, prompts, and extensions');
    expect(zhCnDict['header.sessionReload.tooltip']).toBe('重新加载技能、提示词和扩展');
    expect(zhCnDict['header.sessionReload.disabledBusy']).toBe('会话正在回复，无法重新加载');
    expect(zhCnDict['header.sessionReload.disabledCompacting']).toBe('正在压缩上下文，无法重新加载');
    expect(zhCnDict['header.sessionReload.success']).toBe('已重新加载技能、提示词和扩展');
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

  test('explains why reload is unavailable while compaction is running', () => {
    expect(sessionTitleReloadAriaKey('compacting')).toBe('header.sessionReload.disabledCompacting');
    expect(sessionTitleReloadTooltipKey('compacting')).toBe('header.sessionReload.disabledCompacting');
  });

  test('explains why reload is unavailable while a request is in flight', () => {
    expect(sessionTitleReloadAriaKey('inFlight')).toBe('header.sessionReload.disabledInFlight');
    expect(sessionTitleReloadTooltipKey('inFlight')).toBe('header.sessionReload.disabledInFlight');
  });
});

describe('reloadPiSessionTitleConfig', () => {
  test('reuses reloadOpenCodeConfiguration then refreshes extensions', async () => {
    const calls: string[] = [];
    let reloadOptions: unknown;
    await reloadPiSessionTitleConfig({
      message: 'Reloading skills, prompts, and extensions',
      reloadConfiguration: async (options) => {
        reloadOptions = options;
        calls.push('commands-skills');
      },
      refreshExtensions: async () => {
        calls.push('extensions');
      },
    });
    expect(calls).toEqual(['commands-skills', 'extensions']);
    expect(reloadOptions).toEqual({
      message: 'Reloading skills, prompts, and extensions',
      scopes: ['all'],
      mode: 'projects',
    });
  });

  test('does not refresh extensions when command/skill reload fails', async () => {
    const calls: string[] = [];
    await expect(reloadPiSessionTitleConfig({
      reloadConfiguration: async () => {
        calls.push('commands-skills');
        throw new Error('host reload failed');
      },
      refreshExtensions: async () => {
        calls.push('extensions');
      },
    })).rejects.toThrow('host reload failed');
    expect(calls).toEqual(['commands-skills']);
  });
});
