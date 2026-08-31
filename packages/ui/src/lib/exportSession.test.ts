import { describe, expect, test } from 'bun:test';

import {
  exportFiltersForFormat,
  exportSessionTextFile,
  shouldToastSessionTextExport,
  type SessionTextExportResult,
} from './exportSessionSave';

describe('exportFiltersForFormat', () => {
  test('uses JSONL and HTML native-dialog filters', () => {
    expect(exportFiltersForFormat('jsonl')).toEqual([{ name: 'JSONL', extensions: ['jsonl'] }]);
    expect(exportFiltersForFormat('html')).toEqual([{ name: 'HTML', extensions: ['html'] }]);
  });
});

describe('exportSessionTextFile', () => {
  test('waits for the desktop save path and does not download', async () => {
    const downloads: Array<{ content: string; filename: string; mime: string }> = [];
    const saves: Array<{ filename: string; content: string }> = [];

    const result = await exportSessionTextFile({
      content: '{"type":"session"}\n',
      filename: 'session-2026-09-01.jsonl',
      mime: 'application/x-ndjson;charset=utf-8',
      filters: exportFiltersForFormat('jsonl'),
    }, {
      canSaveDesktop: () => true,
      saveDesktop: async ({ filename, content }) => {
        saves.push({ filename, content });
        return '/tmp/session-2026-09-01.jsonl';
      },
      download: (content, filename, mime) => {
        downloads.push({ content, filename, mime });
      },
    });

    expect(result).toEqual({ status: 'saved', path: '/tmp/session-2026-09-01.jsonl' });
    expect(saves).toEqual([{
      filename: 'session-2026-09-01.jsonl',
      content: '{"type":"session"}\n',
    }]);
    expect(downloads).toEqual([]);
    expect(shouldToastSessionTextExport(result)).toBe(true);
  });

  test('treats a canceled desktop Save dialog as silent — no file, no toast', async () => {
    let downloaded = false;

    const result = await exportSessionTextFile({
      content: '<html></html>',
      filename: 'session.html',
      mime: 'text/html;charset=utf-8',
    }, {
      canSaveDesktop: () => true,
      saveDesktop: async () => null,
      download: () => {
        downloaded = true;
      },
    });

    expect(result).toEqual({ status: 'canceled' });
    expect(downloaded).toBe(false);
    expect(shouldToastSessionTextExport(result)).toBe(false);
  });

  test('falls back to a browser download and toast when there is no native dialog', async () => {
    const downloads: Array<{ content: string; filename: string; mime: string }> = [];
    let saved = false;

    const result = await exportSessionTextFile({
      content: '{"type":"session"}\n',
      filename: 'session.jsonl',
      mime: 'application/x-ndjson;charset=utf-8',
    }, {
      canSaveDesktop: () => false,
      saveDesktop: async () => {
        saved = true;
        return '/should-not-save.jsonl';
      },
      download: (content, filename, mime) => {
        downloads.push({ content, filename, mime });
      },
    });

    expect(result).toEqual({ status: 'downloaded' });
    expect(saved).toBe(false);
    expect(downloads).toEqual([{
      content: '{"type":"session"}\n',
      filename: 'session.jsonl',
      mime: 'application/x-ndjson;charset=utf-8',
    }]);
    expect(shouldToastSessionTextExport(result)).toBe(true);
  });
});

describe('shouldToastSessionTextExport', () => {
  const cases: Array<[SessionTextExportResult, boolean]> = [
    [{ status: 'saved', path: '/tmp/out.jsonl' }, true],
    [{ status: 'downloaded' }, true],
    [{ status: 'canceled' }, false],
  ];

  for (const [result, expected] of cases) {
    test(`${result.status} ${expected ? 'toasts' : 'stays silent'}`, () => {
      expect(shouldToastSessionTextExport(result)).toBe(expected);
    });
  }
});
