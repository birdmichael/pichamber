import { afterEach, describe, expect, mock, test } from 'bun:test';

let pendingFetch: {
  resolve: (plan: { status: string; planMarkdown: string }) => void;
} | null = null;
const uiReplies: Array<{ url: string; body: string }> = [];
const planRequests: Array<{ url: string; body: string }> = [];

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async (url: string, init?: { body?: string }) => {
    const href = String(url);
    if (href.includes('/api/pi/ui/')) {
      uiReplies.push({ url: href, body: String(init?.body || '') });
      return { ok: true, status: 200, json: async () => true };
    }
    planRequests.push({ url: href, body: String(init?.body || '') });
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
  adoptDraftPlanForSession,
  answerPiExtensionPlanReadyOption,
  applySessionPlan,
  applySessionPlanEvent,
  dispatchSessionPlanAction,
  isPlanImplemented,
  refreshSessionPlan,
  resetPiSessionPlanStore,
  settleSessionPlanImplementing,
  usePiSessionPlanStore,
} = await import('./pi-session-plan-store');
const { applyPiExtensionUiPrompt, resetPiExtensionUiStore } = await import('./pi-extension-ui-store');

afterEach(() => {
  resetPiSessionPlanStore();
  resetPiExtensionUiStore();
  pendingFetch = null;
  uiReplies.length = 0;
  planRequests.length = 0;
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

  test('does not let a later GET off overwrite optimistic Plan after apply', async () => {
    applySessionPlan('ses_plan', { status: 'active', planMarkdown: '' });
    const refresh = refreshSessionPlan('ses_plan');
    pendingFetch?.resolve({ status: 'off', planMarkdown: '' });
    await refresh;
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('active');
  });

  test('does not let GET off overwrite pending first-send Plan', async () => {
    adoptDraftPlanForSession('ses_plan');
    const refresh = refreshSessionPlan('ses_plan');
    pendingFetch?.resolve({ status: 'off', planMarkdown: '' });
    await refresh;
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('active');
  });

  test('Build answers the pending plan-ready select instead of posting /plan implement', async () => {
    applySessionPlan('ses_plan', { status: 'ready', planMarkdown: '# Ready' });
    applyPiExtensionUiPrompt({
      id: 'pui_ready',
      sessionID: 'ses_plan',
      kind: 'select',
      title: 'Proposed plan ready. What next?',
      options: ['Implement here', 'Start fresh and implement'],
      status: 'pending',
    });

    const next = await dispatchSessionPlanAction('ses_plan', 'implement');

    expect(next).toEqual({ status: 'implementing', planMarkdown: '# Ready' });
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('implementing');
    expect(uiReplies).toHaveLength(1);
    expect(uiReplies[0]?.url).toContain('/api/pi/ui/pui_ready/reply');
    expect(uiReplies[0]?.body).toContain('Implement here');
    expect(pendingFetch).toBeNull();

    uiReplies.length = 0;
    const again = await dispatchSessionPlanAction('ses_plan', 'implement');
    expect(again?.status).toBe('implementing');
    expect(uiReplies).toHaveLength(0);
    expect(pendingFetch).toBeNull();
  });

  test('model-qualified Build posts the selected model instead of answering the prompt locally', async () => {
    applySessionPlan('ses_plan', { status: 'ready', planMarkdown: '# Ready' });
    applyPiExtensionUiPrompt({
      id: 'pui_ready',
      sessionID: 'ses_plan',
      kind: 'select',
      title: 'Proposed plan ready. What next?',
      options: ['Implement here', 'Start fresh and implement'],
      status: 'pending',
    });

    const request = dispatchSessionPlanAction('ses_plan', 'implement', { model: 'xai/grok-4.1' });
    await Promise.resolve();
    expect(uiReplies).toHaveLength(0);
    expect(planRequests).toHaveLength(1);
    expect(planRequests[0]?.body).toContain('"model":"xai/grok-4.1"');

    pendingFetch?.resolve({ status: 'implementing', planMarkdown: '# Ready' });
    const next = await request;
    expect(next?.status).toBe('implementing');
  });

  test('Q&A reply Implement here writes implementing; GET off does not restore ready', async () => {
    applySessionPlan('ses_plan', { status: 'ready', planMarkdown: '# Ready' });
    const prompt = {
      id: 'pui_ready',
      sessionID: 'ses_plan',
      kind: 'select',
      title: 'Proposed plan ready. What next?',
      options: ['Implement here', 'Start fresh and implement'],
      status: 'pending',
    };
    applyPiExtensionUiPrompt(prompt);

    const handled = await answerPiExtensionPlanReadyOption('ses_plan', prompt, 'Implement here');

    expect(handled).toBe(true);
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('implementing');
    expect(uiReplies).toHaveLength(1);
    expect(uiReplies[0]?.body).toContain('Implement here');

    applySessionPlanEvent({
      sessionID: 'ses_plan',
      plan: { status: 'off', planMarkdown: '' },
    });
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('implementing');

    const refreshOff = refreshSessionPlan('ses_plan');
    pendingFetch?.resolve({ status: 'off', planMarkdown: '' });
    await refreshOff;
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('implementing');

    applySessionPlanEvent({
      sessionID: 'ses_plan',
      plan: { status: 'ready', planMarkdown: '# Ready' },
    });
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('implementing');

    const refreshReady = refreshSessionPlan('ses_plan');
    pendingFetch?.resolve({ status: 'ready', planMarkdown: '# Ready' });
    await refreshReady;
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('implementing');
  });

  test('agent_settled clears implementing; leftover GET implementing does not restore building chrome', async () => {
    applySessionPlan('ses_plan', { status: 'ready', planMarkdown: '# Ready' });
    applyPiExtensionUiPrompt({
      id: 'pui_ready',
      sessionID: 'ses_plan',
      kind: 'select',
      title: 'Proposed plan ready. What next?',
      options: ['Implement here', 'Start fresh and implement'],
      status: 'pending',
    });

    await dispatchSessionPlanAction('ses_plan', 'implement');
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('implementing');
    expect(isPlanImplemented('ses_plan')).toBe(true);

    settleSessionPlanImplementing('ses_plan');
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('off');
    expect(isPlanImplemented('ses_plan')).toBe(true);

    applySessionPlanEvent({
      sessionID: 'ses_plan',
      plan: { status: 'ready', planMarkdown: '# Ready' },
    });
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('off');

    applySessionPlanEvent({
      sessionID: 'ses_plan',
      plan: { status: 'implementing', planMarkdown: '# Ready' },
    });
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('off');

    const refreshOff = refreshSessionPlan('ses_plan');
    pendingFetch?.resolve({ status: 'off', planMarkdown: '' });
    await refreshOff;
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('off');
    expect(isPlanImplemented('ses_plan')).toBe(true);

    const refreshImplementing = refreshSessionPlan('ses_plan');
    pendingFetch?.resolve({ status: 'implementing', planMarkdown: '# Ready' });
    await refreshImplementing;
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('off');
  });

  test('Q&A non-implement options still skip the implementing write', async () => {
    applySessionPlan('ses_plan', { status: 'ready', planMarkdown: '# Ready' });
    const prompt = {
      id: 'pui_ready',
      sessionID: 'ses_plan',
      kind: 'select',
      title: 'Proposed plan ready. What next?',
      options: ['Implement here', 'Save for later'],
      status: 'pending',
    };
    applyPiExtensionUiPrompt(prompt);

    const handled = await answerPiExtensionPlanReadyOption('ses_plan', prompt, 'Save for later');

    expect(handled).toBe(false);
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan?.status).toBe('ready');
    expect(uiReplies).toHaveLength(0);
  });

  test('Q&A Discard plan and exit clears ready chrome optimistically', async () => {
    applySessionPlan('ses_plan', { status: 'ready', planMarkdown: '# Ready' });
    applyPiExtensionUiPrompt({
      id: 'pui_exit',
      sessionID: 'ses_plan',
      kind: 'select',
      title: 'Proposed plan ready',
      options: ['Implement here', 'Start fresh and implement', 'Discard plan and exit'],
      status: 'pending',
    });

    const handled = await answerPiExtensionPlanReadyOption(
      'ses_plan',
      {
        kind: 'select',
        title: 'Proposed plan ready',
        options: ['Implement here', 'Start fresh and implement', 'Discard plan and exit'],
      },
      'Discard plan and exit',
    );
    expect(handled).toBe(true);
    expect(uiReplies.length).toBe(1);
    expect(usePiSessionPlanStore.getState().plansBySession.ses_plan).toEqual({
      status: 'off',
      planMarkdown: '',
    });
    // Allow background refresh
    pendingFetch?.resolve({ status: 'off', planMarkdown: '' });
  });

});
