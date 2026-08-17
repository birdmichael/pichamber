import { beforeEach, describe, expect, mock, test } from 'bun:test';

(mock as unknown as { restore?: () => void }).restore?.();

const fetchCalls: Array<{ url: string }> = [];

const runtimeFetchMock = mock(async (input: RequestInfo | URL) => {
  fetchCalls.push({ url: String(input) });
  return new Response(JSON.stringify(['package.json', 'packages/ui/package.json']), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

mock.module('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: mock(() => ({
    find: {
      files: mock(() => {
        throw new Error('OpenCode find.files should not be used on the Pi kernel');
      }),
    },
  })),
}));

mock.module('@/contexts/runtimeAPIRegistry', () => ({
  getRegisteredRuntimeAPIs: mock(() => null),
}));

mock.module('@/lib/runtime-url', () => ({
  getRuntimeUrlResolver: mock(() => ({
    api: (path: string) => path,
  })),
}));

mock.module('@/lib/runtime-switch', () => ({
  getRuntimeApiBaseUrl: mock(() => ''),
  getRuntimeKey: mock(() => 'test-runtime'),
}));

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: runtimeFetchMock,
}));

mock.module('@/lib/startupTrace', () => ({
  markStartupTrace: mock(() => undefined),
}));

const { opencodeClient } = await import(`./client?search-files-test=${Date.now()}`);

describe('opencodeClient.searchFiles', () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    runtimeFetchMock.mockClear();
  });

  test('queries Pi /find/files with directory and query instead of OpenCode /find/file', async () => {
    const hits = await opencodeClient.searchFiles('pack', {
      directory: '/workspace/pichamber',
      limit: 80,
      type: 'file',
    });

    expect(fetchCalls).toHaveLength(1);
    const url = fetchCalls[0].url;
    expect(url).toContain('/find/files?');
    expect(url).toContain('query=pack');
    expect(url).toContain(`directory=${encodeURIComponent('/workspace/pichamber')}`);
    expect(url).toContain('type=file');
    expect(hits.map((hit: { relativePath: string }) => hit.relativePath)).toEqual(['package.json', 'packages/ui/package.json']);
    expect(hits[0]?.name).toBe('package.json');
    expect(hits[0]?.path).toBe('/workspace/pichamber/package.json');
  });
});
