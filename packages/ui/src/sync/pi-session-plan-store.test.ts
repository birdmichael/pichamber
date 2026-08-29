import { afterEach, describe, expect, mock, test } from 'bun:test';

let pendingFetch: {
  resolve: (plan: { status: string; planMarkdown: string }) => void;
} | null = null;

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async () => {
    const plan = await new Promise<{ status: string; planMarkdown: string }>((resolve) => {
      pendingFetch = { resolve };
    });
    return {
      ok: true,
      json: async () => plan,
    };
  }),
}));

const {
  applySessionPlan,
  refreshSessionPlan,
  resetPiSessionPlanStore,
  usePiSessionPlanStore,
} = await import('./pi-session-plan-store');

afterEach(() => {
  resetPiSessionPlanStore();
  pendingFetch = null;
});

describe('pi session plan store', () => {
  test('does not let a stale off fetch overwrite a later draft Plan start', async () => {
    const refresh = refreshSessionPlan('ses_plan');
    applySessionPlan('ses_plan', { status: 'active', planMarkdown: '' });
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('active');

    pendingFetch?.resolve({ status: 'off', planMarkdown: '' });
    await refresh;

    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('active');
  });
});
