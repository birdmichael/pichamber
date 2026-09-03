import { describe, expect, test } from 'bun:test';
import { composerHistoryStepFromKey } from './composerHistoryKeys';

describe('composerHistoryStepFromKey', () => {
  test('plain arrows walk message history', () => {
    expect(composerHistoryStepFromKey({
      key: 'ArrowUp', altKey: false, ctrlKey: false, metaKey: false,
    })).toBe('older');
    expect(composerHistoryStepFromKey({
      key: 'ArrowDown', altKey: false, ctrlKey: false, metaKey: false,
    })).toBe('newer');
  });

  test('Alt+Up/Down does not recall history (session switch / menu accelerators)', () => {
    expect(composerHistoryStepFromKey({
      key: 'ArrowUp', altKey: true, ctrlKey: false, metaKey: false,
    })).toBe(null);
    expect(composerHistoryStepFromKey({
      key: 'ArrowDown', altKey: true, ctrlKey: false, metaKey: false,
    })).toBe(null);
  });
});
