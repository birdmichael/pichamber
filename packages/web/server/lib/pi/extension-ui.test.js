import { describe, expect, it } from 'vitest';

import { createExtensionUIController, EXTENSION_UI_EVENTS } from './extension-ui.js';

const createController = () => {
  const events = [];
  const controller = createExtensionUIController({
    sessionID: 'ses_test',
    directory: '/tmp/project',
    emit: (directory, event) => {
      events.push({ directory, event });
    },
  });
  return { controller, events };
};

describe('Desktop ExtensionUIContext', () => {
  it('resolves select with the submitted option and does not use OpenCode question events', async () => {
    const { controller, events } = createController();
    const pending = controller.context.select('Header: Which approach?', [
      '1. Fast path — ship the smallest change',
      '2. Other (free-form)',
    ]);
    const [prompt] = controller.list();
    expect(prompt.kind).toBe('select');
    expect(prompt.status).toBe('pending');
    expect(events[0].event.type).toBe(EXTENSION_UI_EVENTS.asked);
    expect(events[0].event.properties.prompt.id).toBe(prompt.id);

    expect(controller.reply(prompt.id, '1. Fast path — ship the smallest change')).toBe(true);
    await expect(pending).resolves.toBe('1. Fast path — ship the smallest change');
    expect(controller.list()).toEqual([]);
    expect(events.at(-1).event.type).toBe(EXTENSION_UI_EVENTS.settled);
    expect(events.some((item) => String(item.event.type).startsWith('question.'))).toBe(false);
  });

  it('cancels only the waiting prompt and returns the SDK cancel value', async () => {
    const { controller } = createController();
    const select = controller.context.select('Pick one', ['A', 'B']);
    const confirm = controller.context.confirm('Replace goal?', 'The current goal will be replaced.');
    const [first] = controller.list();

    expect(controller.cancel(first.id)).toBe(true);
    await expect(select).resolves.toBeUndefined();
    expect(controller.list()).toHaveLength(1);

    const [second] = controller.list();
    expect(controller.cancel(second.id)).toBe(true);
    await expect(confirm).resolves.toBe(false);
    expect(controller.list()).toEqual([]);
  });

  it('cancelAll settles every waiting prompt without disposing the controller', async () => {
    const { controller } = createController();
    const select = controller.context.select('Pick one', ['A', 'B']);
    const confirm = controller.context.confirm('Replace goal?', 'The current goal will be replaced.');
    controller.cancelAll();
    await expect(select).resolves.toBeUndefined();
    await expect(confirm).resolves.toBe(false);
    expect(controller.list()).toEqual([]);
    const later = controller.context.select('Still bound', ['Yes']);
    const [prompt] = controller.list();
    expect(prompt.title).toBe('Still bound');
    expect(controller.reply(prompt.id, 'Yes')).toBe(true);
    await expect(later).resolves.toBe('Yes');
  });

  it('maps custom onto an in-chat editor instead of returning undefined', async () => {
    const { controller } = createController();
    const pending = controller.context.custom();
    const [prompt] = controller.list();
    expect(prompt.kind).toBe('editor');
    expect(controller.reply(prompt.id, '  typed on Desktop  ')).toBe(true);
    await expect(pending).resolves.toEqual({ answer: 'typed on Desktop', wasCustom: true });

    const cancelled = controller.context.custom();
    const [second] = controller.list();
    expect(controller.cancel(second.id)).toBe(true);
    await expect(cancelled).resolves.toBeUndefined();
  });

  it('wires confirm, input, editor, and notify', async () => {
    const { controller, events } = createController();

    const confirm = controller.context.confirm('Replace goal?', 'Keep the current goal?');
    const input = controller.context.input('Token', 'paste token');
    const editor = controller.context.editor('Describe the other approach', '');
    controller.context.notify('Plan mode enabled.', 'info');

    const prompts = controller.list();
    expect(prompts.map((prompt) => prompt.kind)).toEqual(['confirm', 'input', 'editor']);

    controller.reply(prompts[0].id, true);
    controller.reply(prompts[1].id, 'secret-token');
    controller.reply(prompts[2].id, 'Use a queue');

    await expect(confirm).resolves.toBe(true);
    await expect(input).resolves.toBe('secret-token');
    await expect(editor).resolves.toBe('Use a queue');

    const notify = events.find((item) => item.event.type === EXTENSION_UI_EVENTS.notify);
    expect(notify.event.properties).toMatchObject({
      message: 'Plan mode enabled.',
      level: 'info',
      sessionID: 'ses_test',
    });
  });

  it('honors abort and timeout without hanging', async () => {
    const { controller } = createController();
    const abort = new AbortController();
    const aborted = controller.context.select('Aborted', ['A'], { signal: abort.signal });
    abort.abort();
    await expect(aborted).resolves.toBeUndefined();

    const timedOut = controller.context.confirm('Timeout', 'Wait', { timeout: 5 });
    await expect(timedOut).resolves.toBe(false);
    expect(controller.list()).toEqual([]);
  });

  it('dispose cancels every waiting prompt', async () => {
    const { controller } = createController();
    const select = controller.context.select('A', ['1']);
    const confirm = controller.context.confirm('B', 'C');
    controller.dispose();
    await expect(select).resolves.toBeUndefined();
    await expect(confirm).resolves.toBe(false);
    expect(controller.list()).toEqual([]);
  });

  it('returns false for unknown reply or cancel ids', () => {
    const { controller } = createController();
    expect(controller.reply('pui_missing', 'A')).toBe(false);
    expect(controller.cancel('pui_missing')).toBe(false);
  });
});
