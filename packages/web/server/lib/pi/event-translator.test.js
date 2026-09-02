import { describe, expect, it } from 'vitest';

import { createEventTranslator, extractPromptImages, extractPromptText, mapPiUsageToOpenCodeTokens } from './event-translator.js';

const translator = (overrides = {}) => createEventTranslator({
  sessionID: 'ses_1',
  directory: '/tmp/project',
  createMessageId: (() => {
    let n = 0;
    return () => `msg_${++n}`;
  })(),
  createPartId: (() => {
    let n = 0;
    return () => `prt_${++n}`;
  })(),
  createEventId: (() => {
    let n = 0;
    return () => `evt_${++n}`;
  })(),
  now: () => 1_700_000_000_000,
  ...overrides,
});

describe('createEventTranslator', () => {
  it('maps agent_start to session.status busy', () => {
    const events = translator().translate({ type: 'agent_start' });
    expect(events).toEqual([
      expect.objectContaining({
        type: 'session.status',
        properties: { sessionID: 'ses_1', status: { type: 'busy' } },
      }),
    ]);
  });

  it('maps agent_settled to idle, not agent_end', () => {
    const t = translator();
    expect(t.translate({ type: 'agent_end', messages: [], willRetry: false })).toEqual([]);
    const settled = t.translate({ type: 'agent_settled' });
    expect(settled.map((event) => event.type)).toEqual(['session.status', 'session.idle']);
    expect(settled[0].properties.status).toEqual({ type: 'idle' });
    expect(settled[1].properties.sessionID).toBe('ses_1');
  });

  it('clears the user-message slot on agent_settled so the next turn can insert', () => {
    const t = translator();
    t.setUserMessage('msg_user');
    expect(t.userMessageID).toBe('msg_user');
    t.translate({ type: 'agent_settled' });
    expect(t.userMessageID).toBe(null);
  });

  it('parents a post-settle implement assistant to the last visible user, not a Pi-native id', () => {
    const t = translator();
    t.setUserMessage('msg_user');
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    t.translate({ type: 'message_end', message: { role: 'assistant' } });
    t.translate({ type: 'agent_settled' });
    expect(t.userMessageID).toBe(null);

    const skipped = t.translate({
      type: 'message_start',
      message: { role: 'user', id: '5bb000de', content: 'Implement the plan.' },
    });
    expect(skipped).toEqual([]);
    expect(t.userMessageID).toBe(null);

    const started = t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    expect(started[0].properties.info.parentID).toBe('msg_user');
    const tool = t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_edit',
      toolName: 'edit',
      args: { path: 'README.md' },
    });
    const updated = tool.find((event) => event.type === 'message.updated');
    expect(updated?.properties.info.parentID ?? started[0].properties.info.parentID).toBe('msg_user');
    expect(tool.some((event) => event.type === 'message.part.updated' && event.properties.part.tool === 'edit')).toBe(true);
  });

  it('opens a new assistant for tools after settle instead of appending to the completed plan message', () => {
    const t = translator();
    t.setUserMessage('msg_user');
    const planStart = t.translate({ type: 'message_start', message: { role: 'assistant', id: 'asst_plan', content: [] } });
    expect(planStart[0].properties.info.id).toBe('asst_plan');
    t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_plan',
      toolName: 'plan_mode_complete',
      args: {},
    });
    t.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_plan',
      toolName: 'plan_mode_complete',
      isError: false,
      result: { details: { plan: '# Ready' } },
    });
    t.translate({ type: 'message_end', message: { role: 'assistant' } });
    t.translate({ type: 'agent_settled' });
    expect(t.assistantMessageID).toBe(null);

    const tool = t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_edit',
      toolName: 'edit',
      args: { path: 'README.md' },
    });
    const updated = tool.find((event) => event.type === 'message.updated');
    expect(updated.properties.info.id).not.toBe('asst_plan');
    expect(updated.properties.info.parentID).toBe('msg_user');
    expect(updated.properties.info.finish).toBeUndefined();
    expect(updated.properties.info.time.completed).toBeUndefined();
    const part = tool.find((event) => event.type === 'message.part.updated');
    expect(part.properties.part.messageID).toBe(updated.properties.info.id);
    expect(part.properties.part.tool).toBe('edit');
  });

  it('maps text_delta to message.part.delta field text', () => {
    const t = translator();
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const events = t.translate({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello' },
    });
    const delta = events.find((event) => event.type === 'message.part.delta');
    expect(delta.properties).toMatchObject({
      sessionID: 'ses_1',
      messageID: 'msg_1',
      partID: 'prt_1',
      field: 'text',
      delta: 'Hello',
    });
  });

  it('maps thinking_delta to a reasoning part text delta', () => {
    const t = translator();
    const events = t.translate({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'hmm' },
    });
    const updated = events.find((event) => event.type === 'message.part.updated');
    const delta = events.find((event) => event.type === 'message.part.delta');
    expect(updated.properties.part.type).toBe('reasoning');
    expect(delta.properties.field).toBe('text');
    expect(delta.properties.delta).toBe('hmm');
  });

  it('maps tool_execution_* to tool parts', () => {
    const t = translator();
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const start = t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_1',
      toolName: 'bash',
      args: { command: 'ls' },
    });
    const toolStart = start.find((event) => event.type === 'message.part.updated');
    expect(toolStart.properties.part).toMatchObject({
      type: 'tool',
      tool: 'bash',
      callID: 'call_1',
      state: expect.objectContaining({ status: 'running', input: { command: 'ls' } }),
    });

    const end = t.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_1',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: 'ok' }] },
      isError: false,
    });
    expect(end[0].properties.part.state.status).toBe('completed');
    expect(end[0].properties.part.state.output).toBe('ok');
    expect(end[0].properties.part.state.time.start).toBe(toolStart.properties.part.state.time.start);
    expect(end[0].properties.part.state.time.end).toBeGreaterThanOrEqual(end[0].properties.part.state.time.start);
    expect(end[0].properties.part.state.time.duration).toBe(
      end[0].properties.part.state.time.end - end[0].properties.part.state.time.start,
    );
  });

  it('keeps a tool start time across running updates', () => {
    const t = translator();
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const start = t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_timer',
      toolName: 'bash',
      args: { command: 'sleep 1' },
    });
    const firstStart = start.find((event) => event.type === 'message.part.updated').properties.part.state.time.start;
    const mid = t.translate({
      type: 'tool_execution_update',
      toolCallId: 'call_timer',
      toolName: 'bash',
      args: { command: 'sleep 1' },
      partialResult: { content: [{ type: 'text', text: '...' }] },
    });
    expect(mid[0].properties.part.state.time.start).toBe(firstStart);
    expect(mid[0].properties.part.state.time.end).toBeUndefined();
  });

  const latestToolParts = (events) => {
    const byId = new Map();
    for (const event of events) {
      if (event.type !== 'message.part.updated') continue;
      const part = event.properties.part;
      if (part?.type === 'tool') byId.set(part.id, part);
    }
    return [...byId.values()];
  };

  it('maps pichamber_web tool_execution_* to a chat tool part', () => {
    const t = translator();
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const envelope = JSON.stringify({
      schemaVersion: 1,
      ok: true,
      action: 'browser.snapshot',
      data: { url: 'https://example.test', title: 'Example' },
    });
    const start = t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_web',
      toolName: 'pichamber_web',
      args: { action: 'browser.snapshot' },
    });
    const toolStart = start.find((event) => event.type === 'message.part.updated');
    expect(toolStart.properties.part).toMatchObject({
      type: 'tool',
      tool: 'pichamber_web',
      callID: 'call_web',
      state: expect.objectContaining({ status: 'running', input: { action: 'browser.snapshot' } }),
    });

    const end = t.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_web',
      toolName: 'pichamber_web',
      result: { content: [{ type: 'text', text: envelope }] },
      isError: false,
    });
    expect(end[0].properties.part.tool).toBe('pichamber_web');
    expect(end[0].properties.part.state.status).toBe('completed');
    expect(end[0].properties.part.state.output).toBe(envelope);
  });

  it('maps a Pi pichamber_web toolcall_start + result to one part, not a leftover Tool', () => {
    const t = translator();
    const events = [];
    events.push(...t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } }));
    // Live Pi toolcall_start is contentIndex-only. A generated call id named
    // "tool" is the empty leftover Tool row above Pichamber Web.
    events.push(...t.translate({
      type: 'message_update',
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0 },
    }));
    events.push(...t.translate({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_end',
        contentIndex: 0,
        toolCall: {
          type: 'toolCall',
          id: 'call_web',
          name: 'pichamber_web',
          arguments: { action: 'browser.open', url: 'https://example.test' },
        },
      },
    }));
    const envelope = JSON.stringify({
      schemaVersion: 1,
      ok: true,
      action: 'browser.open',
      data: { url: 'https://example.test' },
    });
    events.push(...t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_web',
      toolName: 'pichamber_web',
      args: { action: 'browser.open', url: 'https://example.test' },
    }));
    events.push(...t.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_web',
      toolName: 'pichamber_web',
      args: { action: 'browser.open', url: 'https://example.test' },
      result: { content: [{ type: 'text', text: envelope }] },
      isError: false,
    }));

    const parts = latestToolParts(events);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: 'tool',
      tool: 'pichamber_web',
      callID: 'call_web',
      state: expect.objectContaining({
        status: 'completed',
        input: { action: 'browser.open', url: 'https://example.test' },
        output: envelope,
      }),
    });
    expect(parts.some((part) => part.tool === 'tool')).toBe(false);
  });

  it('reuses the same pichamber_web part when toolcall_start already has the call', () => {
    const t = translator();
    const events = [];
    events.push(...t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } }));
    events.push(...t.translate({
      type: 'message_update',
      message: {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call_web',
          name: 'pichamber_web',
          arguments: { action: 'browser.snapshot' },
        }],
      },
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0 },
    }));
    events.push(...t.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_web',
      toolName: 'pichamber_web',
      args: { action: 'browser.snapshot' },
      result: { content: [{ type: 'text', text: '{"ok":true}' }] },
      isError: false,
    }));

    const parts = latestToolParts(events);
    expect(parts).toHaveLength(1);
    expect(parts[0].tool).toBe('pichamber_web');
    expect(parts[0].id).toBe(events.find((event) => (
      event.type === 'message.part.updated' && event.properties.part.tool === 'pichamber_web'
    )).properties.part.id);
    expect(parts.some((part) => part.tool === 'tool')).toBe(false);
  });

  it('maps a Pi pichamber tool_execution_* to a chat tool part', () => {
    const t = translator();
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const envelope = JSON.stringify({
      schemaVersion: 1,
      ok: true,
      action: 'session.create',
      data: { sessionId: 'ses_from_tool' },
    });
    const start = t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_control',
      toolName: 'pichamber',
      args: { action: 'session.create', title: 'from-tool' },
    });
    expect(start.find((event) => event.type === 'message.part.updated').properties.part).toMatchObject({
      type: 'tool',
      tool: 'pichamber',
      callID: 'call_control',
    });
    const end = t.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_control',
      toolName: 'pichamber',
      result: { content: [{ type: 'text', text: envelope }] },
      isError: false,
    });
    expect(end[0].properties.part.tool).toBe('pichamber');
    expect(end[0].properties.part.state.output).toBe(envelope);
  });

  it('maps a Pi pichamber toolcall_start + result to one part, not a leftover Tool', () => {
    const t = translator();
    const events = [];
    events.push(...t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } }));
    events.push(...t.translate({
      type: 'message_update',
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0 },
    }));
    events.push(...t.translate({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_end',
        contentIndex: 0,
        toolCall: {
          type: 'toolCall',
          id: 'call_control',
          name: 'pichamber',
          arguments: { action: 'session.create' },
        },
      },
    }));
    events.push(...t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_control',
      toolName: 'pichamber',
      args: { action: 'session.create' },
    }));
    events.push(...t.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_control',
      toolName: 'pichamber',
      args: { action: 'session.create' },
      result: { content: [{ type: 'text', text: '{"ok":true}' }] },
      isError: false,
    }));

    const parts = latestToolParts(events);
    expect(parts).toHaveLength(1);
    expect(parts[0].tool).toBe('pichamber');
    expect(parts.some((part) => part.tool === 'tool')).toBe(false);
  });

  it('maps a failed pichamber_web call to an error tool part', () => {
    const t = translator();
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_web_err',
      toolName: 'pichamber_web',
      args: { action: 'browser.open' },
    });
    const end = t.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_web_err',
      toolName: 'pichamber_web',
      result: { content: [{ type: 'text', text: 'url is required' }] },
      isError: true,
    });
    expect(end[0].properties.part.tool).toBe('pichamber_web');
    expect(end[0].properties.part.state.status).toBe('error');
  });

  it('copies tool result details onto part metadata so subagent session ids survive', () => {
    const t = translator();
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_sub',
      toolName: 'subagent',
      args: { agent: 'scout' },
    });
    const end = t.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_sub',
      toolName: 'subagent',
      args: { agent: 'scout' },
      result: {
        content: [{ type: 'text', text: 'createHook is not yet implemented' }],
        details: { sessionId: 'child-from-details' },
      },
      isError: true,
    });
    expect(end[0].properties.part.state.metadata).toEqual({ sessionId: 'child-from-details' });
  });

  it('emits todo.updated on todo tool_execution_end with TaskDetails', () => {
    const t = translator();
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_todo',
      toolName: 'todo',
      args: { action: 'create', subject: 'Write tests' },
    });
    const end = t.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_todo',
      toolName: 'todo',
      args: { action: 'create', subject: 'Write tests' },
      result: {
        content: [{ type: 'text', text: 'Created task #1' }],
        details: {
          action: 'create',
          params: { subject: 'Write tests' },
          nextId: 2,
          tasks: [{ id: 1, subject: 'Write tests', status: 'pending' }],
        },
      },
      isError: false,
    });
    expect(end.map((event) => event.type)).toEqual(['message.part.updated', 'todo.updated']);
    expect(end[1].properties).toMatchObject({
      sessionID: 'ses_1',
      todos: [{ id: '1', content: 'Write tests', status: 'pending', priority: 'medium' }],
    });
  });

  it('does not wait for message_end and skips thrown todo errors', () => {
    const t = translator();
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_todo_err',
      toolName: 'todo',
      args: { action: 'update' },
    });
    const failed = t.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_todo_err',
      toolName: 'todo',
      result: { content: [{ type: 'text', text: 'boom' }] },
      isError: true,
    });
    expect(failed.map((event) => event.type)).toEqual(['message.part.updated']);

    const invalid = translator();
    invalid.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    invalid.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_todo_bad',
      toolName: 'todo',
      args: { action: 'list' },
    });
    const skipped = invalid.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_todo_bad',
      toolName: 'todo',
      result: { details: { tasks: [] } },
      isError: false,
    });
    expect(skipped.map((event) => event.type)).toEqual(['message.part.updated']);
  });

  it('emits pi.plan.updated on plan_mode_complete tool_execution_end', () => {
    const t = translator();
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    t.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_plan',
      toolName: 'plan_mode_complete',
      args: { plan: '# Ship it\n\nDo the work.' },
    });
    const end = t.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_plan',
      toolName: 'plan_mode_complete',
      args: { plan: '# Ship it\n\nDo the work.' },
      result: {
        content: [{ type: 'text', text: '**Proposed Plan**\n\n# Ship it\n\nDo the work.' }],
        details: {
          version: 1,
          source: 'plan_mode_complete',
          plan: '# Ship it\n\nDo the work.',
        },
      },
      isError: false,
    });
    expect(end.map((event) => event.type)).toEqual(['message.part.updated', 'pi.plan.updated']);
    expect(end[1].properties).toMatchObject({
      sessionID: 'ses_1',
      plan: {
        status: 'ready',
        planMarkdown: '# Ship it\n\nDo the work.',
        title: 'Ship it',
      },
    });
  });

  it('does not emit pi.plan.updated for a failed or empty plan_mode_complete', () => {
    const failedTranslator = translator();
    failedTranslator.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    failedTranslator.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_plan_err',
      toolName: 'plan_mode_complete',
      args: { plan: '# Nope' },
    });
    const failed = failedTranslator.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_plan_err',
      toolName: 'plan_mode_complete',
      result: { content: [{ type: 'text', text: 'boom' }] },
      isError: true,
    });
    expect(failed.map((event) => event.type)).toEqual(['message.part.updated']);

    const emptyTranslator = translator();
    emptyTranslator.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    emptyTranslator.translate({
      type: 'tool_execution_start',
      toolCallId: 'call_plan_empty',
      toolName: 'plan_mode_complete',
      args: { plan: '' },
    });
    const empty = emptyTranslator.translate({
      type: 'tool_execution_end',
      toolCallId: 'call_plan_empty',
      toolName: 'plan_mode_complete',
      result: { details: { version: 1, source: 'plan_mode_complete', plan: '   ' } },
      isError: false,
    });
    expect(empty.map((event) => event.type)).toEqual(['message.part.updated']);
  });


  it('attaches parentID, agent, model, and stable time to assistant info', () => {
    const t = translator();
    t.setUserMessage('msg_user', {
      agent: 'pi',
      model: { providerID: 'xai', modelID: 'example-model' },
    });
    const started = t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    expect(started[0].properties.sessionID).toBe('ses_1');
    expect(started[0].properties.info).toMatchObject({
      id: 'msg_1',
      sessionID: 'ses_1',
      role: 'assistant',
      parentID: 'msg_user',
      modelID: 'example-model',
      providerID: 'xai',
      mode: 'pi',
      agent: 'pi',
      path: { cwd: '/tmp/project', root: '/tmp/project' },
      model: { providerID: 'xai', modelID: 'example-model' },
      time: { created: 1_700_000_000_000 },
    });
    expect(started[0].properties.info.time.completed).toBeUndefined();
    expect(started[0].properties.info.finish).toBeUndefined();

    const ended = t.translate({ type: 'message_end', message: { role: 'assistant' } });
    expect(ended[0].properties.info).toMatchObject({
      parentID: 'msg_user',
      finish: 'stop',
      time: { created: 1_700_000_000_000, completed: 1_700_000_000_000 },
    });
  });

  it('freezes assistant completed time after the first message_end', () => {
    let nowMs = 1_700_000_000_000;
    const t = translator({ now: () => nowMs });
    t.setUserMessage('msg_user');
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    nowMs += 1_200;
    const ended = t.translate({ type: 'message_end', message: { role: 'assistant' } });
    expect(ended[0].properties.info.time.completed).toBe(1_700_000_001_200);

    nowMs += 50_000;
    const later = t.translate({ type: 'message_end', message: { role: 'assistant' } });
    expect(later[0].properties.info.time.completed).toBe(1_700_000_001_200);
    const usage = t.translate({ type: 'message_update', message: { usage: { input: 1, output: 1 } } });
    const updated = usage.find((event) => event.type === 'message.updated');
    if (updated) {
      expect(updated.properties.info.time.completed).toBe(1_700_000_001_200);
    }
  });

  it('stamps a live assistant from fallback/session model instead of leftover pi/pi', () => {
    const t = translator({
      fallbackModel: { providerID: 'example-provider', modelID: 'example-model' },
    });
    t.setUserMessage('msg_user');
    const started = t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    expect(started[0].properties.info).toMatchObject({
      parentID: 'msg_user',
      providerID: 'example-provider',
      modelID: 'example-model',
      model: { providerID: 'example-provider', modelID: 'example-model' },
    });
    expect(started[0].properties.info.providerID).not.toBe('pi');
    expect(started[0].properties.info.modelID).not.toBe('pi');
    expect(started[0].properties.info.cost).toBeUndefined();
    expect(started[0].properties.info.tokens).toBeUndefined();

    const partFirst = translator({
      fallbackModel: 'example-provider/example-model',
    });
    const livePart = partFirst.translate({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hi' },
    });
    const updated = livePart.find((event) => event.type === 'message.updated');
    expect(updated.properties.info).toMatchObject({
      providerID: 'example-provider',
      modelID: 'example-model',
    });
    expect(updated.properties.info.providerID).not.toBe('pi');
  });

  it('does not invent leftover pi/pi when no defaults or session model exist', () => {
    const t = translator();
    t.setUserMessage('msg_user');
    const started = t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    expect(started[0].properties.info.providerID).toBeUndefined();
    expect(started[0].properties.info.modelID).toBeUndefined();
    expect(started[0].properties.info.model).toBeUndefined();
    expect(started[0].properties.info.cost).toBeUndefined();
  });

  it('does not emit the Goal plugin system preamble as a user bubble', () => {
    const t = translator();
    const events = t.translate({
      type: 'message_start',
      message: {
        role: 'user',
        id: 'pi_preamble',
        content: 'Goal mode is active. Complete this goal fully: say bye',
      },
    });
    expect(events).toEqual([]);
    expect(t.userMessageID).toBeNull();
  });

  it('keeps a facade /goal user id when skipping the Goal preamble', () => {
    const t = translator();
    t.setUserMessage('msg_goal');
    const events = t.translate({
      type: 'message_start',
      message: {
        role: 'user',
        id: 'pi_preamble',
        content: 'Goal mode is active. Complete this goal fully: say bye',
      },
    });
    expect(events).toEqual([]);
    expect(t.userMessageID).toBe('msg_goal');
  });

  it('does not echo a second user text part when the facade already recorded the prompt', () => {
    const t = translator();
    t.setUserMessage('msg_user');
    const events = t.translate({
      type: 'message_start',
      message: { role: 'user', id: 'pi_user_echo', content: 'hello' },
    });
    expect(events).toEqual([]);
    expect(t.userMessageID).toBe('msg_user');
  });

  it('does not mint a Pi-native user bubble when the facade id was not set yet', () => {
    const t = translator();
    const events = t.translate({
      type: 'message_start',
      message: { role: 'user', id: '5bb000de', content: '帮我启动一个子代理 查看 我电脑磁盘' },
    });
    expect(events).toEqual([]);
    expect(t.userMessageID).toBe(null);
  });
  it('maps auto_retry_start to session.status retry', () => {
    const events = translator().translate({
      type: 'auto_retry_start',
      attempt: 2,
      delayMs: 1000,
      errorMessage: 'overloaded',
    });
    expect(events[0].type).toBe('session.status');
    expect(events[0].properties.status.type).toBe('retry');
    expect(events[0].properties.status.attempt).toBe(2);
    expect(events[0].properties.status.message).toBe('overloaded');
  });

  it('maps compaction_start to busy plus compact start, and successful compaction_end to compact end plus session.compacted', () => {
    const t = translator();
    const start = t.translate({ type: 'compaction_start', instructions: 'trim' });
    expect(start.map((event) => event.type)).toEqual(['session.status', 'session.compact']);
    expect(start[0].properties.status).toEqual({ type: 'busy' });
    expect(start[1].properties).toMatchObject({ sessionID: 'ses_1', status: 'start' });
    const end = t.translate({
      type: 'compaction_end',
      reason: 'manual',
      result: { summary: 'kept recent turns' },
      aborted: false,
      willRetry: false,
    });
    expect(end.map((event) => event.type)).toEqual(['session.compact', 'session.compacted']);
    expect(end[0]).toEqual(expect.objectContaining({
      type: 'session.compact',
      properties: { sessionID: 'ses_1', status: 'end' },
    }));
    expect(end[1]).toEqual(expect.objectContaining({
      type: 'session.compacted',
      properties: { sessionID: 'ses_1', directory: '/tmp/project' },
    }));
    expect(end.some((event) => event.type === 'session.idle')).toBe(false);
    expect(end.some((event) => event.type === 'session.status')).toBe(false);
  });

  it('does not emit session.compacted when compaction is aborted or fails', () => {
    const t = translator();
    const aborted = t.translate({
      type: 'compaction_end',
      reason: 'manual',
      result: undefined,
      aborted: true,
      willRetry: false,
    });
    expect(aborted.map((event) => event.type)).toEqual(['session.compact']);
    expect(aborted[0].properties).toEqual({ sessionID: 'ses_1', status: 'end' });

    const failed = t.translate({
      type: 'compaction_end',
      reason: 'manual',
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: 'Compaction failed: model overloaded',
    });
    expect(failed.map((event) => event.type)).toEqual(['session.compact']);
    expect(failed.some((event) => event.type === 'session.compacted')).toBe(false);
  });
});

