import { describe, expect, test, beforeEach } from 'bun:test';

import {
  buildSubagentHandoffMessage,
  formatSubagentOwnedLabel,
  hasActiveSubagentFleet,
  hasActiveWorkStatusSubagentRows,
  markSubagentHandoffPosted,
  openCodeChildBusy,
  resetSubagentHandoffLedgerForTests,
  shouldAutoHandoffSubagent,
  subagentHandoffKey,
  wasSubagentHandoffPosted,
} from './parentActivity';

describe('hasActiveSubagentFleet', () => {
  test('treats queued/running/blocked/paused as keeping the parent alive', () => {
    expect(hasActiveSubagentFleet([{ state: 'running' }])).toBe(true);
    expect(hasActiveSubagentFleet([{ state: 'queued' }, { state: 'done' }])).toBe(true);
    expect(hasActiveSubagentFleet([{ state: 'done' }, { state: 'failed' }])).toBe(false);
  });
});

describe('hasActiveWorkStatusSubagentRows', () => {
  test('counts permission and question as still in progress', () => {
    expect(hasActiveWorkStatusSubagentRows([{ status: 'permission' }])).toBe(true);
    expect(hasActiveWorkStatusSubagentRows([{ status: 'done' }])).toBe(false);
  });
});

describe('openCodeChildBusy', () => {
  test('detects busy leftover OpenCode children of the parent', () => {
    expect(openCodeChildBusy(
      [{ id: 'child', parentID: 'parent' }],
      'parent',
      { child: { type: 'busy' } },
    )).toBe(true);
    expect(openCodeChildBusy(
      [{ id: 'child', parentID: 'other' }],
      'parent',
      { child: { type: 'busy' } },
    )).toBe(false);
  });
});

describe('formatSubagentOwnedLabel', () => {
  test('marks deep-dive tabs as belonging to the parent session', () => {
    expect(formatSubagentOwnedLabel('scout', 'Main chat')).toBe('scout · Main chat');
    expect(formatSubagentOwnedLabel('scout', null)).toBe('scout');
  });
});

describe('shouldAutoHandoffSubagent', () => {
  test('auto-posts only background successes', () => {
    expect(shouldAutoHandoffSubagent({ mode: 'background', status: 'done', sessionID: 'ses' })).toBe(true);
    expect(shouldAutoHandoffSubagent({ mode: 'foreground', status: 'done', sessionID: 'ses' })).toBe(false);
    expect(shouldAutoHandoffSubagent({ mode: 'background', status: 'failed', sessionID: 'ses' })).toBe(false);
    expect(shouldAutoHandoffSubagent({ mode: 'background', status: 'done', sessionID: null })).toBe(false);
  });
});

describe('buildSubagentHandoffMessage', () => {
  test('fills the localized template and empty fallback', () => {
    expect(buildSubagentHandoffMessage('scout', 'found it', {
      withBody: 'Subagent "{name}" result:\n{body}',
      empty: 'Subagent "{name}" finished empty',
    })).toBe('Subagent "scout" result:\nfound it');
    expect(buildSubagentHandoffMessage('scout', '  ', {
      withBody: 'x',
      empty: 'Subagent "{name}" finished empty',
    })).toBe('Subagent "scout" finished empty');
  });
});

describe('subagent handoff ledger', () => {
  beforeEach(() => {
    resetSubagentHandoffLedgerForTests();
  });

  test('dedupes auto posts per parent/run', () => {
    const key = subagentHandoffKey('parent', 'run-1');
    expect(wasSubagentHandoffPosted(key)).toBe(false);
    markSubagentHandoffPosted(key);
    expect(wasSubagentHandoffPosted(key)).toBe(true);
  });
});
