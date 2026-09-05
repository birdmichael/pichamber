import { beforeEach, describe, expect, mock, test } from 'bun:test';

let runtimeFetchImpl: () => Promise<Response> = async () => new Response('{}', { status: 500 });
let fetchCalls = 0;

let lastFetchUrl = '';

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: async (url: string) => {
    fetchCalls += 1;
    lastFetchUrl = url;
    return runtimeFetchImpl();
  },
}));

const { useXaiUsageStore } = await import('./useXaiUsageStore');

const okPayload = {
  ok: true,
  configured: true,
  slotActive: true,
  usage: {
    windows: {
      billing_cycle: {
        usedPercent: 9,
        remainingPercent: 91,
        windowSeconds: null,
        resetAfterSeconds: null,
        resetAt: 1_900_000_000_000,
        resetAtFormatted: null,
        resetAfterFormatted: null,
      },
    },
  },
};

describe('useXaiUsageStore', () => {
  beforeEach(() => {
    fetchCalls = 0;
    lastFetchUrl = '';
    runtimeFetchImpl = async () => new Response('{}', { status: 500 });
    useXaiUsageStore.getState().reset();
  });

  test('queues a refresh clicked while a fetch is in flight', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstHold = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    runtimeFetchImpl = async () => {
      if (fetchCalls === 1) {
        await firstHold;
        return new Response(JSON.stringify({
          ok: false,
          configured: true,
          slotActive: true,
          error: 'xAI billing response had no usable current-period usage',
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(okPayload), {
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const first = useXaiUsageStore.getState().fetchUsage();
    const second = useXaiUsageStore.getState().fetchUsage();
    expect(fetchCalls).toBe(1);

    releaseFirst?.();
    await Promise.all([first, second]);

    expect(fetchCalls).toBe(2);
    expect(useXaiUsageStore.getState().payload?.ok).toBe(true);
    expect(useXaiUsageStore.getState().payload?.usage?.windows?.billing_cycle?.usedPercent).toBe(9);
    expect(useXaiUsageStore.getState().error).toBeNull();
  });

  test('reset drops an in-flight result so a runtime switch cannot keep it', async () => {
    let release: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    runtimeFetchImpl = async () => {
      await hold;
      return new Response(JSON.stringify(okPayload), {
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const pending = useXaiUsageStore.getState().fetchUsage();
    useXaiUsageStore.getState().reset();
    release?.();
    await pending;

    expect(useXaiUsageStore.getState().payload).toBeNull();
    expect(useXaiUsageStore.getState().error).toBeNull();
    expect(useXaiUsageStore.getState().isLoading).toBe(false);
  });

  test('fetching a clone does not replace the primary xai snapshot', async () => {
    runtimeFetchImpl = async () => new Response(JSON.stringify({
      ...okPayload,
      providerId: lastFetchUrl.includes('xai-2') ? 'xai-2' : 'xai',
      providerName: lastFetchUrl.includes('xai-2') ? 'Work' : 'xAI',
    }), { headers: { 'Content-Type': 'application/json' } });

    await useXaiUsageStore.getState().fetchUsage();
    expect(useXaiUsageStore.getState().payload?.providerId ?? 'xai').toBe('xai');
    await useXaiUsageStore.getState().fetchUsage('xai-2');
    expect(useXaiUsageStore.getState().payload?.providerName).toBe('xAI');
    expect(useXaiUsageStore.getState().byId['xai-2']?.payload?.providerName).toBe('Work');
  });
});
