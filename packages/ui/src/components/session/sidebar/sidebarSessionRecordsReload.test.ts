import { describe, expect, test } from 'bun:test';

import { getConfigUpdateSnapshot } from '@/lib/configUpdate';
import { dict as enDict } from '@/lib/i18n/messages/en';
import { dict as zhCnDict } from '@/lib/i18n/messages/zh-CN';
import {
  applyPiSessionRecordsRefresh,
  getSessionRecordsReloadBlockReason,
  isSidebarSessionRecordsReloadVisible,
  postPiSessionRecordsReload,
  reloadPiSessionRecords,
  sessionRecordsReloadAriaKey,
  sessionRecordsReloadTooltipKey,
} from './sidebarSessionRecordsReload';

describe('isSidebarSessionRecordsReloadVisible', () => {
  test('shows on the Pi kernel', () => {
    expect(isSidebarSessionRecordsReloadVisible({ isPiKernel: true })).toBe(true);
  });

  test('hides on the leftover OpenCode kernel', () => {
    expect(isSidebarSessionRecordsReloadVisible({ isPiKernel: false })).toBe(false);
  });
});

describe('session records reload disable', () => {
  test('blocks a targeted busy or compacting session', () => {
    expect(getSessionRecordsReloadBlockReason({
      hasTargetedSession: true,
      statusType: 'busy',
      isReloadInFlight: false,
    })).toBe('busy');
    expect(getSessionRecordsReloadBlockReason({
      hasTargetedSession: true,
      isCompacting: true,
      isReloadInFlight: false,
    })).toBe('compacting');
  });

  test('stays available on a draft when no session is targeted', () => {
    expect(getSessionRecordsReloadBlockReason({
      hasTargetedSession: false,
      statusType: 'busy',
      isOutputting: true,
      isReloadInFlight: false,
    })).toBeNull();
  });

  test('blocks only while a refresh is already in flight', () => {
    expect(getSessionRecordsReloadBlockReason({
      hasTargetedSession: false,
      isReloadInFlight: true,
    })).toBe('inFlight');
  });
});

describe('session records reload copy', () => {
  test('keeps English and Simplified Chinese action and toast copy', () => {
    expect(enDict['sessions.sidebar.footer.actions.refresh']).toBe('Refresh');
    expect(enDict['sessions.sidebar.footer.refresh.tooltip']).toBe('Reload sessions and the open transcript');
    expect(enDict['sessions.sidebar.footer.refresh.success']).toBe('Reloaded sessions and the open transcript');
    expect(zhCnDict['sessions.sidebar.footer.actions.refresh']).toBe('刷新');
    expect(zhCnDict['sessions.sidebar.footer.refresh.tooltip']).toBe('重新加载会话列表和当前对话');
    expect(zhCnDict['sessions.sidebar.footer.refresh.success']).toBe('已重新加载会话列表和当前对话');
    expect(zhCnDict['sessions.sidebar.footer.refresh.tooltip']).not.toBe(
      enDict['sessions.sidebar.footer.refresh.tooltip'],
    );
  });

  test('uses idle tooltip and aria when the control is available', () => {
    expect(sessionRecordsReloadTooltipKey(null)).toBe('sessions.sidebar.footer.refresh.tooltip');
    expect(sessionRecordsReloadAriaKey(null)).toBe('sessions.sidebar.footer.refresh.aria');
    expect(sessionRecordsReloadAriaKey('busy')).toBe('sessions.sidebar.footer.refresh.disabledBusy');
    expect(sessionRecordsReloadTooltipKey('compacting')).toBe('sessions.sidebar.footer.refresh.disabledCompacting');
    expect(sessionRecordsReloadAriaKey('inFlight')).toBe('sessions.sidebar.footer.refresh.disabledInFlight');
  });
});

describe('reloadPiSessionRecords', () => {
  test('posts the Pi session-records reload then refreshes list and messages', async () => {
    const calls: string[] = [];
    await reloadPiSessionRecords({
      sessionID: 'ses_open',
      directory: '/tmp/project',
      fetchImpl: async (path, init) => {
        calls.push(`post:${path}`);
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ sessionID: 'ses_open' }));
        return {
          ok: true,
          json: async () => ({
            reloaded: true,
            kernel: 'pi',
            sessionID: 'ses_open',
            sessions: [{ id: 'ses_open' }],
            messages: [{ info: { id: 'msg_1' } }],
          }),
        };
      },
      requestBootstrap: (demand) => {
        calls.push(`bootstrap:${demand.directory}:${demand.force}`);
      },
      refreshGlobalSessions: async () => {
        calls.push('global');
      },
      refreshMessages: async (target) => {
        calls.push(`messages:${target.sessionID}`);
      },
      refreshLists: async () => {
        calls.push('lists');
      },
    });
    expect(calls).toEqual([
      'post:/api/pi/sessions/reload',
      'bootstrap:/tmp/project:true',
      'global',
      'messages:ses_open',
      'lists',
    ]);
  });

  test('does not call startConfigUpdate or require a session id', async () => {
    const before = getConfigUpdateSnapshot();
    await postPiSessionRecordsReload(null, async (path) => {
      expect(path).toBe('/api/pi/sessions/reload');
      return {
        ok: true,
        json: async () => ({ reloaded: true, kernel: 'pi' }),
      };
    });
    const after = getConfigUpdateSnapshot();
    expect(after.isUpdating).toBe(before.isUpdating);
    expect(after.isUpdating).toBe(false);
  });

  test('does not refresh UI state when the host reload fails', async () => {
    const calls: string[] = [];
    await expect(reloadPiSessionRecords({
      sessionID: 'ses_open',
      directory: '/tmp/project',
      fetchImpl: async () => {
        calls.push('post');
        return {
          ok: false,
          json: async () => ({ error: 'Wait for the current response to finish before reloading.' }),
        };
      },
      requestBootstrap: () => {
        calls.push('bootstrap');
      },
      refreshMessages: async () => {
        calls.push('messages');
      },
      refreshLists: async () => {
        calls.push('lists');
      },
    })).rejects.toThrow('Wait for the current response to finish before reloading.');
    expect(calls).toEqual(['post']);
  });

  test('apply refresh does not change the selected session', async () => {
    const selected = { sessionID: 'ses_open' };
    await applyPiSessionRecordsRefresh({
      directory: '/tmp/project',
      sessionID: 'ses_open',
      requestBootstrap: () => undefined,
      refreshGlobalSessions: async () => undefined,
      refreshMessages: async () => undefined,
      refreshLists: async () => undefined,
    });
    expect(selected.sessionID).toBe('ses_open');
  });
});
