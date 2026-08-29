import { describe, expect, test } from 'bun:test';

import { getConfigUpdateSnapshot } from '@/lib/configUpdate';
import { dict as enDict } from '@/lib/i18n/messages/en';
import { dict as zhCnDict } from '@/lib/i18n/messages/zh-CN';
import {
  getSessionTitleReloadBlockReason,
  isSessionTitleReloadBlocked,
  isSessionTitleReloadBlockedByStatus,
  isSessionTitleReloadGlyphVisible,
  isSessionTitleReloadInFlightForSession,
  isSessionTitleReloadOutputting,
  isSessionTitleReloadVisible,
  postPiSessionTitleReload,
  refreshSessionTitleReloadLists,
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

describe('isSessionTitleReloadGlyphVisible', () => {
  const visible = {
    isPiKernel: true,
    hasCurrentSession: true,
    isNewSessionDraftOpen: false,
    isRenamingSession: false,
  };

  test('hides the title ⟳ when the session is idle', () => {
    expect(isSessionTitleReloadGlyphVisible(visible)).toBe(false);
    expect(isSessionTitleReloadGlyphVisible({
      ...visible,
      isReloadInFlight: false,
      isCompacting: false,
    })).toBe(false);
  });

  test('shows the title spinner only while reload or compaction is running', () => {
    expect(isSessionTitleReloadGlyphVisible({
      ...visible,
      isReloadInFlight: true,
    })).toBe(true);
    expect(isSessionTitleReloadGlyphVisible({
      ...visible,
      isCompacting: true,
    })).toBe(true);
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

  test('blocks from ChatInput canAbort: sessionPhase !== idle', () => {
    expect(isSessionTitleReloadOutputting({ sessionPhase: 'busy' })).toBe(true);
    expect(isSessionTitleReloadOutputting({ sessionPhase: 'retry' })).toBe(true);
    expect(isSessionTitleReloadOutputting({ sessionPhase: 'idle' })).toBe(false);
  });

  test('blocks while composing or streaming even when global status is missing', () => {
    expect(isSessionTitleReloadOutputting({
      sessionPhase: 'idle',
      assistantStatusText: 'composing',
    })).toBe(true);
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

  test('in-flight disable is only for the session that is reloading', () => {
    const reloading = new Set(['ses_a']);
    expect(isSessionTitleReloadInFlightForSession('ses_a', reloading)).toBe(true);
    expect(isSessionTitleReloadInFlightForSession('ses_b', reloading)).toBe(false);
    expect(isSessionTitleReloadInFlightForSession(null, reloading)).toBe(false);
    expect(getSessionTitleReloadBlockReason({
      statusType: 'idle',
      isReloadInFlight: isSessionTitleReloadInFlightForSession('ses_b', reloading),
    })).toBeNull();
    expect(getSessionTitleReloadBlockReason({
      statusType: 'idle',
      isReloadInFlight: isSessionTitleReloadInFlightForSession('ses_a', reloading),
    })).toBe('inFlight');
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
  test('reloads one session then refreshes command/skill/extension lists', async () => {
    const calls: string[] = [];
    await reloadPiSessionTitleConfig({
      sessionID: 'ses_a',
      reloadSession: async (sessionID) => {
        calls.push(`reload:${sessionID}`);
      },
      refreshLists: async () => {
        calls.push('lists');
      },
    });
    expect(calls).toEqual(['reload:ses_a', 'lists']);
  });

  test('posts a session-scoped reload instead of process-wide config reload', async () => {
    const urls: string[] = [];
    await postPiSessionTitleReload('ses_a', async (path, init) => {
      urls.push(path);
      expect(init?.method).toBe('POST');
      return {
        ok: true,
        json: async () => ({ reloaded: true, sessionID: 'ses_a' }),
      };
    });
    expect(urls).toEqual(['/api/session/ses_a/reload']);
  });

  test('does not call startConfigUpdate', async () => {
    const before = getConfigUpdateSnapshot();
    await reloadPiSessionTitleConfig({
      sessionID: 'ses_a',
      reloadSession: async () => undefined,
      refreshLists: async () => refreshSessionTitleReloadLists({
        loadCommands: async () => undefined,
        loadSkills: async () => undefined,
        loadPlugins: async () => undefined,
      }),
    });
    const after = getConfigUpdateSnapshot();
    expect(after.isUpdating).toBe(before.isUpdating);
    expect(after.isUpdating).toBe(false);
  });

  test('does not refresh lists when the session reload fails', async () => {
    const calls: string[] = [];
    await expect(reloadPiSessionTitleConfig({
      sessionID: 'ses_a',
      reloadSession: async () => {
        calls.push('reload');
        throw new Error('host reload failed');
      },
      refreshLists: async () => {
        calls.push('lists');
      },
    })).rejects.toThrow('host reload failed');
    expect(calls).toEqual(['reload']);
  });
});
