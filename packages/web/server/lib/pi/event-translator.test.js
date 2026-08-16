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

  it('maps compaction_start to busy plus compact start, and compaction_end without idle', () => {
    const t = translator();
    const start = t.translate({ type: 'compaction_start', instructions: 'trim' });
    expect(start.map((event) => event.type)).toEqual(['session.status', 'session.compact']);
    expect(start[0].properties.status).toEqual({ type: 'busy' });
    expect(start[1].properties).toMatchObject({ sessionID: 'ses_1', status: 'start' });
    const end = t.translate({ type: 'compaction_end' });
    expect(end).toEqual([
      expect.objectContaining({
        type: 'session.compact',
        properties: { sessionID: 'ses_1', status: 'end' },
      }),
    ]);
    expect(end.some((event) => event.type === 'session.idle')).toBe(false);
    expect(end.some((event) => event.type === 'session.status')).toBe(false);
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
});