describe('Pi usage mapping', () => {
  it('maps Pi usage onto OpenCode tokens and cost', () => {
    expect(mapPiUsageToOpenCodeTokens({
      input: 3200,
      output: 180,
      cacheRead: 400,
      cacheWrite: 50,
      reasoning: 40,
      totalTokens: 3830,
      cost: { total: 0.012 },
    })).toEqual({
      cost: 0.012,
      tokens: {
        input: 3200,
        output: 180,
        reasoning: 40,
        cache: { read: 400, write: 50 },
      },
    });
  });

  it('copies usage from message_end onto assistant info', () => {
    const t = translator();
    t.setUserMessage('msg_user');
    t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    const ended = t.translate({
      type: 'message_end',
      message: {
        role: 'assistant',
        usage: {
          input: 2500,
          output: 80,
          cacheRead: 100,
          cacheWrite: 0,
          reasoning: 12,
          cost: { total: 0.004 },
        },
      },
    });
    expect(ended[0].properties.info.tokens).toEqual({
      input: 2500,
      output: 80,
      reasoning: 12,
      cache: { read: 100, write: 0 },
    });
    expect(ended[0].properties.info.cost).toBe(0.004);
  });
});

describe('prompt extractors', () => {

  it('joins text parts and extracts data-url images', () => {
    expect(extractPromptText([
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
      { type: 'file', mime: 'image/png', url: 'data:image/png;base64,abc' },
    ])).toBe('hello\nworld');
    expect(extractPromptImages([
      { type: 'file', mime: 'image/png', url: 'data:image/png;base64,abc' },
    ])).toEqual([{
      type: 'image',
      mimeType: 'image/png',
      data: 'abc',
    }]);
    expect(extractPromptImages([
      { type: 'image', mimeType: 'image/jpeg', data: 'xyz' },
    ])).toEqual([{
      type: 'image',
      mimeType: 'image/jpeg',
      data: 'xyz',
    }]);
  });

  it('omits synthetic instruction parts from the visible user prompt', () => {
    const parts = [
      { type: 'text', text: 'Help me set up a scheduled task.' },
      { type: 'text', text: 'The user wants to set up a scheduled task that OpenChamber runs.', synthetic: true },
    ];
    expect(extractPromptText(parts)).toContain('The user wants to set up a scheduled task');
    expect(extractPromptText(parts, { includeSynthetic: false })).toBe('Help me set up a scheduled task.');
  });
});
