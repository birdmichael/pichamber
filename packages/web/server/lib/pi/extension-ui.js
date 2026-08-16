import { createEventId, createId } from './ids.js';

const UI_ASKED = 'pi.ui.asked';
const UI_SETTLED = 'pi.ui.settled';
const UI_NOTIFY = 'pi.ui.notify';

const SELECT_KINDS = new Set(['select', 'confirm', 'input', 'editor']);

const noop = () => {};

const asTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');

const publicPrompt = (prompt) => ({
  id: prompt.id,
  sessionID: prompt.sessionID,
  directory: prompt.directory,
  kind: prompt.kind,
  title: prompt.title,
  message: prompt.message,
  options: prompt.options,
  placeholder: prompt.placeholder,
  prefill: prompt.prefill,
  multiple: prompt.multiple === true,
  status: prompt.status,
  value: prompt.value,
});

const createNoopUiExtras = () => ({
  onTerminalInput: () => noop,
  setStatus: noop,
  setWorkingMessage: noop,
  setWorkingVisible: noop,
  setWorkingIndicator: noop,
  setHiddenThinkingLabel: noop,
  setWidget: noop,
  setFooter: noop,
  setHeader: noop,
  setTitle: noop,
  custom: async () => undefined,
  pasteToEditor: noop,
  setEditorText: noop,
  getEditorText: () => '',
  addAutocompleteProvider: noop,
  setEditorComponent: noop,
  getEditorComponent: () => undefined,
  get theme() {
    return undefined;
  },
  getAllThemes: () => [],
  getTheme: () => undefined,
  setTheme: () => ({ success: false, error: 'UI theme is not available in Desktop ctx.ui' }),
  getToolsExpanded: () => false,
  setToolsExpanded: noop,
});

export const createExtensionUIController = ({
  sessionID,
  directory,
  emit,
} = {}) => {
  const pending = new Map();

  const publish = (type, properties) => {
    if (typeof emit !== 'function') return;
    emit(directory, {
      id: createEventId(),
      type,
      properties: {
        sessionID,
        directory,
        ...properties,
      },
    });
  };

  const settle = (id, status, value) => {
    const item = pending.get(id);
    if (!item) return false;
    pending.delete(id);
    item.cleanup();
    item.prompt.status = status;
    item.prompt.value = value;
    if (status === 'cancelled') {
      item.resolve(item.cancelValue);
    } else {
      item.resolve(value);
    }
    publish(UI_SETTLED, { prompt: publicPrompt(item.prompt) });
    return true;
  };

  const ask = ({
    kind,
    title,
    message,
    options,
    placeholder,
    prefill,
    multiple = false,
    cancelValue,
    opts,
  }) => {
    if (opts?.signal?.aborted) {
      return Promise.resolve(cancelValue);
    }

    const id = createId('pui');
    const prompt = {
      id,
      sessionID,
      directory,
      kind,
      title: typeof title === 'string' ? title : '',
      message: typeof message === 'string' ? message : undefined,
      options: Array.isArray(options) ? options.map((option) => String(option)) : undefined,
      placeholder: typeof placeholder === 'string' ? placeholder : undefined,
      prefill: typeof prefill === 'string' ? prefill : undefined,
      multiple,
      status: 'pending',
    };

    return new Promise((resolve) => {
      let timeoutId;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        opts?.signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        settle(id, 'cancelled', cancelValue);
      };

      pending.set(id, {
        resolve,
        cancelValue,
        cleanup,
        prompt,
      });

      opts?.signal?.addEventListener('abort', onAbort, { once: true });
      if (Number.isFinite(opts?.timeout) && opts.timeout > 0) {
        timeoutId = setTimeout(() => {
          settle(id, 'cancelled', cancelValue);
        }, opts.timeout);
      }

      publish(UI_ASKED, { prompt: publicPrompt(prompt) });
    });
  };

  const context = {
    ...createNoopUiExtras(),
    select(title, options, opts) {
      return ask({
        kind: 'select',
        title,
        options,
        multiple: opts?.multiple === true,
        cancelValue: undefined,
        opts,
      });
    },
    confirm(title, message, opts) {
      return ask({
        kind: 'confirm',
        title,
        message,
        cancelValue: false,
        opts,
      });
    },
    input(title, placeholder, opts) {
      return ask({
        kind: 'input',
        title,
        placeholder,
        cancelValue: undefined,
        opts,
      });
    },
    editor(title, prefill) {
      return ask({
        kind: 'editor',
        title,
        prefill,
        cancelValue: undefined,
      });
    },
    notify(message, type) {
      const text = asTrimmedString(message);
      if (!text) return;
      const level = type === 'warning' || type === 'error' ? type : 'info';
      publish(UI_NOTIFY, { message: text, level });
    },
  };

  return {
    context,
    list() {
      return Array.from(pending.values()).map((item) => publicPrompt(item.prompt));
    },
    reply(id, value) {
      return settle(id, 'replied', value);
    },
    cancel(id) {
      const item = pending.get(id);
      return settle(id, 'cancelled', item?.cancelValue);
    },
    dispose() {
      for (const id of Array.from(pending.keys())) {
        this.cancel(id);
      }
    },
  };
};

export const isExtensionUiKind = (kind) => SELECT_KINDS.has(kind);

export const EXTENSION_UI_EVENTS = {
  asked: UI_ASKED,
  settled: UI_SETTLED,
  notify: UI_NOTIFY,
};
