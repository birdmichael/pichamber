import { describe, expect, test } from 'bun:test';
import { isJunkNotesProjectLabel } from './notesProjectLabel';

describe('notes quick name label', () => {
  test('treats bare tilde / root / empty as junk', () => {
    expect(isJunkNotesProjectLabel('~')).toBe(true);
    expect(isJunkNotesProjectLabel('~/')).toBe(true);
    expect(isJunkNotesProjectLabel('/')).toBe(true);
    expect(isJunkNotesProjectLabel('')).toBe(true);
    expect(isJunkNotesProjectLabel('   ')).toBe(true);
    expect(isJunkNotesProjectLabel(null)).toBe(true);
  });

  test('keeps real project names', () => {
    expect(isJunkNotesProjectLabel('pichamber')).toBe(false);
    expect(isJunkNotesProjectLabel('bm')).toBe(false);
    expect(isJunkNotesProjectLabel('~/Documents/Code')).toBe(false);
  });
});
