import { beforeEach, describe, expect, mock, test } from 'bun:test';

let runtimeFetchImpl: () => Promise<Response> = async () => new Response('{}', { status: 500 });
let fetchCalls = 0;

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: async () => {
    fetchCalls += 1;
    return runtimeFetchImpl();
  },
}));

const { useKimiUsageStore } = await import('./useKimiUsageStore');

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

describe('useKimiUsageStore', () => {
  beforeEach(() => {
    fetchCalls = 0;
    runtimeFetchImpl = async () => new Response('{}', { status: 500 });
    useKimiUsageStore.getState().reset();
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
          error: 'Kimi Code usage response had no usable windows',
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(okPayload), {
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const first = useKimiUsageStore.getState().fetchUsage();
    const second = useKimiUsageStore.getState().fetchUsage();
    expect(fetchCalls).toBe(1);

    releaseFirst?.();
    await Promise.all([first, second]);

    expect(fetchCalls).toBe(2);
    expect(useKimiUsageStore.getState().payload?.ok).toBe(true);
    expect(useKimiUsageStore.getState().payload?.usage?.windows?.billing_cycle?.usedPercent).toBe(9);
    expect(useKimiUsageStore.getState().error).toBeNull();
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

    const pending = useKimiUsageStore.getState().fetchUsage();
    useKimiUsageStore.getState().reset();
    release?.();
    await pending;

    expect(useKimiUsageStore.getState().payload).toBeNull();
    expect(useKimiUsageStore.getState().error).toBeNull();
    expect(useKimiUsageStore.getState().isLoading).toBe(false);
  });
});
