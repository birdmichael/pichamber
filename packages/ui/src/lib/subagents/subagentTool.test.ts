import { describe, expect, test } from 'bun:test';

import {
  isSubagentManagementCall,
  readSubagentCardAgent,
  readSubagentChildSessionId,
  readSubagentChildSessionIdFromRuns,
  shouldOfferSubagentChildOpen,
  shouldRenderDedicatedSubagentCard,
  shouldRenderOpenCodeSubtaskChrome,
  shouldShowPiFromSubagentLabel,
} from './subagentTool';

describe('shouldRenderDedicatedSubagentCard', () => {
  test('on Pi, uses the dedicated card only when the slot is on and the tool is subagent', () => {
    expect(shouldRenderDedicatedSubagentCard({
      tool: 'subagent',
      isPiKernel: true,
      subagentsSlotActive: true,
    })).toBe(true);
    expect(shouldRenderDedicatedSubagentCard({
      tool: 'subagent',
      isPiKernel: true,
      subagentsSlotActive: false,
    })).toBe(false);
    expect(shouldRenderDedicatedSubagentCard({
      tool: 'task',
      isPiKernel: true,
      subagentsSlotActive: true,
    })).toBe(false);
  });

  test('keeps the OpenCode Task card unchanged', () => {
    expect(shouldRenderDedicatedSubagentCard({
      tool: 'task',
      isPiKernel: false,
      subagentsSlotActive: false,
    })).toBe(true);
    expect(shouldRenderDedicatedSubagentCard({
      tool: 'subagent',
      isPiKernel: false,
      subagentsSlotActive: false,
    })).toBe(false);
  });
});

describe('leftover chrome gates', () => {
  test('hides OpenCode subtask and from-subagent chrome on Pi when the slot is off', () => {
    expect(shouldRenderOpenCodeSubtaskChrome({ isPiKernel: true, subagentsSlotActive: false })).toBe(false);
    expect(shouldShowPiFromSubagentLabel({ isPiKernel: true, subagentsSlotActive: false })).toBe(false);
  });

  test('leaves OpenCode chrome available', () => {
    expect(shouldRenderOpenCodeSubtaskChrome({ isPiKernel: false, subagentsSlotActive: false })).toBe(true);
    expect(shouldShowPiFromSubagentLabel({ isPiKernel: false, subagentsSlotActive: false })).toBe(true);
  });
});

describe('card fields', () => {
  test('reads the agent name and child session id from a subagent tool payload', () => {
    expect(readSubagentCardAgent({ agent: 'scout' })).toBe('scout');
    expect(readSubagentChildSessionId(
      { agent: 'scout' },
      JSON.stringify({ details: { sessionId: 'child-1' } }),
    )).toBe('child-1');
    expect(readSubagentChildSessionId({ childSessionId: 'child-from-input' }, 'failed')).toBe('child-from-input');
  });

  test('does not treat a management list as an open-child card', () => {
    expect(isSubagentManagementCall({ action: 'list' }, JSON.stringify({
      details: { mode: 'management', results: [] },
    }))).toBe(true);
    expect(readSubagentChildSessionId({ action: 'list' }, JSON.stringify({
      details: { mode: 'management', results: [] },
    }))).toBeNull();
    expect(shouldOfferSubagentChildOpen({
      childSessionId: null,
      input: { action: 'list' },
      output: JSON.stringify({ details: { mode: 'management', results: [] } }),
    })).toBe(false);
    expect(shouldOfferSubagentChildOpen({
      childSessionId: 'child-1',
      input: { agent: 'scout', task: 'Inspect the repo' },
    })).toBe(true);
  });

  test('joins a child session id from adapter runs by toolCallId', () => {
    expect(readSubagentChildSessionIdFromRuns([
      { runId: '170eaa63', toolCallId: 'call-disk', sessionID: '01a03f76-bfdd' },
    ], 'call-disk')).toBe('01a03f76-bfdd');
    expect(readSubagentChildSessionIdFromRuns([
      { runId: 'call-disk', sessionID: '01a03f76-bfdd' },
    ], 'call-disk')).toBe('01a03f76-bfdd');
    expect(readSubagentChildSessionIdFromRuns([
      { runId: 'other', sessionID: 'child' },
    ], 'call-disk')).toBeNull();
  });
});
