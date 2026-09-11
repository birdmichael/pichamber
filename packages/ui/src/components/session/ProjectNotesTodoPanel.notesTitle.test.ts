import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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

  test('ProjectNotesTodoPanel imports isJunkNotesProjectLabel', () => {
    const source = readFileSync(new URL('./ProjectNotesTodoPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain("import { isJunkNotesProjectLabel } from './notesProjectLabel'");
  });
});
