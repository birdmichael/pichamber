import { describe, expect, test } from 'bun:test';
import type { Message, Part, TextPart } from '@opencode-ai/sdk/v2';
import { createContextPart, type ContextPartPayload } from './messages/contextParts';
import { formatSessionAsMarkdown } from './exportSession';

type RecordEntry = { info: Message; parts: Part[] };
const textPart = (text: string, synthetic = false): TextPart => ({
  id: 'part', messageID: 'message', sessionID: 'session', type: 'text', text, synthetic,
});
function user(id: string, parts: Part[]): RecordEntry {
  return {
    info: { id, sessionID: 'session', role: 'user', time: { created: 1 }, agent: 'build', model: { providerID: 'provider', modelID: 'model' } },
    parts,
  };
}
function assistant(parentID: string, parts: Part[] = [textPart(`Answer ${parentID}`)]): RecordEntry {
  return {
    info: {
      id: `answer-${parentID}`, parentID, sessionID: 'session', role: 'assistant',
      time: { created: 2, completed: 3 }, finish: 'stop', providerID: 'provider', modelID: 'model', agent: 'build', mode: 'build',
      path: { cwd: '/project', root: '/project' }, cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }, parts,
  };
}
const contextPart = (payload: ContextPartPayload): TextPart => ({
  ...textPart(''), ...createContextPart(payload),
});

describe('Markdown export of attached context', () => {
  test('exports quote and reply with source and user comment', () => {
    const records = [
      user('quote', [
        contextPart({ kind: 'chat-quote', quote: 'Earlier answer', text: 'Fix this detail' }),
        textPart('Please update that.'),
      ]),
      assistant('quote'),
    ];
    const markdown = formatSessionAsMarkdown(records, 'Export test');
    expect(markdown).toContain('> Earlier answer');
    expect(markdown).toContain('**User comment:**');
    expect(markdown).toContain('Fix this detail');
    expect(markdown).toContain('Please update that.');
    expect(markdown).toContain('Answer quote');
  });
});
