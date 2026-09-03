import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMarkdownFile, resolveDrawioViewMode, resolveMarkdownViewMode } from './fileViewerMode';

const filesViewSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'FilesView.tsx'),
  'utf-8',
);

describe('isMarkdownFile', () => {
  test('accepts markdown extensions', () => {
    expect(isMarkdownFile('docs/PICHAMBER.md')).toBe(true);
    expect(isMarkdownFile('README.markdown')).toBe(true);
    expect(isMarkdownFile('/repo/notes.MD')).toBe(true);
  });

  test('rejects non-markdown paths', () => {
    expect(isMarkdownFile('')).toBe(false);
    expect(isMarkdownFile('src/index.ts')).toBe(false);
    expect(isMarkdownFile('notes.mdx')).toBe(false);
  });
});

describe('resolveMarkdownViewMode', () => {
  test('defaults to preview when nothing is stored', () => {
    expect(resolveMarkdownViewMode({})).toBe('preview');
    expect(resolveMarkdownViewMode({ storedMode: null })).toBe('preview');
    expect(resolveMarkdownViewMode({ storedMode: '' })).toBe('preview');
    expect(resolveMarkdownViewMode({ storedMode: 'source' })).toBe('preview');
  });

  test('prefers a per-path mode over stored last-used mode', () => {
    expect(resolveMarkdownViewMode({ pathMode: 'edit', storedMode: 'preview' })).toBe('edit');
    expect(resolveMarkdownViewMode({ pathMode: 'preview', storedMode: 'edit' })).toBe('preview');
  });

  test('uses a stored last-used mode when this path has none', () => {
    expect(resolveMarkdownViewMode({ storedMode: 'edit' })).toBe('edit');
    expect(resolveMarkdownViewMode({ storedMode: 'preview' })).toBe('preview');
  });
});

describe('resolveDrawioViewMode', () => {
  test('defaults to preview when nothing is stored', () => {
    expect(resolveDrawioViewMode({})).toBe('preview');
    expect(resolveDrawioViewMode({ storedMode: null })).toBe('preview');
    expect(resolveDrawioViewMode({ storedMode: '' })).toBe('preview');
    expect(resolveDrawioViewMode({ storedMode: 'source' })).toBe('preview');
  });

  test('prefers a per-path mode over stored last-used mode', () => {
    expect(resolveDrawioViewMode({ pathMode: 'edit', storedMode: 'preview' })).toBe('edit');
    expect(resolveDrawioViewMode({ pathMode: 'preview', storedMode: 'edit' })).toBe('preview');
  });

  test('uses a stored last-used mode when this path has none', () => {
    expect(resolveDrawioViewMode({ storedMode: 'edit' })).toBe('edit');
    expect(resolveDrawioViewMode({ storedMode: 'preview' })).toBe('preview');
  });
});

describe('FilesView markdown chrome', () => {
  test('defaults markdown to the preview helper and does not overlay content', () => {
    expect(filesViewSource).toContain('resolveMarkdownViewMode');
    expect(filesViewSource).toContain("useState<PreviewViewMode>('preview')");
    expect(filesViewSource).not.toContain('absolute right-3 top-3 z-30');
  });
});

describe('FilesView drawio chrome', () => {
  test('defaults drawio to the preview helper instead of the generic preview setting', () => {
    expect(filesViewSource).toContain('resolveDrawioViewMode');
    expect(filesViewSource).not.toContain("setDrawioViewMode(drawioViewModeByPathRef.current[selectedPath] ?? (settingsDefaultFileViewerPreview ? 'preview' : 'edit'))");
  });
});
