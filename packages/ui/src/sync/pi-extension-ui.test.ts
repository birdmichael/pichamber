import { afterEach, describe, expect, mock, test } from 'bun:test';

const wrapperToastCalls = {
  info: [] as Array<{ message: unknown; options: unknown }>,
  warning: [] as Array<{ message: unknown; options: unknown }>,
  error: [] as Array<{ message: unknown; options: unknown }>,
};
const sonnerToastCalls = {
  info: [] as Array<{ message: unknown; options: unknown }>,
  warning: [] as Array<{ message: unknown; options: unknown }>,
  error: [] as Array<{ message: unknown; options: unknown }>,
};

mock.module('@/components/ui', () => ({
  toast: {
    info: (message: unknown, options: unknown) => {
      wrapperToastCalls.info.push({ message, options });
    },
    warning: (message: unknown, options: unknown) => {
      wrapperToastCalls.warning.push({ message, options });
    },
    error: (message: unknown, options: unknown) => {
      wrapperToastCalls.error.push({ message, options });
    },
  },
}));
mock.module('sonner', () => ({
  toast: {
    info: (message: unknown, options: unknown) => {
      sonnerToastCalls.info.push({ message, options });
    },
    warning: (message: unknown, options: unknown) => {
      sonnerToastCalls.warning.push({ message, options });
    },
    error: (message: unknown, options: unknown) => {
      sonnerToastCalls.error.push({ message, options });
    },
  },
}));
mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: async () => ({ ok: false, json: async () => null }),
}));

import {
  displaySelectOption,
  isFreeformOtherOption,
  isRoutineSessionBackfillNotify,
  isTypeSomethingOption,
  parsePiExtensionUiNotify,
  parsePiExtensionUiPrompt,
  parsePiExtensionUiPromptList,
} from './pi-extension-ui';
import {
  applyPiExtensionUiNotify,
  applyPiExtensionUiPrompt,
  consumePiExtensionUiEditorStash,
  consumePiExtensionUiNotify,
  piExtensionUiNotifyToastOptions,
  presentPiExtensionUiNotify,
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
  wrapperToastCalls.info.length = 0;
  wrapperToastCalls.warning.length = 0;
  wrapperToastCalls.error.length = 0;
  sonnerToastCalls.info.length = 0;
  sonnerToastCalls.warning.length = 0;
  sonnerToastCalls.error.length = 0;
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
    expect(isFreeformOtherOption('Other')).toBe(true);
    expect(isFreeformOtherOption('1. Fast path — ship now')).toBe(false);
    expect(displaySelectOption('1. Fast path — ship the smallest change')).toEqual({
      label: 'Fast path',
      description: 'ship the smallest change',
      raw: '1. Fast path — ship the smallest change',
    });
  });

  test('treats Type something as Other, including numbered variants', () => {
    expect(isTypeSomethingOption('Type something.')).toBe(true);
    expect(isTypeSomethingOption('Type something')).toBe(true);
    expect(isTypeSomethingOption('3. Type something.')).toBe(true);
    expect(isTypeSomethingOption('3. Type something')).toBe(true);
    expect(isFreeformOtherOption('Type something.')).toBe(true);
    expect(isFreeformOtherOption('Type something')).toBe(true);
    expect(isFreeformOtherOption('3. Type something.')).toBe(true);
    expect(isFreeformOtherOption('3. Type something')).toBe(true);
    expect(isTypeSomethingOption('Type something else')).toBe(false);
    expect(isFreeformOtherOption('Type something else')).toBe(false);
    expect(isFreeformOtherOption('1. Fast path — ship now')).toBe(false);
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
    expect(selectTranscriptPiExtensionUiPrompts(prompts)).toEqual([]);
  });

  test('keeps only pending select/input/editor prompts in the bottom dock', () => {
    applyPiExtensionUiPrompt({
      id: 'pui_pending',
      sessionID: 'ses_1',
      kind: 'select',
      title: 'Live question',
      options: ['Yes'],
      status: 'pending',
    });
    applyPiExtensionUiPrompt({
      id: 'pui_done',
      sessionID: 'ses_1',
      kind: 'input',
      title: 'Already answered',
      status: 'replied',
      value: 'typed this',
    });
    applyPiExtensionUiPrompt({
      id: 'pui_cancel',
      sessionID: 'ses_1',
      kind: 'editor',
      title: 'Dismissed',
      status: 'cancelled',
    });
    const prompts = usePiExtensionUiStore.getState().promptsBySession.ses_1 ?? [];
    expect(selectTranscriptPiExtensionUiPrompts(prompts).map((prompt) => prompt.id)).toEqual(['pui_pending']);
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

  test('does not toast routine session backfill complete status', () => {
    expect(isRoutineSessionBackfillNotify(
      '🧠 Session backfill complete: 0 indexed, 51 skipped, 0 messages (1 file error).',
    )).toBe(true);
    expect(isRoutineSessionBackfillNotify('⚠️ Session backfill failed: sqlite busy')).toBe(false);
    expect(isRoutineSessionBackfillNotify('⚠️ Session backfill check failed: missing dir')).toBe(false);
    expect(applyPiExtensionUiNotify({
      message: '🧠 Session backfill complete: 0 indexed, 51 skipped, 0 messages (1 file error).',
      level: 'warning',
    })).toBeNull();
    expect(usePiExtensionUiStore.getState().notifies).toEqual([]);
    presentPiExtensionUiNotify({
      message: '🧠 Session backfill complete: 0 indexed, 51 skipped, 0 messages.',
      level: 'info',
    });
    expect(sonnerToastCalls.info).toEqual([]);
    expect(sonnerToastCalls.warning).toEqual([]);
  });

  test('maps info notifies to a short top toast without an OK action', () => {
    expect(piExtensionUiNotifyToastOptions('info')).toEqual({
      duration: 3000,
      position: 'top-center',
    });
    expect(piExtensionUiNotifyToastOptions('warning')).toEqual({
      duration: 5000,
      position: 'top-center',
    });
    expect(piExtensionUiNotifyToastOptions('error')).toEqual({
      duration: 8000,
      position: 'top-center',
    });

    presentPiExtensionUiNotify({ message: 'Plan mode enabled.', level: 'info' });
    presentPiExtensionUiNotify({ message: 'Plan mode disabled.', level: 'info' });
    presentPiExtensionUiNotify({ message: 'Plan plugin warning.', level: 'warning' });
    presentPiExtensionUiNotify({ message: 'Plan plugin failed.', level: 'error' });

    expect(sonnerToastCalls.info).toEqual([
      { message: 'Plan mode enabled.', options: { duration: 3000, position: 'top-center' } },
      { message: 'Plan mode disabled.', options: { duration: 3000, position: 'top-center' } },
    ]);
    expect(sonnerToastCalls.warning).toEqual([
      { message: 'Plan plugin warning.', options: { duration: 5000, position: 'top-center' } },
    ]);
    expect(wrapperToastCalls.error).toEqual([
      { message: 'Plan plugin failed.', options: { duration: 8000, position: 'top-center' } },
    ]);
    expect(wrapperToastCalls.info).toEqual([]);
    expect(wrapperToastCalls.warning).toEqual([]);
  });

  test('hands Other text to the next editor for that session', () => {
    stashPiExtensionUiEditorText('ses_1', 'Only the host module');
    expect(consumePiExtensionUiEditorStash('ses_other')).toBeNull();
    expect(consumePiExtensionUiEditorStash('ses_1')).toBe('Only the host module');
    expect(consumePiExtensionUiEditorStash('ses_1')).toBeNull();
  });
});
