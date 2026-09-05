import { describe, expect, test } from 'bun:test';
import { assistantHasVisibleContent } from './assistantHasVisibleContent';
import type { ChatMessageEntry } from './lib/turns/types';

const base = (over: Partial<ChatMessageEntry> & { info?: Record<string, unknown> }): ChatMessageEntry => ({
  info: { id: 'a1', role: 'assistant', ...(over.info || {}) } as ChatMessageEntry['info'],
  parts: over.parts ?? [],
} as ChatMessageEntry);

describe('assistantHasVisibleContent', () => {
  test('empty parts with no error is invisible', () => {
    expect(assistantHasVisibleContent(base({ parts: [] }))).toBe(false);
  });

  test('whitespace-only text is invisible', () => {
    expect(assistantHasVisibleContent(base({
      parts: [{ type: 'text', text: '  \n' } as ChatMessageEntry['parts'][number]],
    }))).toBe(false);
  });

  test('non-empty text is visible', () => {
    expect(assistantHasVisibleContent(base({
      parts: [{ type: 'text', text: 'hi' } as ChatMessageEntry['parts'][number]],
    }))).toBe(true);
  });

  test('info.error.message alone keeps the row visible (#565)', () => {
    expect(assistantHasVisibleContent(base({
      parts: [],
      info: {
        error: {
          message: '401: {"message":"Invalid Authentication","type":"invalid_authentication_error"}',
        },
      },
    }))).toBe(true);
  });

  test('info.error.data.message alone keeps the row visible', () => {
    expect(assistantHasVisibleContent(base({
      parts: [],
      info: { error: { data: { message: 'Unauthorized' } } },
    }))).toBe(true);
  });

  test('empty error object is still invisible', () => {
    expect(assistantHasVisibleContent(base({
      parts: [],
      info: { error: {} },
    }))).toBe(false);
  });
});
