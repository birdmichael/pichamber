import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'desktop.ts'),
  'utf8',
);

const chatInput = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../components/chat/ChatInput.tsx'),
  'utf8',
);

describe('desktop attach-files dialog', () => {
  test('composer attach uses a multi-file native dialog without GTK custom-type filters', () => {
    expect(source).toContain('export const requestFilesAccess');
    expect(source).toContain('multiple: true');
    expect(source).toContain("title: options?.title?.trim() || 'Attach files'");
    const fn = source.slice(source.indexOf('export const requestFilesAccess'));
    const body = fn.slice(0, fn.indexOf('export const requestExistingFileAccess'));
    expect(body).not.toContain('filters:');
    expect(chatInput).toContain('requestFilesAccess');
    expect(chatInput).toContain('isDesktopShell()');
    expect(chatInput).toContain('addLocalPathAttachment');
  });
});
