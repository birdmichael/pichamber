import { describe, expect, it } from 'vitest';

import {
  adaptQuestionToolForDesktop,
  executeQuestionViaDesktopUi,
  formatQuestionSelectOptions,
  isFreeformOtherOption,
  QUESTION_TYPE_SOMETHING_LABEL,
} from './question-desktop.js';
import { createExtensionUIController } from './extension-ui.js';

const createUi = () => {
  const events = [];
  const controller = createExtensionUIController({
    sessionID: 'ses_question',
    directory: '/tmp/project',
    emit: (_directory, event) => {
      events.push(event);
    },
  });
  return { controller, events };
};

const waitForPrompt = async (controller, kind) => {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const found = controller.list().find((prompt) => !kind || prompt.kind === kind);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(kind ? `Timed out waiting for ${kind} prompt` : 'Timed out waiting for prompt');
};

describe('question desktop mapping', () => {
  it('treats Type something as Other without dropping existing Other matches', () => {
    expect(isFreeformOtherOption('2. Other (free-form)')).toBe(true);
    expect(isFreeformOtherOption('Other')).toBe(true);
    expect(isFreeformOtherOption('Type something.')).toBe(true);
    expect(isFreeformOtherOption('Type something')).toBe(true);
    expect(isFreeformOtherOption('3. Type something.')).toBe(true);
    expect(isFreeformOtherOption('3. Type something')).toBe(true);
    expect(isFreeformOtherOption('Type something else')).toBe(false);
    expect(isFreeformOtherOption('1. Fast path — ship now')).toBe(false);
  });

  it('appends a numbered Type something option after the model labels', () => {
    expect(formatQuestionSelectOptions([
      { label: 'One file', description: 'keep it local' },
      { label: 'Whole repo' },
    ])).toEqual([
      '1. One file — keep it local',
      '2. Whole repo',
      `3. ${QUESTION_TYPE_SOMETHING_LABEL}`,
    ]);
  });

  it('resolves a selected option to the official question result shape', async () => {
    const { controller } = createUi();
    const pending = executeQuestionViaDesktopUi({
      question: 'How wide?',
      options: [{ label: 'One file', description: 'keep it local' }, { label: 'Whole repo' }],
    }, controller.context);

    const prompt = await waitForPrompt(controller, 'select');
    expect(prompt.title).toBe('How wide?');
    expect(prompt.options?.at(-1)).toBe(`3. ${QUESTION_TYPE_SOMETHING_LABEL}`);
    expect(controller.reply(prompt.id, '2. Whole repo')).toBe(true);

    await expect(pending).resolves.toEqual({
      content: [{ type: 'text', text: 'User selected: 2. Whole repo' }],
      details: {
        question: 'How wide?',
        options: ['One file', 'Whole repo'],
        answer: 'Whole repo',
        wasCustom: false,
      },
    });
  });

  it('opens editor after Type something and returns a custom answer', async () => {
    const { controller } = createUi();
    const pending = executeQuestionViaDesktopUi({
      question: 'How wide?',
      options: [{ label: 'One file' }, { label: 'Whole repo' }],
    }, controller.context);

    const select = await waitForPrompt(controller, 'select');
    expect(controller.reply(select.id, `3. ${QUESTION_TYPE_SOMETHING_LABEL}`)).toBe(true);
    const editor = await waitForPrompt(controller, 'editor');
    expect(controller.reply(editor.id, '  only the host module  ')).toBe(true);

    await expect(pending).resolves.toEqual({
      content: [{ type: 'text', text: 'User wrote: only the host module' }],
      details: {
        question: 'How wide?',
        options: ['One file', 'Whole repo'],
        answer: 'only the host module',
        wasCustom: true,
      },
    });
  });

  it('cancels when select or the Type something editor is dismissed', async () => {
    const { controller } = createUi();
    const cancelledSelect = executeQuestionViaDesktopUi({
      question: 'Stay?',
      options: [{ label: 'Yes' }],
    }, controller.context);
    const select = await waitForPrompt(controller, 'select');
    expect(controller.cancel(select.id)).toBe(true);
    await expect(cancelledSelect).resolves.toEqual({
      content: [{ type: 'text', text: 'User cancelled the selection' }],
      details: { question: 'Stay?', options: ['Yes'], answer: null },
    });

    const cancelledEditor = executeQuestionViaDesktopUi({
      question: 'Stay?',
      options: [{ label: 'Yes' }],
    }, controller.context);
    const other = await waitForPrompt(controller, 'select');
    expect(controller.reply(other.id, `2. ${QUESTION_TYPE_SOMETHING_LABEL}`)).toBe(true);
    const editor = await waitForPrompt(controller, 'editor');
    expect(controller.cancel(editor.id)).toBe(true);
    await expect(cancelledEditor).resolves.toEqual({
      content: [{ type: 'text', text: 'User cancelled the selection' }],
      details: { question: 'Stay?', options: ['Yes'], answer: null },
    });
  });

  it('opens an editor card when the question has no options', async () => {
    const { controller } = createUi();
    const pending = executeQuestionViaDesktopUi({
      question: 'What should we work on next?',
      options: [],
    }, controller.context);

    const prompt = await waitForPrompt(controller, 'editor');
    expect(prompt.title).toBe('What should we work on next?');
    expect(controller.reply(prompt.id, '  the login flow  ')).toBe(true);

    await expect(pending).resolves.toEqual({
      content: [{ type: 'text', text: 'User wrote: the login flow' }],
      details: {
        question: 'What should we work on next?',
        options: [],
        answer: 'the login flow',
        wasCustom: true,
      },
    });
  });

  it('cancels an open-ended question when the editor is dismissed', async () => {
    const { controller } = createUi();
    const pending = executeQuestionViaDesktopUi({
      question: 'What should we work on next?',
    }, controller.context);
    const prompt = await waitForPrompt(controller, 'editor');
    expect(controller.cancel(prompt.id)).toBe(true);
    await expect(pending).resolves.toEqual({
      content: [{ type: 'text', text: 'User cancelled the selection' }],
      details: { question: 'What should we work on next?', options: [], answer: null },
    });
  });

  it('replaces the installed question execute with the Desktop mapping', async () => {
    const { controller } = createUi();
    let originalCalls = 0;
    const definition = {
      name: 'question',
      execute: async () => {
        originalCalls += 1;
        return { content: [{ type: 'text', text: 'TUI path' }] };
      },
    };
    const session = {
      getToolDefinition: (name) => (name === 'question' ? definition : undefined),
    };

    expect(adaptQuestionToolForDesktop(session, controller.context)).toBe(true);
    expect(adaptQuestionToolForDesktop(session, controller.context)).toBe(true);

    const pending = definition.execute('call_1', {
      question: 'Pick one',
      options: [{ label: 'A' }],
    }, undefined, undefined, { ui: controller.context, mode: 'rpc' });
    const prompt = await waitForPrompt(controller, 'select');
    expect(controller.reply(prompt.id, '1. A')).toBe(true);
    await expect(pending).resolves.toMatchObject({
      details: { answer: 'A', wasCustom: false },
    });
    expect(originalCalls).toBe(0);
  });
});
