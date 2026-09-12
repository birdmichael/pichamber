import { afterEach, describe, expect, test } from 'bun:test';
import { useUIStore } from './useUIStore';

const originalOptions = useUIStore.persist.getOptions();
const originalState = useUIStore.getState();

afterEach(() => {
  useUIStore.persist.setOptions(originalOptions);
  useUIStore.setState(originalState, true);
});

describe('scrollbar preference', () => {
  test('defaults to auto-hide when an existing install has no preference', async () => {
    expect(useUIStore.getInitialState().alwaysShowScrollbars).toBe(false);
    useUIStore.persist.setOptions({ storage: {
      getItem: () => ({ version: originalOptions.version, state: { dockBadgeEnabled: false } }),
      setItem: () => undefined,
      removeItem: () => undefined,
    } });
    useUIStore.setState(useUIStore.getInitialState(), true);
    await useUIStore.persist.rehydrate();
    expect(useUIStore.getState().alwaysShowScrollbars).toBe(false);
    expect(useUIStore.getState().dockBadgeEnabled).toBe(false);
  });

  for (const enabled of [true, false]) {
    test(`round-trips ${enabled} through the persisted store`, async () => {
      let saved: Parameters<NonNullable<typeof originalOptions.storage>['setItem']>[1] = {
        state: useUIStore.getInitialState(), version: originalOptions.version,
      };
      useUIStore.persist.setOptions({ storage: {
        getItem: () => saved,
        setItem: (_name, value) => { saved = value; },
        removeItem: () => undefined,
      } });
      useUIStore.getState().setAlwaysShowScrollbars(enabled);
      useUIStore.persist.setOptions({ storage: {
        getItem: () => saved,
        setItem: () => undefined,
        removeItem: () => undefined,
      } });
      useUIStore.getState().setAlwaysShowScrollbars(!enabled);
      await useUIStore.persist.rehydrate();
      expect(useUIStore.getState().alwaysShowScrollbars).toBe(enabled);
    });
  }

  test('persists on this device via the local UI store (not a sync document field)', () => {
    const partial = useUIStore.persist.getOptions().partialize?.(useUIStore.getState()) as Record<string, unknown> | undefined;
    expect(partial).toBeTruthy();
    expect('alwaysShowScrollbars' in (partial ?? {})).toBe(true);
  });
});
