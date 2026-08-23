import { afterEach, describe, expect, test } from 'bun:test';

import type { FilesAPI, GitLogEntry, GitLogResponse, RuntimeAPIs } from './api/types';
import { registerRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import {
  COMMIT_STYLE_SAMPLE_COUNT,
  COMMIT_STYLE_SUBJECT_CHAR_LIMIT,
  PULL_REQUEST_TEMPLATE_CHAR_LIMIT,
  PULL_REQUEST_TEMPLATE_PATHS,
  collectPullRequestTemplate,
  collectRecentCommitSubjects,
} from './gitGenerationContext';

const logResponse = (messages: Array<string | undefined>): GitLogResponse => ({
  all: messages.map((message, index) => ({
    hash: `hash-${index}`,
    date: '2026-08-23',
    message: message ?? '',
    refs: '',
    body: '',
    author_name: 'tester',
    author_email: 'tester@example.com',
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    parents: [],
  })) as GitLogEntry[],
  latest: null,
  total: messages.length,
});

const withRuntimeFiles = async (
  files: Partial<FilesAPI>,
  callback: () => Promise<void>,
) => {
  registerRuntimeAPIs({ files } as RuntimeAPIs);
  try {
    await callback();
  } finally {
    registerRuntimeAPIs(null);
  }
};

afterEach(() => {
  registerRuntimeAPIs(null);
});

describe('collectRecentCommitSubjects', () => {
  test('formats newest-first subjects and asks for the style sample size', async () => {
    let received: { directory: string; maxCount: number } | null = null;
    const result = await collectRecentCommitSubjects('/repo', async (directory, options) => {
      received = { directory, maxCount: options.maxCount };
      return logResponse(['修复侧栏刷新', 'feat: add walkthrough', '']);
    });

    expect(received).toEqual({ directory: '/repo', maxCount: COMMIT_STYLE_SAMPLE_COUNT });
    expect(result).toBe('- 修复侧栏刷新\n- feat: add walkthrough');
  });

  test('treats an empty history as a normal empty sample', async () => {
    const result = await collectRecentCommitSubjects('/repo', async () => logResponse([]));
    expect(result).toBe('(no commits yet)');
  });

  test('truncates long subjects and reports a failed log as unavailable', async () => {
    const long = 'x'.repeat(COMMIT_STYLE_SUBJECT_CHAR_LIMIT + 20);
    const truncated = await collectRecentCommitSubjects('/repo', async () => logResponse([long]));
    expect(truncated).toBe(`- ${'x'.repeat(COMMIT_STYLE_SUBJECT_CHAR_LIMIT)}`);

    const failed = await collectRecentCommitSubjects('/repo', async () => {
      throw new Error('not a git repository');
    });
    expect(failed).toBe('(recent commits unavailable)');
  });
});

describe('collectPullRequestTemplate', () => {
  test('uses the first conventional template that has content', async () => {
    const reads: string[] = [];
    await withRuntimeFiles({
      readFile: async (path, options) => {
        reads.push(`${options?.directory ?? ''}:${path}`);
        if (path.endsWith('.github/PULL_REQUEST_TEMPLATE.md')) {
          return {
            path,
            content: '## Intent\n\n<!-- fill this -->\n\n- [ ] checklist\n',
          };
        }
        return { path, content: '' };
      },
    }, async () => {
      const block = await collectPullRequestTemplate('/repo/');
      expect(block).toContain('Repository pull request template, read from .github/PULL_REQUEST_TEMPLATE.md.');
      expect(block).toContain('----- BEGIN PULL REQUEST TEMPLATE -----');
      expect(block).toContain('## Intent');
      expect(block).toContain('- [ ] checklist');
      expect(block).toContain('----- END PULL REQUEST TEMPLATE -----');
    });

    expect(reads[0]).toBe('/repo/:/repo/.github/pull_request_template.md');
    expect(reads[1]).toBe('/repo/:/repo/.github/PULL_REQUEST_TEMPLATE.md');
    expect(reads).toHaveLength(2);
  });

  test('returns empty when no template is present', async () => {
    await withRuntimeFiles({
      readFile: async (path) => ({ path, content: '   ' }),
    }, async () => {
      expect(await collectPullRequestTemplate('/repo')).toBe('');
    });
  });

  test('treats a failed optional read as missing and continues probing', async () => {
    await withRuntimeFiles({
      readFile: async (path) => {
        if (path.includes('.github/')) {
          throw new Error('not found');
        }
        if (path.endsWith('PULL_REQUEST_TEMPLATE.md') && !path.includes('/docs/')) {
          return { path, content: '## Why\n\nFill me in\n' };
        }
        return { path, content: '' };
      },
    }, async () => {
      const block = await collectPullRequestTemplate('/repo');
      expect(block).toContain('read from PULL_REQUEST_TEMPLATE.md.');
      expect(block).toContain('## Why');
    });
  });

  test('falls back to optional fs read when no files API is registered', async () => {
    const previousFetch = globalThis.fetch;
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const requested: string[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { origin: 'http://localhost:3901' } },
    });
    globalThis.fetch = (async (input) => {
      requested.push(String(input));
      const url = new URL(String(input), 'http://localhost:3901');
      if (url.searchParams.get('path')?.endsWith('docs/PULL_REQUEST_TEMPLATE.md')) {
        return new Response('## Testing\n\n- [ ] ran checks\n', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      return new Response('', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }) as typeof fetch;

    try {
      const block = await collectPullRequestTemplate('/repo');
      expect(block).toContain('read from docs/PULL_REQUEST_TEMPLATE.md.');
      expect(block).toContain('## Testing');
      expect(requested.some((url) => url.includes('optional=true'))).toBe(true);
      expect(requested.some((url) => url.includes('docs%2FPULL_REQUEST_TEMPLATE.md'))).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', previousWindow);
      } else {
        delete (globalThis as { window?: Window }).window;
      }
    }
  });

  test('caps a very long template', async () => {
    const oversized = `${'a'.repeat(PULL_REQUEST_TEMPLATE_CHAR_LIMIT + 50)}\n`;
    await withRuntimeFiles({
      readFile: async (path) => ({
        path,
        content: path.endsWith(PULL_REQUEST_TEMPLATE_PATHS[0]) ? oversized : '',
      }),
    }, async () => {
      const block = await collectPullRequestTemplate('/repo');
      const start = block.indexOf('----- BEGIN PULL REQUEST TEMPLATE -----\n') + '----- BEGIN PULL REQUEST TEMPLATE -----\n'.length;
      const end = block.indexOf('\n----- END PULL REQUEST TEMPLATE -----');
      expect(block.slice(start, end).length).toBe(PULL_REQUEST_TEMPLATE_CHAR_LIMIT);
    });
  });
});
