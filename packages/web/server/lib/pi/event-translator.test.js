import { describe, expect, it } from 'vitest';

import { createEventTranslator, extractPromptImages, extractPromptText } from './event-translator.js';

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


  it('attaches parentID, agent, model, and stable time to assistant info', () => {
    const t = translator();
    t.setUserMessage('msg_user', {
      agent: 'pi',
      model: { providerID: 'xai', modelID: 'grok-4.6' },
    });
    const started = t.translate({ type: 'message_start', message: { role: 'assistant', content: [] } });
    expect(started[0].properties.info).toMatchObject({
      id: 'msg_1',
      role: 'assistant',
      parentID: 'msg_user',
      agent: 'pi',
      model: { providerID: 'xai', modelID: 'grok-4.6' },
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
      source: { type: 'base64', mediaType: 'image/png', data: 'abc' },
    }]);
  });
});
