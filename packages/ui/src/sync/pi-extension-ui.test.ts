import { afterEach, describe, expect, mock, test } from 'bun:test';

mock.module('@/components/ui', () => ({
  toast: {
    info: () => {},
    warning: () => {},
    error: () => {},
  },
}));
mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: async () => ({ ok: false, json: async () => null }),
}));

import {
  displaySelectOption,
  isFreeformOtherOption,
  parsePiExtensionUiNotify,
  parsePiExtensionUiPrompt,
  parsePiExtensionUiPromptList,
} from './pi-extension-ui';
import {
  applyPiExtensionUiNotify,
  applyPiExtensionUiPrompt,
  consumePiExtensionUiEditorStash,
  consumePiExtensionUiNotify,
  reconcilePiExtensionUiPrompts,
  resetPiExtensionUiStore,
  selectPendingConfirmPrompt,
  selectTranscriptPiExtensionUiPrompts,
  stashPiExtensionUiEditorText,
  usePiExtensionUiStore,
} from './pi-extension-ui-store';
import { handlePiExtensionUiEvent } from './pi-extension-ui-events';

afterEach(() => {
  resetPiExtensionUiStore();
});

describe('parsePiExtensionUiPrompt', () => {
  test('rejects OpenCode question payloads and unknown kinds', () => {
    expect(parsePiExtensionUiPrompt({
      id: 'q_1',
      sessionID: 'ses_1',
      questions: [{ question: 'Old protocol' }],
    })).toBeNull();
    expect(parsePiExtensionUiPrompt({
      id: 'pui_1',
      sessionID: 'ses_1',
      kind: 'question',
      title: 'Nope',
    })).toBeNull();
  });

  test('parses a trusted select prompt', () => {
    const prompt = parsePiExtensionUiPrompt({
      id: 'pui_1',
      sessionID: 'ses_1',
      kind: 'select',
      title: 'Scope: How wide?',
      options: ['1. One file — keep it local', '2. Other (free-form)'],
      multiple: false,
      status: 'pending',
    });
    expect(prompt?.id).toBe('pui_1');
    expect(prompt?.kind).toBe('select');
    expect(prompt?.multiple).toBe(false);
    expect(parsePiExtensionUiPromptList([prompt, { id: 'bad' }])).toEqual([prompt]);
  });
});

describe('plan-question option helpers', () => {
  test('detects Other and splits numbered label/description', () => {
    expect(isFreeformOtherOption('2. Other (free-form)')).toBe(true);
    expect(isFreeformOtherOption('1. Fast path — ship now')).toBe(false);
    expect(displaySelectOption('1. Fast path — ship the smallest change')).toEqual({
      label: 'Fast path',
      description: 'ship the smallest change',
      raw: '1. Fast path — ship the smallest change',
    });
  });
});

describe('pi extension UI store', () => {
  test('upserts asked/settled prompts without touching OpenCode question state', () => {
    applyPiExtensionUiPrompt({
      id: 'pui_1',
      sessionID: 'ses_1',
      kind: 'select',
      title: 'A',
      options: ['Yes', '2. Other (free-form)'],
      status: 'pending',
    });
    applyPiExtensionUiPrompt({
      id: 'pui_1',
      sessionID: 'ses_1',
      kind: 'select',
      title: 'A',
      options: ['Yes', '2. Other (free-form)'],
      status: 'replied',
      value: 'Yes',
    });
    const prompts = usePiExtensionUiStore.getState().promptsBySession.ses_1 ?? [];
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.status).toBe('replied');
    expect(prompts[0]?.value).toBe('Yes');
    expect(selectTranscriptPiExtensionUiPrompts(prompts)).toHaveLength(1);
  });

  test('keeps confirm prompts out of the transcript list', () => {
    applyPiExtensionUiPrompt({
      id: 'pui_2',
      sessionID: 'ses_1',
      kind: 'confirm',
      title: 'Replace goal?',
      message: 'Replace it?',
      status: 'pending',
    });
    const prompts = usePiExtensionUiStore.getState().promptsBySession.ses_1 ?? [];
    expect(selectTranscriptPiExtensionUiPrompts(prompts)).toEqual([]);
    expect(selectPendingConfirmPrompt(prompts)?.id).toBe('pui_2');
  });

  test('reconciles server pending prompts without treating fetch failure as empty', () => {
    applyPiExtensionUiPrompt({
      id: 'pui_local',
      sessionID: 'ses_1',
      kind: 'select',
      title: 'Local settled',
      status: 'replied',
      value: 'Yes',
    });
    applyPiExtensionUiPrompt({
      id: 'pui_stale',
      sessionID: 'ses_1',
      kind: 'select',
      title: 'Stale pending',
      status: 'pending',
    });
    reconcilePiExtensionUiPrompts('ses_1', null);
    expect(usePiExtensionUiStore.getState().promptsBySession.ses_1?.map((prompt) => prompt.id)).toEqual([
      'pui_local',
      'pui_stale',
    ]);
    reconcilePiExtensionUiPrompts('ses_1', [{
      id: 'pui_live',
      sessionID: 'ses_1',
      kind: 'editor',
      title: 'Other',
      multiple: false,
      status: 'pending',
    }]);
    expect(usePiExtensionUiStore.getState().promptsBySession.ses_1?.map((prompt) => prompt.id)).toEqual([
      'pui_local',
      'pui_live',
    ]);
  });

  test('queues ctx.ui.notify without requiring sessionID and accepts title aliases', () => {
    expect(parsePiExtensionUiNotify({
      message: 'Plan mode enabled. I will explore and plan, but not modify files.',
      level: 'info',
    })).toMatchObject({
      sessionID: '',
      message: 'Plan mode enabled. I will explore and plan, but not modify files.',
      level: 'info',
    });
    expect(parsePiExtensionUiNotify({
      sessionID: 'ses_1',
      title: 'Plan mode enabled. I will explore and plan, but not modify files.',
    })?.message).toBe('Plan mode enabled. I will explore and plan, but not modify files.');
    expect(parsePiExtensionUiNotify({
      type: 'pi.ui.notify',
      properties: {
        sessionID: 'ses_1',
        message: 'Plan mode enabled. I will explore and plan, but not modify files.',
        level: 'info',
      },
    })).toMatchObject({
      sessionID: 'ses_1',
      message: 'Plan mode enabled. I will explore and plan, but not modify files.',
    });
    expect(parsePiExtensionUiNotify({
      message: { text: 'Plan mode enabled. I will explore and plan, but not modify files.' },
    })?.message).toBe('Plan mode enabled. I will explore and plan, but not modify files.');

    handlePiExtensionUiEvent({
      type: 'pi.ui.notify',
      properties: {
        sessionID: 'ses_1',
        message: 'Plan mode enabled. I will explore and plan, but not modify files.',
        level: 'info',
      },
    });
    const queued = usePiExtensionUiStore.getState().notifies;
    expect(queued).toHaveLength(1);
    expect(queued[0]?.message).toBe('Plan mode enabled. I will explore and plan, but not modify files.');
    consumePiExtensionUiNotify(queued[0]!.id);
    expect(usePiExtensionUiStore.getState().notifies).toEqual([]);
    expect(applyPiExtensionUiNotify({ message: '' })).toBeNull();
  });

  test('hands Other text to the next editor for that session', () => {
    stashPiExtensionUiEditorText('ses_1', 'Only the host module');
    expect(consumePiExtensionUiEditorStash('ses_other')).toBeNull();
    expect(consumePiExtensionUiEditorStash('ses_1')).toBe('Only the host module');
    expect(consumePiExtensionUiEditorStash('ses_1')).toBeNull();
  });
});
