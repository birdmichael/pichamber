import { afterEach, describe, expect, mock, test } from 'bun:test';
import { useSessionUIStore } from '@/sync/session-ui-store';

const fetchCalls: Array<{ url: string; method?: string; body?: string }> = [];

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async (url: string, init?: { method?: string; body?: string }) => {
    fetchCalls.push({ url: String(url), method: init?.method, body: init?.body });
    return { ok: true, status: 200, json: async () => ({}) };
  }),
}));

const { applyComposerThinking, cycleComposerThinking } = await import('./cycleComposerThinking');
const { usePiThinkingChipStore } = await import('./piThinkingChipStore');

afterEach(() => {
  fetchCalls.length = 0;
  usePiThinkingChipStore.setState({
    level: undefined,
    hasLevels: false,
    levels: [],
    pinGeneration: 0,
    pinKey: '',
  });
  useSessionUIStore.setState({ currentSessionId: null });
});

describe('cycleComposerThinking', () => {
  test('cycles the Pi chip store instead of leftover OpenCode variants', () => {
    usePiThinkingChipStore.getState().setLevel('low', true, ['low', 'medium', 'high']);
    expect(cycleComposerThinking(true)).toBe(true);
    expect(usePiThinkingChipStore.getState().level).toBe('medium');
  });

  test('no-ops when the Pi model has no levels', () => {
    usePiThinkingChipStore.getState().setLevel(undefined, false, []);
    expect(cycleComposerThinking(true)).toBe(false);
  });

  test('scopes the pin to the current session and encodes the PATCH path', async () => {
    useSessionUIStore.setState({ currentSessionId: 'ses/a b' });
    await applyComposerThinking('high', { levels: ['low', 'medium', 'high'] });
    const pin = usePiThinkingChipStore.getState();
    expect(pin.level).toBe('high');
    expect(pin.pinKey).toContain('ses/a b');
    expect(fetchCalls.some((call) => call.url === '/api/session/ses%2Fa%20b/thinking' && call.method === 'PATCH')).toBe(true);
  });
});
